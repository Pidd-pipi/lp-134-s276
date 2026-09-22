import { Router } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma.js';
import { authMiddleware, AuthRequest, requireRole } from '../middleware/auth.middleware.js';
import { CRISIS_RESPONSE } from '../utils/crisisDetector.js';
import { sendInternalError, sendValidationError } from '../utils/httpResponses.js';

const router = Router();

const claimedByUserSelect = {
  id: true,
  username: true,
  nickname: true
} as const;

const optionalNote = z
  .string()
  .trim()
  .max(1000)
  .optional()
  .transform(v => (v ? v : undefined));

const claimAlertSchema = z.object({
  note: optionalNote
});

const resolveAlertSchema = z.object({
  note: z.string().trim().min(1, '关闭说明必须填写').max(1000)
});

const falseAlarmSchema = z.object({
  note: optionalNote
});

// 处理完成后给预警用户发送脱敏通知：只保留处理结果，不暴露处理人身份与内部备注
const notifyUserResolved = async (
  userId: string,
  alertId: string,
  result: 'CLOSED' | 'FALSE_ALARM'
) => {
  const content = result === 'CLOSED'
    ? '您发布的内容已由平台心理支持团队跟进处理完毕，处理结果：已关闭。如需帮助，请随时拨打心理援助热线。'
    : '您发布的内容经平台心理支持团队核实，相关预警已解除，处理结果：误报。感谢理解。';

  await prisma.notification.create({
    data: {
      userId,
      type: 'CRISIS_ALERT_RESULT',
      title: '危机预警处理结果',
      content,
      relatedId: alertId
    }
  });
};

router.get('/hotline', (req, res) => {
  res.json(CRISIS_RESPONSE);
});

router.get('/alerts', authMiddleware, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const isResolved = req.query.isResolved === 'true';
    const status = req.query.status as string | undefined;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (req.query.isResolved !== undefined) {
      where.isResolved = isResolved;
    }

    const alerts = await prisma.crisisAlert.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            nickname: true,
            avatar: true
          }
        },
        claimedByUser: {
          select: claimedByUserSelect
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    });

    const total = await prisma.crisisAlert.count({ where });

    res.json({
      alerts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    sendInternalError(res, error, '获取危机预警错误', '获取危机预警失败');
  }
});

// 领取预警：标记为跟进中并记录干预备注。并发领取只有一处生效，失败不改状态。
router.post('/alerts/:id/claim', authMiddleware, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const validated = claimAlertSchema.parse(req.body ?? {});

    const result = await prisma.crisisAlert.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: 'FOLLOWING',
        claimedBy: req.user!.id,
        claimedAt: new Date(),
        interventionNote: validated.note ?? null
      }
    });

    if (result.count === 0) {
      const existing = await prisma.crisisAlert.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ error: '预警不存在' });
      }
      return res.status(409).json({ error: '该预警已被其他管理员领取或已处理' });
    }

    const alert = await prisma.crisisAlert.findUnique({
      where: { id },
      include: { claimedByUser: { select: claimedByUserSelect } }
    });

    res.json({
      message: '已领取，跟进中',
      alert
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendValidationError(res, error);
    }
    sendInternalError(res, error, '领取危机预警错误', '领取失败');
  }
});

// 关闭预警：只有跟进中才能关闭，关闭说明必须填写。并发时只一处生效，失败不改状态。
router.post('/alerts/:id/resolve', authMiddleware, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const validated = resolveAlertSchema.parse(req.body ?? {});

    const result = await prisma.crisisAlert.updateMany({
      where: { id, status: 'FOLLOWING' },
      data: {
        status: 'CLOSED',
        isResolved: true,
        resolvedBy: req.user!.id,
        resolvedAt: new Date(),
        resolutionNote: validated.note
      }
    });

    if (result.count === 0) {
      const existing = await prisma.crisisAlert.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ error: '预警不存在' });
      }
      return res.status(409).json({ error: '只有跟进中的预警才能关闭，或该预警已被处理' });
    }

    const alert = await prisma.crisisAlert.findUnique({
      where: { id },
      include: { claimedByUser: { select: claimedByUserSelect } }
    });

    await notifyUserResolved(alert!.userId, id, 'CLOSED');

    res.json({
      message: '预警已关闭',
      alert
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendValidationError(res, error);
    }
    sendInternalError(res, error, '处理危机预警错误', '处理失败');
  }
});

// 标记误报：待处理或跟进中可标记。并发时只一处生效，失败不改状态。
router.post('/alerts/:id/false-alarm', authMiddleware, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const validated = falseAlarmSchema.parse(req.body ?? {});

    const result = await prisma.crisisAlert.updateMany({
      where: { id, status: { in: ['PENDING', 'FOLLOWING'] } },
      data: {
        status: 'FALSE_ALARM',
        isResolved: true,
        resolvedBy: req.user!.id,
        resolvedAt: new Date(),
        resolutionNote: validated.note ?? null
      }
    });

    if (result.count === 0) {
      const existing = await prisma.crisisAlert.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ error: '预警不存在' });
      }
      return res.status(409).json({ error: '该预警已被处理，无法标记为误报' });
    }

    const alert = await prisma.crisisAlert.findUnique({
      where: { id },
      include: { claimedByUser: { select: claimedByUserSelect } }
    });

    await notifyUserResolved(alert!.userId, id, 'FALSE_ALARM');

    res.json({
      message: '已标记为误报',
      alert
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendValidationError(res, error);
    }
    sendInternalError(res, error, '标记误报错误', '操作失败');
  }
});

router.get('/alerts/:id', authMiddleware, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const alert = await prisma.crisisAlert.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            nickname: true,
            email: true,
            avatar: true
          }
        },
        claimedByUser: {
          select: claimedByUserSelect
        },
        post: {
          select: {
            id: true,
            title: true,
            content: true
          }
        }
      }
    });

    if (!alert) {
      return res.status(404).json({ error: '预警不存在' });
    }

    res.json(alert);
  } catch (error) {
    sendInternalError(res, error, '获取预警详情错误', '获取预警详情失败');
  }
});

export default router;

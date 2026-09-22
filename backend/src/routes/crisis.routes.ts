import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/prisma.js';
import { authMiddleware, AuthRequest, requireRole } from '../middleware/auth.middleware.js';
import { CRISIS_RESPONSE } from '../utils/crisisDetector.js';
import { maskSensitiveInfo } from '../utils/desensitize.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { sendInternalError, sendValidationError } from '../utils/httpResponses.js';

const router = Router();

const ALERT_STATUSES = ['PENDING', 'FOLLOWING', 'CLOSED', 'FALSE_ALARM'] as const;

const claimAlertSchema = z.object({
  note: z.string().max(1000).optional(),
  interventionNote: z.string().max(1000).optional()
});

const closeAlertSchema = z.object({
  note: z.string().max(1000).optional(),
  resolution: z.string().max(1000).optional(),
  closeNote: z.string().max(1000).optional()
});

const falseAlarmSchema = z.object({
  note: z.string().max(1000).optional(),
  reason: z.string().max(1000).optional()
});

// 从若干候选字段中取出第一个非空备注
const pickNote = (...candidates: Array<string | undefined>): string => {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return '';
};

const alertInclude = {
  user: {
    select: {
      id: true,
      username: true,
      nickname: true,
      avatar: true
    }
  },
  claimer: {
    select: {
      id: true,
      username: true,
      nickname: true
    }
  },
  resolver: {
    select: {
      id: true,
      username: true,
      nickname: true
    }
  }
} as const;

// 处理完成后给当事人发送脱敏结果通知（不暴露处理人身份与敏感信息）
const notifyUserResult = async (
  alert: { id: string; userId: string },
  result: 'CLOSED' | 'FALSE_ALARM',
  note: string
): Promise<void> => {
  try {
    const maskedNote = note ? maskSensitiveInfo(note) : '';
    const resultText = result === 'CLOSED'
      ? '管理员已跟进并完成处理'
      : '经管理员核实为误报，感谢您的理解';
    const noteText = maskedNote ? `处理说明：${maskedNote}。` : '';

    await prisma.notification.create({
      data: {
        userId: alert.userId,
        type: 'CRISIS_ALERT_RESULT',
        title: '危机预警处理结果',
        content: `您发布的内容触发了平台关怀预警，${resultText}。${noteText}如需帮助，可随时拨打24小时心理援助热线 ${env.crisisHotline}，我们始终陪伴您。`,
        relatedId: alert.id
      }
    });
  } catch (error) {
    logger.error('创建危机预警处理结果通知失败', error);
  }
};

router.get('/hotline', (req, res) => {
  res.json(CRISIS_RESPONSE);
});

router.get('/alerts', authMiddleware, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const isResolved = req.query.isResolved === 'true';
    const status = req.query.status as string;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (req.query.isResolved !== undefined) {
      where.isResolved = isResolved;
    }

    if (status && (ALERT_STATUSES as readonly string[]).includes(status)) {
      where.status = status;
    }

    const alerts = await prisma.crisisAlert.findMany({
      where,
      include: alertInclude,
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

// 领取预警：标记为跟进中并填写干预备注。
// 通过条件式原子更新保证同一预警只会被一个管理员领取，并发/重复领取失败时不改状态。
router.post('/alerts/:id/claim', authMiddleware, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const validated = claimAlertSchema.parse(req.body ?? {});
    const note = pickNote(validated.note, validated.interventionNote);

    const claimed = await prisma.crisisAlert.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: 'FOLLOWING',
        claimedBy: req.user!.id,
        claimedAt: new Date(),
        interventionNote: note || null
      }
    });

    if (claimed.count === 0) {
      const existing = await prisma.crisisAlert.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ error: '预警不存在' });
      }
      return res.status(409).json({ error: '该预警已被领取或已处理', alert: existing });
    }

    const alert = await prisma.crisisAlert.findUnique({
      where: { id },
      include: alertInclude
    });

    res.json({
      message: '已领取，预警进入跟进中',
      alert
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendValidationError(res, error);
    }
    sendInternalError(res, error, '领取危机预警错误', '领取失败');
  }
});

// 关闭预警：仅跟进中的预警可关闭，且必须填写关闭说明。
const closeAlertHandler = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const validated = closeAlertSchema.parse(req.body ?? {});
    const note = pickNote(validated.note, validated.resolution, validated.closeNote);

    if (!note) {
      return res.status(400).json({ error: '关闭预警必须填写关闭说明' });
    }

    const closed = await prisma.crisisAlert.updateMany({
      where: { id, status: 'FOLLOWING' },
      data: {
        status: 'CLOSED',
        isResolved: true,
        resolvedBy: req.user!.id,
        resolvedAt: new Date(),
        closeNote: note
      }
    });

    if (closed.count === 0) {
      const existing = await prisma.crisisAlert.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ error: '预警不存在' });
      }
      return res.status(409).json({ error: '只有跟进中的预警才能关闭', alert: existing });
    }

    const alert = await prisma.crisisAlert.findUnique({
      where: { id },
      include: alertInclude
    });

    await notifyUserResult(alert!, 'CLOSED', note);

    res.json({
      message: '预警已关闭',
      alert
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendValidationError(res, error);
    }
    sendInternalError(res, error, '关闭危机预警错误', '关闭失败');
  }
};

router.post('/alerts/:id/close', authMiddleware, requireRole(['ADMIN']), closeAlertHandler);
// 兼容原有的“标记为已处理”入口，语义等同于关闭
router.post('/alerts/:id/resolve', authMiddleware, requireRole(['ADMIN']), closeAlertHandler);

// 标记误报：待处理或跟进中的预警可标记为误报，与领取/关闭并发时只一处生效。
router.post('/alerts/:id/false-alarm', authMiddleware, requireRole(['ADMIN']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const validated = falseAlarmSchema.parse(req.body ?? {});
    const note = pickNote(validated.note, validated.reason);

    const marked = await prisma.crisisAlert.updateMany({
      where: { id, status: { in: ['PENDING', 'FOLLOWING'] } },
      data: {
        status: 'FALSE_ALARM',
        isResolved: true,
        resolvedBy: req.user!.id,
        resolvedAt: new Date(),
        closeNote: note || null
      }
    });

    if (marked.count === 0) {
      const existing = await prisma.crisisAlert.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ error: '预警不存在' });
      }
      return res.status(409).json({ error: '该预警已处理，无法标记为误报', alert: existing });
    }

    const alert = await prisma.crisisAlert.findUnique({
      where: { id },
      include: alertInclude
    });

    await notifyUserResult(alert!, 'FALSE_ALARM', note);

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
        post: {
          select: {
            id: true,
            title: true,
            content: true
          }
        },
        claimer: {
          select: {
            id: true,
            username: true,
            nickname: true
          }
        },
        resolver: {
          select: {
            id: true,
            username: true,
            nickname: true
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

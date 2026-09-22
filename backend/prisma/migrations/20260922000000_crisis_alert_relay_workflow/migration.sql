-- CreateEnum
CREATE TYPE "CrisisAlertStatus" AS ENUM ('PENDING', 'FOLLOWING', 'CLOSED', 'FALSE_ALARM');

-- AlterTable
ALTER TABLE "crisis_alerts"
ADD COLUMN "claimedAt" TIMESTAMP(3),
ADD COLUMN "claimedBy" TEXT,
ADD COLUMN "closeNote" TEXT,
ADD COLUMN "interventionNote" TEXT,
ADD COLUMN "status" "CrisisAlertStatus" NOT NULL DEFAULT 'PENDING';

-- 回填：历史已处理预警视为已关闭
UPDATE "crisis_alerts" SET "status" = 'CLOSED' WHERE "isResolved" = true;

-- AddForeignKey
ALTER TABLE "crisis_alerts" ADD CONSTRAINT "crisis_alerts_claimedBy_fkey" FOREIGN KEY ("claimedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crisis_alerts" ADD CONSTRAINT "crisis_alerts_resolvedBy_fkey" FOREIGN KEY ("resolvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

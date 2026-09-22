-- CreateEnum
CREATE TYPE "CrisisAlertStatus" AS ENUM ('PENDING', 'FOLLOWING', 'CLOSED', 'FALSE_ALARM');

-- AlterTable
ALTER TABLE "crisis_alerts"
ADD COLUMN "status" "CrisisAlertStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "claimedBy" TEXT,
ADD COLUMN "claimedAt" TIMESTAMP(3),
ADD COLUMN "interventionNote" TEXT,
ADD COLUMN "resolutionNote" TEXT;

-- Backfill: alerts already handled under the old single-state flow become CLOSED
UPDATE "crisis_alerts" SET "status" = 'CLOSED' WHERE "isResolved" = true;

-- AddForeignKey
ALTER TABLE "crisis_alerts" ADD CONSTRAINT "crisis_alerts_claimedBy_fkey" FOREIGN KEY ("claimedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ARCHIVED');

-- DropIndex
DROP INDEX "Plan_athleteId_key";

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "objective1" TEXT,
ADD COLUMN     "objective2" TEXT,
ADD COLUMN     "startDate" TIMESTAMP(3),
ADD COLUMN     "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE';

-- Backfill: les plans existants démarrent à leur date de création (aucune
-- vraie startDate n'existait avant cette migration).
UPDATE "Plan" SET "startDate" = "createdAt" WHERE "startDate" IS NULL;

ALTER TABLE "Plan" ALTER COLUMN "startDate" SET NOT NULL;

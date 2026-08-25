-- CreateEnum
CREATE TYPE "HeartRateZone" AS ENUM ('Z1', 'Z2', 'Z3', 'Z4', 'Z5');

-- AlterTable
ALTER TABLE "PlannedLap" ADD COLUMN     "targetHeartRateZone" "HeartRateZone";

-- AlterTable
ALTER TABLE "PlannedSession" ADD COLUMN     "coachNote" TEXT,
ADD COLUMN     "targetDistanceM" DOUBLE PRECISION,
ADD COLUMN     "targetDurationSec" DOUBLE PRECISION,
ADD COLUMN     "targetHeartRateZone" "HeartRateZone";

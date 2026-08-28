-- CreateEnum
CREATE TYPE "ActivityLabel" AS ENUM ('RACE', 'LONG_RUN', 'WORKOUT', 'RECOVERY');

-- CreateEnum
CREATE TYPE "LapIntensity" AS ENUM ('ACTIVE', 'REST', 'WARMUP', 'COOLDOWN', 'RECOVERY', 'INTERVAL', 'OTHER');

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "labels" "ActivityLabel"[];

-- AlterTable
ALTER TABLE "Lap" ADD COLUMN     "intensity" "LapIntensity";

-- CreateEnum
CREATE TYPE "LapIntensitySource" AS ENUM ('DEVICE', 'DERIVED');

-- AlterTable
ALTER TABLE "Lap" ADD COLUMN     "intensitySource" "LapIntensitySource";

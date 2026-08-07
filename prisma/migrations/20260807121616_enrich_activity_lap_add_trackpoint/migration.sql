-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "avgCadence" INTEGER,
ADD COLUMN     "avgHeartRate" INTEGER,
ADD COLUMN     "avgPower" INTEGER,
ADD COLUMN     "elevationGainM" DOUBLE PRECISION,
ADD COLUMN     "elevationLossM" DOUBLE PRECISION,
ADD COLUMN     "maxHeartRate" INTEGER,
ADD COLUMN     "sport" TEXT,
ADD COLUMN     "subSport" TEXT,
ADD COLUMN     "totalCalories" INTEGER;

-- AlterTable
ALTER TABLE "Lap" ADD COLUMN     "avgStanceTimeMs" DOUBLE PRECISION,
ADD COLUMN     "avgStepLengthMm" DOUBLE PRECISION,
ADD COLUMN     "avgVerticalOscillationMm" DOUBLE PRECISION,
ADD COLUMN     "avgVerticalRatio" DOUBLE PRECISION,
ADD COLUMN     "maxHeartRate" INTEGER;

-- CreateTable
CREATE TABLE "TrackPoint" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "elapsedSec" DOUBLE PRECISION NOT NULL,
    "distanceM" DOUBLE PRECISION,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "altitudeM" DOUBLE PRECISION,
    "heartRate" INTEGER,
    "cadence" INTEGER,
    "power" INTEGER,
    "speedMPerSec" DOUBLE PRECISION,

    CONSTRAINT "TrackPoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrackPoint_activityId_elapsedSec_idx" ON "TrackPoint"("activityId", "elapsedSec");

-- AddForeignKey
ALTER TABLE "TrackPoint" ADD CONSTRAINT "TrackPoint_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

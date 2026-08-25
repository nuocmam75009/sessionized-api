-- DropForeignKey
ALTER TABLE "Activity" DROP CONSTRAINT "Activity_plannedSessionId_fkey";

-- DropForeignKey
ALTER TABLE "PlannedLap" DROP CONSTRAINT "PlannedLap_plannedSessionId_fkey";

-- DropForeignKey
ALTER TABLE "PlannedSession" DROP CONSTRAINT "PlannedSession_coachId_fkey";

-- DropForeignKey
ALTER TABLE "PlannedSession" DROP CONSTRAINT "PlannedSession_athleteId_fkey";

-- RenameColumn (Activity.plannedSessionId -> workoutId)
ALTER TABLE "Activity" RENAME COLUMN "plannedSessionId" TO "workoutId";

-- RenameIndex (unique constraint on Activity.workoutId)
ALTER INDEX "Activity_plannedSessionId_key" RENAME TO "Activity_workoutId_key";

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_athleteId_key" ON "Plan"("athleteId");

-- CreateTable
CREATE TABLE "Workout" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "coachNote" TEXT,
    "targetDistanceM" DOUBLE PRECISION,
    "targetDurationSec" DOUBLE PRECISION,
    "targetHeartRateZone" "HeartRateZone",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutLap" (
    "id" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "targetDistanceM" DOUBLE PRECISION,
    "targetPaceSecPerKm" DOUBLE PRECISION,
    "targetDurationSec" DOUBLE PRECISION,
    "targetHeartRateZone" "HeartRateZone",

    CONSTRAINT "WorkoutLap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutLap_workoutId_index_key" ON "WorkoutLap"("workoutId", "index");

-- DropTable
DROP TABLE "PlannedLap";

-- DropTable
DROP TABLE "PlannedSession";

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "CoachProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutLap" ADD CONSTRAINT "WorkoutLap_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

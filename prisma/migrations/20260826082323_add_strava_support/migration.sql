-- AlterEnum
ALTER TYPE "ActivitySource" ADD VALUE 'STRAVA';

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "stravaActivityId" TEXT;

-- CreateTable
CREATE TABLE "StravaToken" (
    "id" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StravaToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StravaToken_athleteId_key" ON "StravaToken"("athleteId");

-- AddForeignKey
ALTER TABLE "StravaToken" ADD CONSTRAINT "StravaToken_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "AthleteProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

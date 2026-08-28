-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "fitFileHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Activity_athleteId_fitFileHash_key" ON "Activity"("athleteId", "fitFileHash");

-- CreateTable
CREATE TABLE "RaceDay" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RaceDay_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "RaceDay" ADD CONSTRAINT "RaceDay_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

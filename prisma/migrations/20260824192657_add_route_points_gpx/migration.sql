-- CreateTable
CREATE TABLE "RoutePoint" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3),
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "altitudeM" DOUBLE PRECISION,

    CONSTRAINT "RoutePoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoutePoint_activityId_idx" ON "RoutePoint"("activityId");

-- AddForeignKey
ALTER TABLE "RoutePoint" ADD CONSTRAINT "RoutePoint_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

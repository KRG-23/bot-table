-- CreateTable
CREATE TABLE "EventGameCapacity" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "gameId" INTEGER NOT NULL,
    "tables" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventGameCapacity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventGameCapacity_gameId_idx" ON "EventGameCapacity"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "EventGameCapacity_eventId_gameId_key" ON "EventGameCapacity"("eventId", "gameId");

-- AddForeignKey
ALTER TABLE "EventGameCapacity" ADD CONSTRAINT "EventGameCapacity_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventGameCapacity" ADD CONSTRAINT "EventGameCapacity_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

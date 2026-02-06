-- CreateTable
CREATE TABLE "EventThread" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "gameSystem" "GameSystem" NOT NULL,
    "threadId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventThread_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventThread_threadId_idx" ON "EventThread"("threadId");

-- CreateIndex
CREATE UNIQUE INDEX "EventThread_eventId_gameSystem_key" ON "EventThread"("eventId", "gameSystem");

-- AddForeignKey
ALTER TABLE "EventThread" ADD CONSTRAINT "EventThread_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

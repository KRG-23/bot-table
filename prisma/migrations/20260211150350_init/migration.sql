/*
  Warnings:

  - You are about to drop the column `gameSystem` on the `EventThread` table. All the data in the column will be lost.
  - You are about to drop the column `gameSystem` on the `Match` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[eventId,gameId]` on the table `EventThread` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `gameId` to the `EventThread` table without a default value. This is not possible if the table is not empty.
  - Added the required column `gameId` to the `Match` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "EventThread_eventId_gameSystem_key";

-- AlterTable
ALTER TABLE "EventThread" DROP COLUMN "gameSystem",
ADD COLUMN     "gameId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Match" DROP COLUMN "gameSystem",
ADD COLUMN     "gameId" INTEGER NOT NULL;

-- DropEnum
DROP TYPE "GameSystem";

-- CreateTable
CREATE TABLE "Game" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Game_code_key" ON "Game"("code");

-- CreateIndex
CREATE UNIQUE INDEX "EventThread_eventId_gameId_key" ON "EventThread"("eventId", "gameId");

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventThread" ADD CONSTRAINT "EventThread_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

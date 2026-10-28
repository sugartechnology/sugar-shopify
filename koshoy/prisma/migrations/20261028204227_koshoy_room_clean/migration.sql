-- AlterTable
ALTER TABLE "KoshoyRoom" ADD COLUMN "activeCleanId" TEXT;
ALTER TABLE "KoshoyRoom" ADD COLUMN "objects" TEXT;
ALTER TABLE "KoshoyRoom" ADD COLUMN "readyCleanId" TEXT;

-- CreateTable
CREATE TABLE "KoshoyRoomClean" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "objectIds" TEXT NOT NULL,
    "parts" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "jobId" TEXT,
    "photoUrl" TEXT,
    "depthUrl" TEXT,
    "furnitureUrl" TEXT,
    "measures" TEXT,
    "method" TEXT,
    "model" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KoshoyRoomClean_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "KoshoyRoom" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "KoshoyRoomClean_roomId_idx" ON "KoshoyRoomClean"("roomId");


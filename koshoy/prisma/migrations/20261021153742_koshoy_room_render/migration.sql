-- AlterTable
ALTER TABLE "KoshoySession" ADD COLUMN "roomId" TEXT;

-- CreateTable
CREATE TABLE "KoshoyRoom" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "jobId" TEXT,
    "photoKey" TEXT NOT NULL,
    "consentAt" DATETIME,
    "width" INTEGER,
    "height" INTEGER,
    "camera" TEXT,
    "planes" TEXT,
    "depthScale" TEXT,
    "fileUrls" TEXT,
    "scaleSource" TEXT,
    "measures" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "KoshoyRender" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "designIds" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "jobId" TEXT,
    "compositeKey" TEXT NOT NULL,
    "cabinetKey" TEXT NOT NULL,
    "resultKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "KoshoyLayout" (
    "sessionId" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT,
    "version" INTEGER NOT NULL,
    "items" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KoshoyLayout_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "KoshoySession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "KoshoyRoom_sessionId_idx" ON "KoshoyRoom"("sessionId");

-- CreateIndex
CREATE INDEX "KoshoyRender_sessionId_idx" ON "KoshoyRender"("sessionId");

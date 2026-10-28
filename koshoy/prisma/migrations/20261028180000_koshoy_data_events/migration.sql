-- CreateTable
CREATE TABLE "KoshoyDataDoc" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "version" INTEGER NOT NULL,
    "json" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "KoshoyDataHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "json" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "KoshoyEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "props" TEXT
);

-- CreateIndex
CREATE INDEX "KoshoyDataHistory_key_idx" ON "KoshoyDataHistory"("key");

-- CreateIndex
CREATE INDEX "KoshoyEvent_at_idx" ON "KoshoyEvent"("at");

-- CreateIndex
CREATE INDEX "KoshoyEvent_name_idx" ON "KoshoyEvent"("name");


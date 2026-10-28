-- AlterTable
ALTER TABLE "KoshoySession" ADD COLUMN "customerId" TEXT;

-- CreateTable
CREATE TABLE "KoshoySessionKey" (
    "tokenHash" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KoshoySessionKey_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "KoshoySession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "KoshoySessionKey_sessionId_idx" ON "KoshoySessionKey"("sessionId");

-- CreateIndex
CREATE INDEX "KoshoySession_shop_customerId_idx" ON "KoshoySession"("shop", "customerId");

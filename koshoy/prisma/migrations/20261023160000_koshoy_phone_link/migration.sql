-- CreateTable
CREATE TABLE "KoshoyPhoneLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "roomId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KoshoyPhoneLink_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "KoshoySession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "KoshoyPhoneLink_tokenHash_key" ON "KoshoyPhoneLink"("tokenHash");

-- CreateIndex
CREATE INDEX "KoshoyPhoneLink_sessionId_idx" ON "KoshoyPhoneLink"("sessionId");

-- CreateIndex
CREATE INDEX "KoshoyPhoneLink_expiresAt_idx" ON "KoshoyPhoneLink"("expiresAt");

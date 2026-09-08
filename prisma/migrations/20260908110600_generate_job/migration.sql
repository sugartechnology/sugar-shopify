-- CreateTable
CREATE TABLE "GenerateJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "result" TEXT,
    "message" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "GenerateJob_shop_idx" ON "GenerateJob"("shop");

-- CreateIndex
CREATE INDEX "GenerateJob_createdAt_idx" ON "GenerateJob"("createdAt");

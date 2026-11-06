-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_KoshoyRender" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "roomId" TEXT,
    "roomKey" TEXT,
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
INSERT INTO "new_KoshoyRender" ("cabinetKey", "compositeKey", "createdAt", "designIds", "error", "id", "jobId", "resultKey", "roomId", "sessionId", "shop", "status", "updatedAt") SELECT "cabinetKey", "compositeKey", "createdAt", "designIds", "error", "id", "jobId", "resultKey", "roomId", "sessionId", "shop", "status", "updatedAt" FROM "KoshoyRender";
DROP TABLE "KoshoyRender";
ALTER TABLE "new_KoshoyRender" RENAME TO "KoshoyRender";
CREATE INDEX "KoshoyRender_sessionId_idx" ON "KoshoyRender"("sessionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


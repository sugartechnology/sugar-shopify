import prisma from "../db.server";
import { normalizeShop } from "./shop.server";

const TTL_MS = 15 * 60 * 1000;

/** OAuth bitene kadar CRM connect session id'sini shop ile tutar. Token değildir. */
export async function savePendingConnect(shop: string, connectSessionId: string) {
  const normalized = normalizeShop(shop);
  await prisma.connectPending.upsert({
    where: { shop: normalized },
    create: {
      shop: normalized,
      connectSessionId,
      expiresAt: new Date(Date.now() + TTL_MS),
    },
    update: {
      connectSessionId,
      expiresAt: new Date(Date.now() + TTL_MS),
    },
  });
}

export async function takePendingConnect(shop: string): Promise<string | null> {
  const normalized = normalizeShop(shop);
  const row = await prisma.connectPending.findUnique({ where: { shop: normalized } });
  if (!row) {
    return null;
  }
  await prisma.connectPending.delete({ where: { shop: normalized } }).catch(() => undefined);
  if (row.expiresAt.getTime() < Date.now()) {
    return null;
  }
  return row.connectSessionId;
}

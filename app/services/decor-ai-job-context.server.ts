import type { DesignProductOutput } from "../types/sugar";

type JobContext = {
  shop: string;
  products: DesignProductOutput[];
  imageUrl?: string;
  apiKey?: string;
  createdAt: number;
};

const TTL_MS = 24 * 60 * 60 * 1000;
const contexts = new Map<string, JobContext>();

function prune() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, value] of contexts) {
    if (value.createdAt < cutoff) contexts.delete(id);
  }
}

export function rememberDecorAiJob(
  jobId: string,
  shop: string,
  products: DesignProductOutput[],
  imageUrl?: string,
  apiKey?: string,
) {
  prune();
  contexts.set(jobId, { shop, products, imageUrl, apiKey, createdAt: Date.now() });
}

export function getDecorAiJobContext(
  jobId: string,
  shop: string,
): JobContext | null {
  const context = contexts.get(jobId);
  if (!context || context.shop !== shop) return null;
  return context;
}

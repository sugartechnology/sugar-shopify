import type {
  DecorAiJobResponse,
  DecorAiPackedCommand,
  ShopifyPdpPackedPipeline,
} from "./decor-ai-client.server";
import { jobToGenerateResponse } from "./decor-ai-client.server";
import type { GenerateImageResponse } from "../types/sugar";

const SYNC_POLL_MS = 2000;
const SYNC_MAX_MS = 180000;

export function getSugarApiBaseUrl(): string {
  return (process.env.SUGAR_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

export function isTagserviceConfigured(): boolean {
  return Boolean(getSugarApiBaseUrl());
}

function appendPackedForm(form: FormData, packed: DecorAiPackedCommand) {
  form.append("prompt", packed.prompt);
  form.append("tag", "shopify_pdp");
  form.append("userId", packed.shopDomain);
  form.append("jobId", packed.jobId);
  form.append("platform", "GOOGLE");
  for (const image of packed.images) {
    form.append(
      "images",
      new Blob([new Uint8Array(image.bytes)], { type: image.contentType }),
      image.filename,
    );
  }
}

async function tagserviceFetch(
  path: string,
  apiKey: string,
  init?: RequestInit,
): Promise<Response> {
  const baseUrl = getSugarApiBaseUrl();
  if (!baseUrl) {
    throw new Error("Sugar API is not configured");
  }
  if (!apiKey.trim()) {
    throw new Error("Shop API key is not configured");
  }
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      ...(init?.headers || {}),
    },
  });
}

export async function startTagserviceAsyncJob(
  apiKey: string,
  packed: DecorAiPackedCommand,
): Promise<{ jobId: string }> {
  const form = new FormData();
  appendPackedForm(form, packed);
  const response = await tagserviceFetch(
    "/api/shopify/pdp/commands/with-files-async",
    apiKey,
    { method: "POST", body: form },
  );
  const data = (await response.json().catch(() => ({}))) as DecorAiJobResponse;
  if (!response.ok || !data.jobId) {
    throw new Error(
      data.error || `Tagservice async start failed (${response.status})`,
    );
  }
  return { jobId: data.jobId };
}

export async function startTagservicePipelineJob(
  apiKey: string,
  packed: ShopifyPdpPackedPipeline,
): Promise<{ jobId: string }> {
  const response = await tagserviceFetch(
    "/api/shopify/pdp/pipelines/run-async",
    apiKey,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(packed.input),
    },
  );
  const data = (await response.json().catch(() => ({}))) as DecorAiJobResponse;
  if (!response.ok || !data.jobId) {
    throw new Error(
      data.error || `Tagservice pipeline start failed (${response.status})`,
    );
  }
  return { jobId: data.jobId };
}

export async function getTagserviceJob(
  apiKey: string,
  jobId: string,
): Promise<DecorAiJobResponse> {
  const response = await tagserviceFetch(
    `/api/shopify/pdp/jobs/${encodeURIComponent(jobId)}`,
    apiKey,
  );
  const data = (await response.json().catch(() => ({}))) as DecorAiJobResponse;
  if (response.status === 404) {
    return { jobId, status: "failed", error: data.error || "Job not found" };
  }
  if (!response.ok) {
    throw new Error(
      data.error || `Tagservice job read failed (${response.status})`,
    );
  }
  return { ...data, jobId: data.jobId || jobId };
}

export async function runTagservicePackedCommand(
  apiKey: string,
  packed: DecorAiPackedCommand,
): Promise<GenerateImageResponse> {
  const started = await startTagserviceAsyncJob(apiKey, packed);
  return pollTagserviceJob(apiKey, started.jobId, packed.products);
}

export async function runTagservicePipeline(
  apiKey: string,
  packed: ShopifyPdpPackedPipeline,
): Promise<GenerateImageResponse> {
  const started = await startTagservicePipelineJob(apiKey, packed);
  return pollTagserviceJob(apiKey, started.jobId, packed.products);
}

async function pollTagserviceJob(
  apiKey: string,
  jobId: string,
  products: ShopifyPdpPackedPipeline["products"],
): Promise<GenerateImageResponse> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < SYNC_MAX_MS) {
    const job = await getTagserviceJob(apiKey, jobId);
    const result = jobToGenerateResponse(job, products);
    if (result.status === "completed" || result.status === "failed") {
      if (result.status === "failed") {
        throw new Error(result.message || "Tagservice generate failed");
      }
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, SYNC_POLL_MS));
  }
  throw new Error("Tagservice generate timed out");
}

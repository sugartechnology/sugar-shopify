import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  generateFailureResponse,
  prepareGenerateFromRequest,
} from "../services/prepare-generate.server";
import { packShopifyPdpPipeline } from "../services/decor-ai-client.server";
import { rememberDecorAiJob } from "../services/decor-ai-job-context.server";
import { startTagservicePipelineJob } from "../services/tagservice-pdp.server";
import {
  getShopApiKey,
  isSugarApiMockMode,
  mockGenerateResponse,
  normalizeProductsForApi,
} from "../services/sugar-api.server";

async function startJob(request: Request) {
  const prepared = await prepareGenerateFromRequest(request);
  if (!prepared.ok) return prepared.response;

  const generateRequest = {
    ...prepared.request,
    products: normalizeProductsForApi(prepared.request.products || []),
  };

  if (isSugarApiMockMode(prepared.config)) {
    const mock = mockGenerateResponse(generateRequest);
    rememberDecorAiJob(
      mock.generationId,
      prepared.shop,
      mock.products,
      mock.imageUrl,
    );
    return json(
      {
        jobId: mock.generationId,
        generationId: mock.generationId,
        imageUrl: mock.imageUrl,
        thumbnailUrl: mock.thumbnailUrl,
        status: "completed",
        message: mock.message,
        products: mock.products,
      },
      { status: 202 },
    );
  }

  const apiKey = getShopApiKey(prepared.config);
  if (!apiKey) {
    return json(
      {
        status: "failed",
        message: "Shop API key is not configured",
        products: [],
      },
      { status: 401 },
    );
  }

  const packed = packShopifyPdpPipeline(
    generateRequest,
    `shopify-${crypto.randomUUID()}`,
  );
  const started = await startTagservicePipelineJob(apiKey, packed);
  rememberDecorAiJob(started.jobId, prepared.shop, packed.products, undefined, apiKey);

  return json(
    {
      jobId: started.jobId,
      generationId: started.jobId,
      imageUrl: "",
      status: "processing",
      products: packed.products,
    },
    { status: 202 },
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method !== "POST") {
    return json(
      { status: "failed", message: "Use POST to start a generate job", products: [] },
      { status: 405 },
    );
  }
  try {
    return await startJob(request);
  } catch (error) {
    return generateFailureResponse(error);
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    return await startJob(request);
  } catch (error) {
    return generateFailureResponse(error);
  }
};

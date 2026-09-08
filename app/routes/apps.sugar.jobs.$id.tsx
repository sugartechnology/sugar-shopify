import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { jobToGenerateResponse } from "../services/decor-ai-client.server";
import { getDecorAiJobContext } from "../services/decor-ai-job-context.server";
import { getTagserviceJob } from "../services/tagservice-pdp.server";
import { isSugarApiMockMode } from "../services/sugar-api.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.public.appProxy(request);
    if (!session) {
      return json(
        { status: "failed", message: "Unauthorized", products: [] },
        { status: 401 },
      );
    }

    const id = String(params.id ?? "").trim();
    if (!id) {
      return json(
        { status: "failed", message: "Job id is required", products: [] },
        { status: 400 },
      );
    }

    const context = getDecorAiJobContext(id, session.shop);
    if (!context) {
      return json(
        { jobId: id, status: "failed", message: "Job not found", products: [] },
        { status: 404 },
      );
    }

    if (isSugarApiMockMode() || id.startsWith("mock-")) {
      return json({
        jobId: id,
        generationId: id,
        imageUrl: context.imageUrl ?? "",
        thumbnailUrl: context.imageUrl ?? "",
        status: "completed",
        products: context.products,
      });
    }

    if (!context.apiKey) {
      return json(
        {
          jobId: id,
          status: "failed",
          message: "Shop API key is not configured",
          products: context.products,
        },
        { status: 401 },
      );
    }

    const job = await getTagserviceJob(context.apiKey, id);
    return json({
      jobId: id,
      ...jobToGenerateResponse(job, context.products),
    });
  } catch (error) {
    console.error("[sugar-jobs]", error);
    return json(
      {
        status: "failed",
        message:
          error instanceof Error ? error.message : "Failed to read generate job",
        products: [],
      },
      { status: 500 },
    );
  }
};

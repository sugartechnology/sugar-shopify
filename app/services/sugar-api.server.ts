import type {
  DesignProductInput,
  DesignProductOutput,
  GenerateImageRequest,
  GenerateImageResponse,
  ShopConfig,
} from "../types/sugar";
import { BLANK_DESIGN_IMAGE } from "../types/sugar";
import { packDecorAiCommand } from "./decor-ai-client.server";
import {
  getSugarApiBaseUrl,
  isTagserviceConfigured,
  runTagservicePackedCommand,
} from "./tagservice-pdp.server";

export { getSugarApiBaseUrl };

/**
 * Max images per product in the AI payload (not a global cap).
 * Fewer than 3 available images are sent as-is.
 */
export const MAX_PRODUCT_IMAGES = 3;

export function normalizeCdnUrl(url: string | undefined): string {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

export function normalizeProductsForApi(
  products: DesignProductInput[],
): DesignProductInput[] {
  return products.map((product) => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    const push = (url: string | undefined) => {
      const normalized = normalizeCdnUrl(url);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      ordered.push(normalized);
    };

    push(product.imageUrl);
    for (const url of product.images || []) {
      push(url);
    }

    const limited = ordered.slice(0, MAX_PRODUCT_IMAGES);
    const quantity =
      typeof product.quantity === "number" && product.quantity >= 1
        ? Math.min(99, Math.floor(product.quantity))
        : 1;

    return {
      ...product,
      quantity,
      imageUrl: limited[0] ?? "",
      images: limited,
    };
  });
}

export function isSugarApiMockMode(_config?: ShopConfig): boolean {
  if (process.env.SUGAR_API_MOCK === "true") {
    return true;
  }
  return !isTagserviceConfigured();
}

export function getShopApiKey(config: ShopConfig): string {
  return (config.sugarApiKey ?? "").trim();
}

function mockImageUrl(request: GenerateImageRequest): string {
  if (request.roomImageBase64) {
    return `data:image/jpeg;base64,${request.roomImageBase64}`;
  }
  return BLANK_DESIGN_IMAGE;
}

export function mockGenerateResponse(
  request: GenerateImageRequest,
): GenerateImageResponse {
  const generationId = `mock-${Date.now()}`;
  const imageUrl = mockImageUrl(request);

  const products: DesignProductOutput[] = (request.products || []).map(
    (p) => ({
      productId: p.productId,
      variantId: p.variantId,
      title: p.title,
      price: p.price,
      currency: p.currency || "TRY",
      imageUrl: p.imageUrl || p.images?.[0] || "",
      selectedByDefault: true,
    }),
  );

  return {
    generationId,
    imageUrl,
    thumbnailUrl: imageUrl,
    status: "completed",
    message: "Demo mod — gerçek AI yakında",
    products,
  };
}

export async function generateProductImage(
  config: ShopConfig,
  request: GenerateImageRequest,
): Promise<GenerateImageResponse> {
  if (isSugarApiMockMode(config)) {
    await new Promise((r) => setTimeout(r, 1200));
    return mockGenerateResponse(request);
  }

  const apiKey = getShopApiKey(config);
  if (!apiKey) {
    throw new Error("Shop API key is not configured");
  }

  const packed = await packDecorAiCommand(
    {
      ...request,
      products: normalizeProductsForApi(request.products || []),
    },
    `shopify-${crypto.randomUUID()}`,
  );
  return runTagservicePackedCommand(apiKey, packed);
}

import type {
  DesignProductOutput,
  GenerateImageRequest,
  GenerateImageResponse,
  ShopConfig,
} from "../types/sugar";
import { BLANK_DESIGN_IMAGE } from "../types/sugar";

export function isSugarApiMockMode(config: ShopConfig): boolean {
  return (
    process.env.SUGAR_API_MOCK !== "false" || !config.sugarApiBaseUrl.trim()
  );
}

function mockImageUrl(request: GenerateImageRequest): string {
  if (request.roomImageBase64) {
    return `data:image/jpeg;base64,${request.roomImageBase64}`;
  }
  return BLANK_DESIGN_IMAGE;
}

function mockResponse(request: GenerateImageRequest): GenerateImageResponse {
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
  // Mock when SUGAR_API_MOCK !== "false" or sugarApiBaseUrl is empty.
  // Real API: set SUGAR_API_MOCK=false in .env and configure admin settings.
  if (isSugarApiMockMode(config)) {
    await new Promise((r) => setTimeout(r, 1200));
    return mockResponse(request);
  }

  const endpoint = `${config.sugarApiBaseUrl.replace(/\/$/, "")}/api/shopify/pdp/generate`;
  const formData = new FormData();
  formData.append("shopDomain", request.shopDomain);
  formData.append("products", JSON.stringify(request.products));

  if (request.roomImageBase64) {
    const binary = Buffer.from(request.roomImageBase64, "base64");
    const blob = new Blob([binary], { type: "image/jpeg" });
    formData.append(
      "roomImage",
      blob,
      request.roomImageName || "room.jpg",
    );
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.sugarApiKey}`,
      ...(config.sugarCompanyId
        ? { "X-Company-Id": config.sugarCompanyId }
        : {}),
    },
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sugar API error (${response.status}): ${text}`);
  }

  return (await response.json()) as GenerateImageResponse;
}

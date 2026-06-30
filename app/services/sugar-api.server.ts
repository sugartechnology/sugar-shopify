import type {
  DesignProductOutput,
  GenerateImageRequest,
  GenerateImageResponse,
  ShopConfig,
} from "../types/sugar";
import { BLANK_DESIGN_IMAGE } from "../types/sugar";

export function getSugarApiBaseUrl(): string {
  return (process.env.SUGAR_API_BASE_URL ?? "").trim();
}

export function isSugarApiMockMode(config: ShopConfig): boolean {
  if (!config.sugarApiKey.trim() || !getSugarApiBaseUrl()) {
    return true;
  }
  return process.env.SUGAR_API_MOCK === "true";
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
  // Mock when SUGAR_API_MOCK=true, API key missing, or SUGAR_API_BASE_URL unset.
  if (isSugarApiMockMode(config)) {
    await new Promise((r) => setTimeout(r, 1200));
    return mockResponse(request);
  }

  // --- Gerçek AI server çağrısı ---
  // sugarApiKey: admin'den kaydedilen key (senin AI server'ında validate edilir)
  // Biz burada key ÜRETMİYORUZ ve VALIDATE ETMİYORUZ — sadece header'a koyuyoruz.
  const endpoint = `${getSugarApiBaseUrl().replace(/\/$/, "")}/api/shopify/pdp/generate`;
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
    },
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sugar API error (${response.status}): ${text}`);
  }

  return (await response.json()) as GenerateImageResponse;
}

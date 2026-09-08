import {
  buildPlaceProductsPrompt,
  toOutputProducts,
} from "./decor-ai-prompt.server";
import type {
  DesignProductInput,
  DesignProductOutput,
  GenerateImageRequest,
  GenerateImageResponse,
} from "../types/sugar";

const MAX_PRODUCT_IMAGES = 3;

export type DecorAiJobStatus = "processing" | "completed" | "failed";

export type DecorAiJobResponse = {
  jobId?: string;
  status?: DecorAiJobStatus;
  imageUrl?: string | null;
  imageDataBase64?: string | null;
  mimeType?: string | null;
  error?: string | null;
};

export type DecorAiPackedCommand = {
  jobId: string;
  shopDomain: string;
  prompt: string;
  images: Array<{ bytes: Buffer; filename: string; contentType: string }>;
  products: DesignProductOutput[];
};

function normalizeCdnUrl(url: string | undefined): string {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn("[decor-ai] image download failed", url, response.status);
      return null;
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    console.warn("[decor-ai] image download failed", url, error);
    return null;
  }
}

async function loadProductImages(product: DesignProductInput): Promise<Buffer[]> {
  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined) => {
    const url = normalizeCdnUrl(raw);
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };
  push(product.imageUrl);
  for (const image of product.images || []) push(image);

  const loaded: Buffer[] = [];
  for (const url of urls.slice(0, MAX_PRODUCT_IMAGES)) {
    const bytes = await downloadImage(url);
    if (bytes?.length) loaded.push(bytes);
  }
  return loaded;
}

export async function packDecorAiCommand(
  request: GenerateImageRequest,
  jobId = crypto.randomUUID(),
): Promise<DecorAiPackedCommand> {
  const products = request.products || [];
  const images: DecorAiPackedCommand["images"] = [];
  const loadedCounts: number[] = [];

  if (request.roomImageBase64) {
    images.push({
      bytes: Buffer.from(request.roomImageBase64, "base64"),
      filename: request.roomImageName || "room.jpg",
      contentType: "image/jpeg",
    });
  }

  if (request.mockupImageBytes?.length) {
    images.push({
      bytes: Buffer.from(request.mockupImageBytes),
      filename: request.mockupImageName || "mockup.jpg",
      contentType: "image/jpeg",
    });
  }

  for (const [index, product] of products.entries()) {
    const loaded = await loadProductImages(product);
    loadedCounts[index] = loaded.length;
    loaded.forEach((bytes, photoIndex) => {
      images.push({
        bytes,
        filename: `product-${index + 1}-${photoIndex + 1}.jpg`,
        contentType: "image/jpeg",
      });
    });
  }

  return {
    jobId,
    shopDomain: request.shopDomain,
    prompt: buildPlaceProductsPrompt(products, {
      hasMockup: Boolean(request.mockupImageBytes?.length),
      loadedImageCounts: loadedCounts,
    }),
    images,
    products: toOutputProducts(products),
  };
}

export function jobToGenerateResponse(
  job: DecorAiJobResponse,
  products: DesignProductOutput[],
): GenerateImageResponse {
  const jobId = job.jobId || "";
  const imageUrl =
    (job.imageUrl || "").trim() ||
    (job.imageDataBase64
      ? `data:${job.mimeType || "image/jpeg"};base64,${job.imageDataBase64}`
      : "");
  if (job.status === "completed" && imageUrl) {
    return {
      generationId: jobId,
      imageUrl,
      thumbnailUrl: imageUrl,
      status: "completed",
      products,
    };
  }
  return {
    generationId: jobId,
    imageUrl: "",
    status: job.status === "failed" ? "failed" : "processing",
    message: job.error || undefined,
    products,
  };
}

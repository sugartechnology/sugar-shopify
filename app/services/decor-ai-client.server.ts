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

export type ShopifyPdpPipelineImage = {
  contentBase64: string;
  mimeType: string;
  name: string;
};

export type ShopifyPdpPipelineInput = {
  prompt: string;
  roomImage: ShopifyPdpPipelineImage | "";
  roomImageUrl: string;
  mockupImage: ShopifyPdpPipelineImage | "";
  mockupImageUrl: string;
  products: Array<{
    productId: string;
    variantId: string;
    title: string;
    price: string;
    currency: string;
    description: string;
    imageUrl: string;
    images: string[];
    quantity: number;
    position: { x: number; y: number; scale?: number } | null;
    productDetails: DesignProductInput["productDetails"];
  }>;
  platform: string;
  filename: string;
  folder: string;
  jobId: string;
  shopDomain: string;
};

export type ShopifyPdpPackedPipeline = {
  jobId: string;
  shopDomain: string;
  input: ShopifyPdpPipelineInput;
  products: DesignProductOutput[];
};

function guessImageMime(name?: string): string {
  const text = (name || "").toLowerCase();
  if (text.endsWith(".png")) return "image/png";
  if (text.endsWith(".webp")) return "image/webp";
  if (text.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

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

export function packShopifyPdpPipeline(
  request: GenerateImageRequest,
  jobId = crypto.randomUUID(),
): ShopifyPdpPackedPipeline {
  const products = request.products || [];
  const roomImage: ShopifyPdpPipelineImage | "" = request.roomImageBase64
    ? {
        contentBase64: request.roomImageBase64,
        mimeType: guessImageMime(request.roomImageName),
        name: request.roomImageName || "room.jpg",
      }
    : "";
  const mockupImage: ShopifyPdpPipelineImage | "" = request.mockupImageBytes?.length
    ? {
        contentBase64: Buffer.from(request.mockupImageBytes).toString("base64"),
        mimeType: guessImageMime(request.mockupImageName),
        name: request.mockupImageName || "mockup.jpg",
      }
    : "";

  return {
    jobId,
    shopDomain: request.shopDomain,
    products: toOutputProducts(products),
    input: {
      prompt: "",
      roomImage,
      roomImageUrl: "",
      mockupImage,
      mockupImageUrl: "",
      products: products.map((product) => ({
        productId: product.productId || "",
        variantId: product.variantId || "",
        title: product.title || "",
        price: product.price || "",
        currency: product.currency || "TRY",
        description: product.description || "",
        imageUrl: normalizeCdnUrl(product.imageUrl || product.images?.[0]),
        images: (product.images || [])
          .map((url) => normalizeCdnUrl(url))
          .filter(Boolean),
        quantity:
          typeof product.quantity === "number" && product.quantity >= 1
            ? Math.min(99, Math.floor(product.quantity))
            : 1,
        position: product.position
          ? {
              x: product.position.x,
              y: product.position.y,
              ...(typeof product.position.scale === "number"
                ? { scale: product.position.scale }
                : {}),
            }
          : null,
        productDetails: product.productDetails || [],
      })),
      platform: "GOOGLE",
      filename: `${jobId}.png`,
      folder: "ai-command-logs/responses/",
      jobId,
      shopDomain: request.shopDomain,
    },
  };
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

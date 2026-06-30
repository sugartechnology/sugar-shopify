import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { generateProductImage } from "../services/sugar-api.server";
import { getShopConfig } from "../services/shop-config.server";
import type { DesignProductInput, GenerateImageRequest } from "../types/sugar";

function parseProducts(raw: unknown): DesignProductInput[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as DesignProductInput[];
    } catch {
      return [];
    }
  }
  if (Array.isArray(raw)) return raw as DesignProductInput[];
  return [];
}

async function handleGenerate(request: Request) {
  /**
   * Storefront: POST /apps/sugar/generate (App Proxy)
   * Shopify isteği imzalar; kütüphane imzayı + shop session'ını validate eder.
   * session.shop → hangi mağazadan geldi (AI'ya shopDomain olarak gider)
   * admin → Shopify Admin API client (metafield okumak için)
   */
  const { admin, session } = await authenticate.public.appProxy(request);
  const config = await getShopConfig(admin);
  const contentType = request.headers.get("content-type") || "";

  let products: DesignProductInput[] = [];
  let roomImageBase64: string | undefined;
  let roomImageName: string | undefined;

  if (contentType.includes("application/json")) {
    const body = await request.json();
    products = parseProducts(body.products);
    roomImageBase64 = body.roomImageBase64;
    roomImageName = body.roomImageName;
  } else if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    products = parseProducts(formData.get("products"));
    roomImageBase64 = String(formData.get("roomImageBase64") ?? "") || undefined;
    roomImageName = String(formData.get("roomImageName") ?? "") || undefined;
  }

  const generateRequest: GenerateImageRequest = {
    shopDomain: session.shop,
    products,
    roomImageBase64,
    roomImageName,
  };

  const result = await generateProductImage(config, generateRequest);
  return json(result);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    return await handleGenerate(request);
  } catch (error) {
    return json(
      {
        status: "failed",
        message:
          error instanceof Error ? error.message : "Bilinmeyen hata oluştu",
        products: [],
      },
      { status: 500 },
    );
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    return await handleGenerate(request);
  } catch (error) {
    return json(
      {
        status: "failed",
        message:
          error instanceof Error ? error.message : "Bilinmeyen hata oluştu",
        products: [],
      },
      { status: 500 },
    );
  }
};

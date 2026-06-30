import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { generateProductImage } from "../services/sugar-api.server";
import { resolveDesignProductsFromShopify } from "../services/resolve-shopify-products.server";
import { getShopConfig } from "../services/shop-config.server";
import type {
  DesignProductSelection,
  GenerateImageRequest,
} from "../types/sugar";

function parseSelections(raw: unknown): DesignProductSelection[] {
  if (!raw) return [];
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const productId = String(row.productId ?? "").trim();
      const variantId = String(row.variantId ?? "").trim();
      if (!productId || !variantId) return null;
      return {
        productId,
        variantId,
        isPrimary: row.isPrimary === true,
      } satisfies DesignProductSelection;
    })
    .filter((item): item is DesignProductSelection => item !== null);
}

async function handleGenerate(request: Request) {
  const { admin, session } = await authenticate.public.appProxy(request);
  const config = await getShopConfig(admin);
  const contentType = request.headers.get("content-type") || "";

  let selections: DesignProductSelection[] = [];
  let roomImageBase64: string | undefined;
  let roomImageName: string | undefined;

  if (contentType.includes("application/json")) {
    const body = await request.json();
    selections = parseSelections(body.selections);
    roomImageBase64 = body.roomImageBase64;
    roomImageName = body.roomImageName;
  } else if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    selections = parseSelections(formData.get("selections"));
    roomImageBase64 = String(formData.get("roomImageBase64") ?? "") || undefined;
    roomImageName = String(formData.get("roomImageName") ?? "") || undefined;
  }

  if (selections.length === 0) {
    return json(
      {
        status: "failed",
        message: "At least one product selection is required",
        products: [],
      },
      { status: 400 },
    );
  }

  const products = await resolveDesignProductsFromShopify(admin, selections);

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

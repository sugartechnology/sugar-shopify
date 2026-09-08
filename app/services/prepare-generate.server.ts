import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { resolveDesignProductsFromShopify } from "./resolve-shopify-products.server";
import { getShopConfig } from "./shop-config.server";
import type {
  DesignProductSelection,
  GenerateImageRequest,
  ProductDetailMetafieldRef,
  ShopConfig,
} from "../types/sugar";

export type PreparedGenerate =
  | { ok: false; response: ReturnType<typeof json> }
  | {
      ok: true;
      shop: string;
      config: ShopConfig;
      request: GenerateImageRequest;
    };

function normalizeQuantity(raw: unknown): number {
  const qty = Number(raw);
  if (!Number.isFinite(qty) || qty < 1) return 1;
  return Math.min(99, Math.floor(qty));
}

export function parseMetafieldRefs(raw: unknown): ProductDetailMetafieldRef[] {
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

  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const namespace = String(row.namespace ?? "").trim();
    const key = String(row.key ?? "").trim();
    if (!namespace || !key) return [];
    const label = String(row.label ?? "").trim();
    return [{ namespace, key, ...(label ? { label } : {}) }];
  });
}

export function parseSelections(raw: unknown): DesignProductSelection[] {
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

  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const productId = String(row.productId ?? "").trim();
    const variantId = String(row.variantId ?? "").trim();
    if (!productId || !variantId) return [];

    const pos = row.position as Record<string, unknown> | null | undefined;
    const x = Number(pos?.x);
    const y = Number(pos?.y);

    return [
      {
        productId,
        variantId,
        isPrimary: row.isPrimary === true,
        quantity: normalizeQuantity(row.quantity),
        position:
          Number.isFinite(x) && Number.isFinite(y)
            ? {
                x,
                y,
                scale: Number.isFinite(Number(pos?.scale))
                  ? Number(pos?.scale)
                  : undefined,
              }
            : null,
      },
    ];
  });
}

export async function prepareGenerateFromRequest(
  request: Request,
): Promise<PreparedGenerate> {
  const { admin, session } = await authenticate.public.appProxy(request);
  const config = await getShopConfig(admin);
  const formData = await request.formData();

  const selections = parseSelections(formData.get("selections"));
  if (selections.length === 0) {
    return {
      ok: false,
      response: json(
        {
          status: "failed",
          message: "At least one product selection is required",
          products: [],
        },
        { status: 400 },
      ),
    };
  }

  const metafieldRefs = parseMetafieldRefs(
    formData.get("productDetailMetafields"),
  );
  const discoveryNamespace =
    String(formData.get("productDetailMetafieldNamespace") ?? "").trim() ||
    "custom";
  const products = await resolveDesignProductsFromShopify(
    admin,
    selections,
    metafieldRefs,
    discoveryNamespace,
  );

  let mockupImageBytes: Buffer | undefined;
  const mockupPart = formData.get("mockupImage");
  if (mockupPart instanceof File && mockupPart.size > 0) {
    mockupImageBytes = Buffer.from(await mockupPart.arrayBuffer());
  }

  return {
    ok: true,
    shop: session.shop,
    config,
    request: {
      shopDomain: session.shop,
      products,
      roomImageBase64:
        String(formData.get("roomImageBase64") ?? "") || undefined,
      roomImageName: String(formData.get("roomImageName") ?? "") || undefined,
      roomImageWidth: Number(formData.get("roomImageWidth")) || undefined,
      roomImageHeight: Number(formData.get("roomImageHeight")) || undefined,
      roomImageAspectRatio:
        Number(formData.get("roomImageAspectRatio")) || undefined,
      mockupImageBytes,
      mockupImageName:
        mockupPart instanceof File ? mockupPart.name || "mockup.jpg" : undefined,
      prompt: String(formData.get("prompt") ?? "").trim() || undefined,
      enrichment: (() => {
        const raw = formData.get("enrichment");
        if (!raw) return undefined;
        try {
          const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
          if (!Array.isArray(parsed)) return undefined;
          return parsed.map(String).filter(Boolean);
        } catch {
          return undefined;
        }
      })(),
      isRedesign: String(formData.get("isRedesign") ?? "") === "true",
    },
  };
}

export function generateFailureResponse(error: unknown) {
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

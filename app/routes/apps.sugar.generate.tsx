import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { generateProductImage } from "../services/sugar-api.server";
import { resolveDesignProductsFromShopify } from "../services/resolve-shopify-products.server";
import { getShopConfig } from "../services/shop-config.server";
import type { DesignProductSelection } from "../types/sugar";

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

async function handleGenerate(request: Request) {
  const { admin, session } = await authenticate.public.appProxy(request);
  const config = await getShopConfig(admin);
  const formData = await request.formData();

  const selections = parseSelections(formData.get("selections"));
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

  let mockupImageBytes: Buffer | undefined;
  const mockupPart = formData.get("mockupImage");
  if (mockupPart instanceof File && mockupPart.size > 0) {
    mockupImageBytes = Buffer.from(await mockupPart.arrayBuffer());
  }

  const result = await generateProductImage(config, {
    shopDomain: session.shop,
    products,
    roomImageBase64:
      String(formData.get("roomImageBase64") ?? "") || undefined,
    roomImageName: String(formData.get("roomImageName") ?? "") || undefined,
    mockupImageBytes,
    mockupImageName:
      mockupPart instanceof File ? mockupPart.name || "mockup.jpg" : undefined,
  });

  return json(result);
}

function handleError(error: unknown) {
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    return await handleGenerate(request);
  } catch (error) {
    return handleError(error);
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    return await handleGenerate(request);
  } catch (error) {
    return handleError(error);
  }
};

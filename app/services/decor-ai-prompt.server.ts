import type { DesignProductInput } from "../types/sugar";

const MAX_DESCRIPTION_PROMPT_LENGTH = 600;

const PLACE_PRODUCTS_PROMPT = `**ROLE**: Hyper-Realistic Virtual Staging Expert.

**ATTACHED IMAGES (strict order — each label matches the upload sequence after the room photo)**:
%s

**PRODUCTS TO PLACE**:
%s

**PRODUCT DETAILS (use for material, size, color, and other merchandising context)**:
%s

**PLACEMENT COORDINATES** (normalized on the room image; x/y = product center, 0.0 = left/top, 1.0 = right/bottom; scale = product width as a fraction of room width):
%s

**STRICT CONSTRAINTS**:
1. Image 1 (ROOM) is the only immutable background — preserve walls, floor, windows, ceiling, and lighting.
2. If a MOCKUP image is provided, it shows the visitor's intended layout (rough overlays on the room). Match that layout closely in the final render.
3. PRODUCT CUTOUT images are reference photos only — extract each product's appearance from them; do not use them as the background.
4. Respect the placement coordinates, quantity, and mockup layout for position and scale.
5. Cast realistic contact shadows and perspective on the floor.

**OUTPUT**: One photorealistic staged room image.
`;

function formatTemplate(template: string, values: string[]): string {
  let index = 0;
  return template.replace(/%s/g, () => values[index++] ?? "");
}

function resolveQuantity(product: DesignProductInput): number {
  if (typeof product.quantity !== "number" || product.quantity < 1) return 1;
  return Math.min(product.quantity, 99);
}

function formatProductDetails(product: DesignProductInput): string {
  if (!product.productDetails?.length) return "";
  const parts: string[] = [];
  for (const detail of product.productDetails) {
    if (!detail?.value?.trim()) continue;
    const label = detail.label?.trim() || detail.key;
    parts.push(`${label}=${detail.value.trim()}`);
  }
  return parts.join(", ");
}

function sanitizeDescription(raw: string | undefined): string {
  if (!raw?.trim()) return "";
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length <= MAX_DESCRIPTION_PROMPT_LENGTH) return text;
  return `${text.slice(0, MAX_DESCRIPTION_PROMPT_LENGTH)}…`;
}

function describeHorizontal(x: number): string {
  if (x < 0.33) return "left area";
  if (x > 0.66) return "right area";
  return "center horizontally";
}

function describeVertical(y: number): string {
  if (y < 0.33) return "upper area";
  if (y > 0.66) return "lower area";
  return "middle height";
}

export function buildPlaceProductsPrompt(
  products: DesignProductInput[],
  options: { hasMockup: boolean; loadedImageCounts: number[] },
): string {
  let imageSequence =
    "   Image 1: ROOM — original room photograph uploaded by the visitor (immutable background).\n";
  let nextAttachmentIndex = 2;

  if (options.hasMockup) {
    imageSequence += `   Image ${nextAttachmentIndex++}: MOCKUP — visitor composite (same room with products overlaid for layout preview only; not final quality). Replicate this spatial arrangement photorealistically.\n`;
  }

  let productLines = "";
  let productDetailsLines = "";
  let placementLines = "";

  products.forEach((product, index) => {
    const itemIndex = index + 1;
    const title = product.title?.trim() || "Product";
    const variantId = product.variantId?.trim() || "n/a";
    const quantity = resolveQuantity(product);
    const loadedCount = options.loadedImageCounts[index] ?? 0;

    for (let photoIndex = 1; photoIndex <= loadedCount; photoIndex += 1) {
      imageSequence += `   Image ${nextAttachmentIndex++}: PRODUCT CUTOUT — Item ${itemIndex} "${title}" (VariantId=${variantId}), reference photo ${photoIndex} — use for product shape/color/material only.\n`;
    }

    const detailsSummary = formatProductDetails(product);
    productLines += `\n   - Item ${itemIndex}: "${title}" (ProductId=${product.productId}, VariantId=${variantId}, Qty=${quantity}, ${loadedCount} reference photo(s)${
      detailsSummary ? `, Details: ${detailsSummary}` : ""
    })`;

    const description = sanitizeDescription(product.description);
    if (detailsSummary || description) {
      productDetailsLines += `\n   - Item ${itemIndex} "${title}":`;
      if (detailsSummary) {
        productDetailsLines += `\n     Attributes: ${detailsSummary}`;
      }
      if (description) {
        productDetailsLines += `\n     Description: ${description}`;
      }
    }

    if (
      product.position == null ||
      typeof product.position.x !== "number" ||
      typeof product.position.y !== "number"
    ) {
      placementLines += `\n   - Item ${itemIndex} "${title}": no coordinates (infer reasonable placement from mockup if available)${
        quantity > 1
          ? `; render exactly ${quantity} identical units`
          : ""
      }`;
      return;
    }

    const x = product.position.x;
    const y = product.position.y;
    const scale =
      typeof product.position.scale === "number" ? product.position.scale : 0.28;
    placementLines += `\n   - Item ${itemIndex} "${title}": center at x=${x.toFixed(3)} (${describeHorizontal(x)}), y=${y.toFixed(3)} (${describeVertical(y)}), width scale=${scale.toFixed(3)} (~${Math.round(scale * 100)}% of room width)${
      quantity > 1
        ? `; render exactly ${quantity} identical units at this position without overlapping unnaturally`
        : ""
    }`;
  });

  if (!options.hasMockup) {
    imageSequence += "   (No MOCKUP image — rely on PLACEMENT COORDINATES below for layout.)\n";
  }

  return formatTemplate(PLACE_PRODUCTS_PROMPT, [
    imageSequence,
    productLines,
    productDetailsLines || "   (none provided)",
    placementLines || "   (none provided)",
  ]);
}

export function toOutputProducts(products: DesignProductInput[]) {
  return products.map((product) => ({
    productId: product.productId || "",
    variantId: product.variantId || "",
    title: product.title || "",
    price: product.price || "",
    currency: product.currency || "TRY",
    imageUrl: product.imageUrl || product.images?.[0] || "",
    selectedByDefault: true,
  }));
}


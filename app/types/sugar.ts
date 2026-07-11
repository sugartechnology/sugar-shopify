export const SHOP_CONFIG_NAMESPACE = "sugar_shopify";

/** 1x1 transparent PNG — mock design output */
export const BLANK_DESIGN_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export type ThemePreset = "dawn" | "normod" | "custom";

/** Storefront tema token varsayılanları (custom preset) */
export const DEFAULT_SUGAR_THEME = {
  modalBgColor: "#ffffff",
  modalTextColor: "#121212",
  accentColor: "#c4a574",
  overlayColor: "rgba(0, 0, 0, 0.55)",
  modalRadius: 16,
  modalMaxWidth: 480,
  fontScale: 100,
} as const;

export interface ShopConfig {
  sugarApiKey: string;
  sugarApiKeyPrefix: string;
  buttonLabel: string;
  buttonHelperText: string;
  modalTitle: string;
  modalSubtitle: string;
  modalDescription: string;
  instructionTemplate: string;
  addDesignToCartLabel: string;
  loadingTitle: string;
  loadingSubtitle: string;
  productCollectionHandle: string;
  maxAdditionalProducts: number;
  themePreset: ThemePreset;
  triggerButtonClasses: string;
  aiButtonClasses: string;
  secondaryButtonClasses: string;
  primaryButtonClasses: string;
  modalPanelClasses: string;
  formFieldClasses: string;
  imagePropertyKey: string;
  generationIdPropertyKey: string;
  maxUploadSizeMb: number;
  customCss: string;
  heroImageUrl: string;
  headerIconUrl: string;
  skipProductSelection: boolean;
  modalBgColor: string;
  modalTextColor: string;
  accentColor: string;
  overlayColor: string;
  modalRadius: number;
  fontScale: number;
}

export const DEFAULT_SHOP_CONFIG: ShopConfig = {
  sugarApiKey: "",
  sugarApiKeyPrefix: "",
  buttonLabel: "Design Your Space with AI",
  buttonHelperText:
    "Odanın fotoğrafını yükle, bu ürünü kendi mekanında gör.",
  modalTitle: "Design Your Space",
  modalSubtitle: "AI destekli yerleşim önizlemesi",
  modalDescription:
    "Odanın bir fotoğrafını yükle. Yapay zeka {productTitle} ürününü senin mekanına yerleştirsin.",
  instructionTemplate:
    "Ürünleri seç, oda fotoğrafında sürükleyerek yerleştir.",
  addDesignToCartLabel: "Tasarımı Sepete Ekle",
  loadingTitle: "AI mekanını tasarlıyor...",
  loadingSubtitle: "Ürün ölçüleri ve ışık analiz ediliyor",
  productCollectionHandle: "",
  maxAdditionalProducts: 4,
  themePreset: "dawn",
  triggerButtonClasses: "",
  aiButtonClasses: "sugar-ai-btn",
  secondaryButtonClasses: "button button--secondary",
  primaryButtonClasses: "button button--primary",
  modalPanelClasses: "",
  formFieldClasses: "field",
  imagePropertyKey: "_sugar_design_image",
  generationIdPropertyKey: "_sugar_generation_id",
  maxUploadSizeMb: 10,
  customCss: "",
  heroImageUrl: "",
  headerIconUrl: "",
  skipProductSelection: false,
  modalBgColor: DEFAULT_SUGAR_THEME.modalBgColor,
  modalTextColor: DEFAULT_SUGAR_THEME.modalTextColor,
  accentColor: DEFAULT_SUGAR_THEME.accentColor,
  overlayColor: DEFAULT_SUGAR_THEME.overlayColor,
  modalRadius: DEFAULT_SUGAR_THEME.modalRadius,
  fontScale: DEFAULT_SUGAR_THEME.fontScale,
};

export const THEME_PRESET_CLASSES: Record<
  Exclude<ThemePreset, "custom">,
  Pick<
    ShopConfig,
    | "aiButtonClasses"
    | "secondaryButtonClasses"
    | "primaryButtonClasses"
    | "modalPanelClasses"
    | "formFieldClasses"
  >
> = {
  dawn: {
    aiButtonClasses: "sugar-ai-btn",
    secondaryButtonClasses: "button button--secondary",
    primaryButtonClasses: "button button--primary",
    modalPanelClasses: "",
    formFieldClasses: "field",
  },
  normod: {
    aiButtonClasses: "sugar-ai-btn",
    secondaryButtonClasses: "button button--secondary",
    primaryButtonClasses: "button button--primary",
    modalPanelClasses: "",
    formFieldClasses: "form-field",
  },
};

export interface ProductDetailMetafieldRef {
  namespace: string;
  key: string;
  label?: string;
}

export interface ProductMetafieldDetail {
  namespace: string;
  key: string;
  label?: string;
  value: string;
}

export interface ProductPlacement {
  /** Normalized center X on room image (0–1) */
  x: number;
  /** Normalized center Y on room image (0–1) */
  y: number;
  /** Product width as fraction of room image width */
  scale?: number;
}

export interface DesignProductSelection {
  productId: string;
  variantId: string;
  isPrimary?: boolean;
  quantity?: number;
  position?: ProductPlacement | null;
}

export interface DesignProductInput {
  productId: string;
  variantId: string;
  title: string;
  handle: string;
  price: string;
  currency: string;
  images: string[];
  imageUrl?: string;
  isPrimary?: boolean;
  quantity?: number;
  productDetails?: ProductMetafieldDetail[];
  position?: ProductPlacement | null;
}

export interface GenerateImageRequest {
  shopDomain: string;
  roomImageBase64?: string;
  roomImageName?: string;
  mockupImageName?: string;
  mockupImageBytes?: Buffer;
  products: DesignProductInput[];
}

export interface DesignProductOutput {
  productId: string;
  variantId: string;
  title: string;
  price: string;
  currency: string;
  imageUrl: string;
  selectedByDefault: boolean;
}

export interface GenerateImageResponse {
  generationId: string;
  imageUrl: string;
  thumbnailUrl?: string;
  status: "completed" | "processing" | "failed";
  message?: string;
  products: DesignProductOutput[];
}

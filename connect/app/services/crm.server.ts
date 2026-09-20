const SERVICE_SECRET_HEADER = "X-Service-Secret";

export type InstalledResponse = {
  companyId: string;
  companyName: string;
  shopDomain: string;
  shopGid?: string | null;
  status: string;
};

function crmBaseUrl() {
  return (process.env.CRM_BASE_URL || "").replace(/\/$/, "");
}

function serviceSecret() {
  return process.env.SHOPIFY_SERVICE_SECRET || "";
}

export async function notifyInstalled(input: {
  shopDomain: string;
  shopGid?: string | null;
  connectSessionId: string;
}): Promise<InstalledResponse> {
  const response = await fetch(`${crmBaseUrl()}/internal/shopify/shops/installed`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [SERVICE_SECRET_HEADER]: serviceSecret(),
    },
    body: JSON.stringify({
      shopDomain: input.shopDomain,
      shopGid: input.shopGid,
      connectSessionId: input.connectSessionId,
      installedAt: new Date().toISOString(),
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(typeof body?.message === "string" ? body.message : "CRM install callback failed");
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return body as InstalledResponse;
}

export async function notifyUninstalled(shopDomain: string) {
  const response = await fetch(`${crmBaseUrl()}/internal/shopify/shops/uninstalled`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [SERVICE_SECRET_HEADER]: serviceSecret(),
    },
    body: JSON.stringify({ shopDomain }),
  });
  if (!response.ok && response.status !== 204) {
    throw new Error("CRM uninstall callback failed");
  }
}


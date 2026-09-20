import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { timingSafeEqual } from "node:crypto";
import { upsertCatalog, type CatalogUpsertRequest } from "../services/catalog.server";

function secretsMatch(left: string, right: string) {
  const expected = Buffer.from(left, "utf8");
  const actual = Buffer.from(right, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }
  const configured = process.env.SHOPIFY_SERVICE_SECRET || "";
  const provided = request.headers.get("X-Service-Secret") || "";
  if (!configured || !secretsMatch(configured, provided)) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as CatalogUpsertRequest;
  if (!body?.shopDomain || !body.product) {
    return json({ error: "Invalid catalog payload" }, { status: 400 });
  }

  try {
    const result = await upsertCatalog(body);
    return json(result);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "APP_NOT_INSTALLED" || (error instanceof Error && error.message === "APP_NOT_INSTALLED")) {
      return json({ error: "APP_NOT_INSTALLED" }, { status: 404 });
    }
    return json(
      { error: error instanceof Error ? error.message : "Catalog upsert failed" },
      { status: 500 },
    );
  }
};

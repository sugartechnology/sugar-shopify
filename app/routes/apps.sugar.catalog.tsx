import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { resolveCatalogGroups } from "../services/resolve-catalog-groups.server";

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.public.appProxy(request);
    if (!session) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const ids = parseIds(url.searchParams.get("ids"));
    if (!ids.length) {
      return json({ data: { groups: [] } });
    }

    const groups = await resolveCatalogGroups(session, ids);
    return json({ data: { groups } });
  } catch (error) {
    console.error("[sugar-catalog]", error);
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to resolve catalog groups",
        data: { groups: [] },
      },
      { status: 500 },
    );
  }
};

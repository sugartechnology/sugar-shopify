export type CatalogChildCollection = {
  id: string;
  handle: string;
  title: string;
};

export type CatalogGroup = {
  id: string;
  handle: string;
  title: string;
  children: CatalogChildCollection[];
};

type CatalogSession = {
  shop: string;
  accessToken?: string;
};

type CollectionNode = {
  id?: string;
  handle?: string | null;
  title?: string | null;
  sources?: Array<{
    __typename?: string;
    collections?: Array<{
      id?: string;
      handle?: string | null;
      title?: string | null;
    } | null> | null;
  } | null> | null;
};

const CATALOG_GROUPS_QUERY = `#graphql
  query SugarCatalogGroups($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Collection {
        id
        handle
        title
        sources {
          __typename
          ... on CollectionSubCollectionsSource {
            collections {
              id
              handle
              title
            }
          }
        }
      }
    }
  }
`;

const COLLECTIONS_API_VERSION = "2026-07";
export const CATALOG_GROUPS_TTL_MS = 2 * 60 * 1000;

type CatalogCacheEntry = {
  groups: CatalogGroup[];
  expiresAt: number;
};

const catalogGroupsCache = new Map<string, CatalogCacheEntry>();

export function catalogGroupsCacheKey(shop: string, gids: string[]): string {
  return `${shop}|${gids.join(",")}`;
}

function readCatalogGroupsCache(key: string): CatalogGroup[] | null {
  const entry = catalogGroupsCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    catalogGroupsCache.delete(key);
    return null;
  }
  return entry.groups;
}

function writeCatalogGroupsCache(key: string, groups: CatalogGroup[]) {
  catalogGroupsCache.set(key, {
    groups,
    expiresAt: Date.now() + CATALOG_GROUPS_TTL_MS,
  });
}

export function clearCatalogGroupsCache() {
  catalogGroupsCache.clear();
}

function toCollectionGid(raw: string): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  if (value.startsWith("gid://shopify/Collection/")) return value;
  if (/^\d+$/.test(value)) return `gid://shopify/Collection/${value}`;
  return null;
}

function mapChild(
  node:
    | { id?: string; handle?: string | null; title?: string | null }
    | null
    | undefined,
): CatalogChildCollection | null {
  if (!node?.id || !node.handle) return null;
  return {
    id: String(node.id),
    handle: String(node.handle),
    title: String(node.title || node.handle),
  };
}

function mapGroup(node: CollectionNode | null | undefined): CatalogGroup | null {
  if (!node?.id || !node.handle) return null;
  const children: CatalogChildCollection[] = [];
  const seen = new Set<string>();

  (node.sources || []).forEach((source) => {
    if (!source || source.__typename !== "CollectionSubCollectionsSource") {
      return;
    }
    (source.collections || []).forEach((child) => {
      const mapped = mapChild(child);
      if (!mapped || seen.has(mapped.handle)) return;
      seen.add(mapped.handle);
      children.push(mapped);
    });
  });

  return {
    id: String(node.id),
    handle: String(node.handle),
    title: String(node.title || node.handle),
    children,
  };
}

async function adminGraphqlAtVersion<T>(
  session: CatalogSession,
  apiVersion: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  if (!session.accessToken) {
    throw new Error("Missing access token for catalog resolve");
  }

  const response = await fetch(
    `https://${session.shop}/admin/api/${apiVersion}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": session.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    },
  );

  if (!response.ok) {
    throw new Error(`Catalog GraphQL HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };

  if (payload.errors?.length) {
    throw new Error(
      payload.errors.map((e) => e.message || "GraphQL error").join("; "),
    );
  }

  if (!payload.data) {
    throw new Error("Catalog GraphQL returned no data");
  }

  return payload.data;
}

/**
 * Resolve parent collections → sub-collection children via Admin API 2026-07.
 * Parents without sub-collection sources return empty children (JS keeps leaf / product-type fallback).
 */
export async function resolveCatalogGroups(
  session: CatalogSession,
  parentIdsOrGids: string[],
): Promise<CatalogGroup[]> {
  const gids = Array.from(
    new Set(
      parentIdsOrGids
        .map(toCollectionGid)
        .filter((gid): gid is string => Boolean(gid)),
    ),
  );

  if (!gids.length) return [];

  const cacheKey = catalogGroupsCacheKey(session.shop, gids);
  const cached = readCatalogGroupsCache(cacheKey);
  if (cached) return cached;

  const data = await adminGraphqlAtVersion<{
    nodes?: Array<CollectionNode | null>;
  }>(session, COLLECTIONS_API_VERSION, CATALOG_GROUPS_QUERY, { ids: gids });

  const byGid = new Map<string, CatalogGroup>();
  (data.nodes || []).forEach((node) => {
    const group = mapGroup(node);
    if (group) byGid.set(group.id, group);
  });

  // Preserve merchant order from the theme collection_list
  const groups = gids
    .map((gid) => byGid.get(gid))
    .filter((group): group is CatalogGroup => Boolean(group));
  writeCatalogGroupsCache(cacheKey, groups);
  return groups;
}

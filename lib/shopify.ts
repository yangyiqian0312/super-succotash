import { config } from "@/lib/config";
import { logger } from "@/lib/logger";
import { withRetry } from "@/lib/retry";
import type { ShopifyCatalogItem } from "@/lib/types";

type ShopifyTokenCache = {
  accessToken: string;
  expiresAt: number;
  scopes: string[];
};

let tokenCache: ShopifyTokenCache | null = null;
let locationCache: string | null = null;

async function fetchClientCredentialsAccessToken() {
  if (!config.shopifyStoreDomain) {
    throw new Error("Missing SHOPIFY_STORE_DOMAIN");
  }

  if (!config.shopifyApiKey) {
    throw new Error("Missing SHOPIFY_API_KEY");
  }

  if (!config.shopifyApiSecret) {
    throw new Error("Missing SHOPIFY_API_SECRET");
  }

  type TokenResponse = {
    access_token?: string;
    scope?: string;
    expires_in?: number;
  };

  const response = await fetch(
    `https://${config.shopifyStoreDomain}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.shopifyApiKey,
        client_secret: config.shopifyApiSecret,
      }),
      cache: "no-store",
    },
  );

  const payload = (await response.json()) as TokenResponse & { error?: string };
  logger.info("shopify.client_credentials.response", {
    status: response.status,
    scope: payload.scope,
    expires_in: payload.expires_in,
    error: payload.error,
  });

  if (!response.ok || !payload.access_token) {
    throw new Error(
      `Shopify client credentials token exchange failed: ${JSON.stringify(payload)}`,
    );
  }

  const expiresInSeconds = payload.expires_in ?? 86399;
  tokenCache = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + Math.max(60, expiresInSeconds - 300) * 1000,
    scopes: payload.scope ? payload.scope.split(",") : [],
  };

  return tokenCache;
}

async function getShopifyAccessToken() {
  if (config.shopifyAdminAccessToken) {
    return {
      accessToken: config.shopifyAdminAccessToken,
      scopes: config.shopifyScopes.split(","),
      mode: "static_token" as const,
    };
  }

  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    return {
      accessToken: tokenCache.accessToken,
      scopes: tokenCache.scopes,
      mode: "client_credentials" as const,
    };
  }

  const token = await fetchClientCredentialsAccessToken();
  return {
    accessToken: token.accessToken,
    scopes: token.scopes,
    mode: "client_credentials" as const,
  };
}

async function shopifyFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!config.shopifyStoreDomain) {
    throw new Error("Missing SHOPIFY_STORE_DOMAIN");
  }

  const token = await getShopifyAccessToken();
  const url = `https://${config.shopifyStoreDomain}/admin/api/2025-01${path}`;

  return withRetry(`shopify:${path}`, async () => {
    logger.info("shopify.request", {
      url,
      method: init?.method ?? "GET",
    });

    const response = await fetch(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-shopify-access-token": token.accessToken,
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });

    const bodyText = await response.text();
    logger.info("shopify.response", {
      url,
      status: response.status,
      body: bodyText,
    });

    if (!response.ok) {
      throw new Error(`Shopify API ${response.status}: ${bodyText}`);
    }

    return JSON.parse(bodyText) as T;
  });
}

async function shopifyGraphqlFetch<T>(query: string, variables?: Record<string, unknown>) {
  return shopifyFetch<T>("/graphql.json", {
    method: "POST",
    body: JSON.stringify({ query, variables }),
  });
}

export async function adjustShopifyInventory(
  inventoryItemId: string,
  availableDelta: number,
) {
  const locationId = await getPrimaryShopifyLocationId();
  if (!locationId) {
    throw new Error("Missing Shopify location id");
  }

  return shopifyFetch("/inventory_levels/adjust.json", {
    method: "POST",
    body: JSON.stringify({
      location_id: locationId,
      inventory_item_id: inventoryItemId,
      available_adjustment: availableDelta,
    }),
  });
}

export async function listShopifyLocations() {
  type LocationsResponse = {
    locations?: Array<{
      id?: number | string;
      name?: string;
      active?: boolean;
    }>;
  };

  const response = await shopifyFetch<LocationsResponse>("/locations.json");
  return response.locations ?? [];
}

export async function getPrimaryShopifyLocationId() {
  if (config.shopifyLocationId) {
    return config.shopifyLocationId;
  }

  if (locationCache) {
    return locationCache;
  }

  const locations = await listShopifyLocations();
  const firstActive = locations.find((location) => location.active !== false) ?? locations[0];
  locationCache = firstActive?.id ? String(firstActive.id) : null;
  return locationCache;
}

export async function getShopifyConnectionStatus() {
  try {
    const token = await getShopifyAccessToken();
    const locationId = await getPrimaryShopifyLocationId().catch(() => null);
    return {
      connected: true,
      shopDomain: config.shopifyStoreDomain || null,
      scopes: token.scopes,
      locationId,
      mode: token.mode,
    };
  } catch (error) {
    logger.warn("shopify.connection.unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      connected: false,
      shopDomain: config.shopifyStoreDomain || null,
      scopes: [],
      locationId: null,
      mode: config.shopifyAdminAccessToken
        ? ("static_token" as const)
        : ("client_credentials" as const),
    };
  }
}

const fallbackCatalog: ShopifyCatalogItem[] = [
  {
    productId: "shopify-prod-1",
    productTitle: "Studio Hoodie",
    variantId: "shopify-var-1",
    variantTitle: "Black / M",
    inventoryItemId: "1234567890",
    sku: "DEMO-SKU-001",
    inventoryQuantity: 12,
    imageUrl: "",
  },
  {
    productId: "shopify-prod-2",
    productTitle: "Canvas Tote",
    variantId: "shopify-var-2",
    variantTitle: "Natural",
    inventoryItemId: "1234567891",
    sku: "DEMO-SKU-002",
    inventoryQuantity: 20,
    imageUrl: "",
  },
];

export async function listShopifyCatalog(): Promise<ShopifyCatalogItem[]> {
  if (
    !config.shopifyStoreDomain ||
    (!config.shopifyAdminAccessToken && (!config.shopifyApiKey || !config.shopifyApiSecret))
  ) {
    return fallbackCatalog;
  }

  type ShopifyGraphqlResponse = {
    data?: {
      products?: {
        edges?: Array<{
          node?: {
            id?: string;
            title?: string;
            featuredImage?: { url?: string | null } | null;
            variants?: {
              edges?: Array<{
                node?: {
                  id?: string;
                  title?: string;
                  sku?: string | null;
                  inventoryQuantity?: number | null;
                  inventoryItem?: {
                    id?: string;
                    legacyResourceId?: string | number | null;
                  } | null;
                };
              }>;
            };
          };
        }>;
      };
    };
  };

  const query = `
    query DashboardProducts {
      products(first: 50, sortKey: UPDATED_AT, reverse: true) {
        edges {
          node {
            id
            title
            featuredImage {
              url
            }
            variants(first: 20) {
              edges {
                node {
                  id
                  title
                  sku
                  inventoryQuantity
                  inventoryItem {
                    id
                    legacyResourceId
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await shopifyGraphqlFetch<ShopifyGraphqlResponse>(query);
  const products = response.data?.products?.edges ?? [];

  return products.flatMap((edge) => {
    const product = edge.node;
    if (!product) {
      return [];
    }

    return (product.variants?.edges ?? [])
      .map((variantEdge) => variantEdge.node)
      .filter(
        (variant): variant is NonNullable<typeof variant> =>
          Boolean(variant?.id && variant.inventoryItem?.legacyResourceId),
      )
      .map((variant) => ({
        productId: product.id ?? "",
        productTitle: product.title ?? "Untitled product",
        variantId: variant.id ?? "",
        variantTitle: variant.title ?? "Default",
        inventoryItemId: String(variant.inventoryItem?.legacyResourceId ?? ""),
        sku: variant.sku ?? "",
        inventoryQuantity: variant.inventoryQuantity ?? 0,
        imageUrl: product.featuredImage?.url ?? "",
      }))
      .filter((item) => item.inventoryItemId.length > 0);
  });
}

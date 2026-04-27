import { listListingRequests } from "@/lib/listing-request-store";
import { logger } from "@/lib/logger";
import { listSkuMappings } from "@/lib/mapping-store";
import { getShopifyConnectionStatus, listShopifyCatalog } from "@/lib/shopify";
import { listTikTokInventoryCatalog } from "@/lib/tiktok";
import type { DashboardData, ListingRequest, ShopifyCatalogItem, SkuMapping, TikTokInventoryRecord } from "@/lib/types";

async function safeDashboardValue<T>(label: string, loader: () => Promise<T>, fallback: T) {
  try {
    return await loader();
  } catch (error) {
    logger.error("dashboard.loader.failed", {
      label,
      error: error instanceof Error ? error.message : String(error),
    });

    return fallback;
  }
}

export async function getDashboardData(): Promise<DashboardData> {
  const [tiktokItems, shopifyItems, mappings, listingRequests, shopifyConnection] = await Promise.all([
    safeDashboardValue<TikTokInventoryRecord[]>("tiktok.catalog", listTikTokInventoryCatalog, []),
    safeDashboardValue<ShopifyCatalogItem[]>("shopify.catalog", listShopifyCatalog, []),
    safeDashboardValue<SkuMapping[]>("sku.mappings", listSkuMappings, []),
    safeDashboardValue<ListingRequest[]>("listing.requests", listListingRequests, []),
    getShopifyConnectionStatus(),
  ]);

  const mappingByTikTokSku = new Map(mappings.map((mapping) => [mapping.tiktok_sku_id, mapping]));
  const shopifyBySku = new Map(
    shopifyItems
      .filter((item) => item.sku.trim().length > 0)
      .map((item) => [item.sku.trim().toLowerCase(), item]),
  );

  const tiktokRows = tiktokItems.map((item) => {
    const mapping = mappingByTikTokSku.get(item.skuId) ?? null;
    const matchedBySku = shopifyBySku.get(item.sellerSku.trim().toLowerCase()) ?? null;
    const shopifyMatch =
      mapping
        ? shopifyItems.find((shopifyItem) => shopifyItem.variantId === mapping.shopify_variant_id) ?? matchedBySku
        : matchedBySku;

    return {
      tiktok: item,
      shopifyMatch,
      mapping,
      syncEnabled: mapping?.sync_enabled ?? false,
      canEnableSync: Boolean(shopifyMatch),
    };
  });

  const listedShopifyVariantIds = new Set(
    tiktokRows
      .map((row) => row.shopifyMatch?.variantId)
      .filter((value): value is string => Boolean(value)),
  );
  const requestedVariantIds = new Set(listingRequests.map((request) => request.shopifyVariantId));

  const shopifyUnlisted = shopifyItems.filter(
    (item) => !listedShopifyVariantIds.has(item.variantId) && !requestedVariantIds.has(item.variantId),
  );

  return {
    tiktokRows,
    shopifyUnlisted,
    listingRequests,
    shopifyConnection: {
      connected: shopifyConnection.connected,
      shopDomain: shopifyConnection.shopDomain,
      scopes: shopifyConnection.scopes,
      locationId: shopifyConnection.locationId,
      mode: shopifyConnection.mode,
    },
  };
}

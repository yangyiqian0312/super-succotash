import { listDebugEvents } from "@/lib/db";
import { listListingRequests } from "@/lib/listing-request-store";
import { logger } from "@/lib/logger";
import {
  listSkuMappings,
  findShopifyMatchForTikTokItem,
  mappingMatchesShopifyItem,
  mappingMatchesTikTokItem,
} from "@/lib/mapping-store";
import { getShopifyConnectionStatus, listShopifyCatalog } from "@/lib/shopify";
import { listTikTokInventoryCatalog } from "@/lib/tiktok";
import type {
  DashboardData,
  ActivityLogEntry,
  ListingRequest,
  ShopifyCatalogItem,
  SkuMapping,
  TikTokInventoryRecord,
  TikTokSyncRow,
} from "@/lib/types";

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
  const [tiktokItems, shopifyItems, mappings, listingRequests, activityLog, shopifyConnection] = await Promise.all([
    safeDashboardValue<TikTokInventoryRecord[]>("tiktok.catalog", listTikTokInventoryCatalog, []),
    safeDashboardValue<ShopifyCatalogItem[]>("shopify.catalog", listShopifyCatalog, []),
    safeDashboardValue<SkuMapping[]>("sku.mappings", listSkuMappings, []),
    safeDashboardValue<ListingRequest[]>("listing.requests", listListingRequests, []),
    safeDashboardValue<ActivityLogEntry[]>("activity.log", () => listDebugEvents(25), []),
    getShopifyConnectionStatus(),
  ]);

  const tiktokRows: TikTokSyncRow[] = tiktokItems.map((item) => {
    const mapping =
      mappings.find((candidate) => mappingMatchesTikTokItem(candidate, item)) ?? null;
    const matchedBySku = findShopifyMatchForTikTokItem(item, shopifyItems);
    const shopifyMatch =
      mapping
        ? shopifyItems.find((shopifyItem) => mappingMatchesShopifyItem(mapping, shopifyItem)) ?? matchedBySku
        : matchedBySku;

    return {
      tiktok: item,
      shopifyMatch,
      mapping,
      syncEnabled: mapping?.sync_enabled ?? false,
      canEnableSync: Boolean(shopifyMatch),
    };
  });

  const tiktokRowKeys = new Set(
    tiktokRows.map((row) => `${row.tiktok.productId}:${row.tiktok.skuId}`),
  );

  for (const mapping of mappings) {
    const key = `${mapping.tiktok_product_id}:${mapping.tiktok_sku_id}`;
    if (tiktokRowKeys.has(key)) {
      continue;
    }

    const shopifyMatch =
      shopifyItems.find((shopifyItem) => mappingMatchesShopifyItem(mapping, shopifyItem)) ??
      null;

    tiktokRows.push({
      tiktok: {
        productId: mapping.tiktok_product_id,
        skuId: mapping.tiktok_sku_id,
        sellerSku: mapping.tiktok_seller_sku ?? mapping.internal_sku,
        availableQuantity: shopifyMatch?.inventoryQuantity ?? 0,
        productName: mapping.shopify_product_title ?? mapping.internal_sku,
        variantTitle: mapping.shopify_variant_title,
        imageUrl: shopifyMatch?.imageUrl,
        source: "mapping",
      },
      shopifyMatch,
      mapping,
      syncEnabled: mapping.sync_enabled ?? false,
      canEnableSync: Boolean(shopifyMatch),
    });
  }

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
    activityLog,
    shopifyConnection: {
      connected: shopifyConnection.connected,
      shopDomain: shopifyConnection.shopDomain,
      scopes: shopifyConnection.scopes,
      locationId: shopifyConnection.locationId,
      mode: shopifyConnection.mode,
    },
  };
}

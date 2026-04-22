import { listListingRequests } from "@/lib/listing-request-store";
import { listSkuMappings } from "@/lib/mapping-store";
import { getShopifyConnectionStatus, listShopifyCatalog } from "@/lib/shopify";
import { listTikTokInventoryCatalog } from "@/lib/tiktok";
import type { DashboardData } from "@/lib/types";

export async function getDashboardData(): Promise<DashboardData> {
  const [tiktokItems, shopifyItems, mappings, listingRequests, shopifyConnection] = await Promise.all([
    listTikTokInventoryCatalog(),
    listShopifyCatalog(),
    listSkuMappings(),
    listListingRequests(),
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

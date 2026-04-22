import { config } from "@/lib/config";
import { readJsonFile, writeJsonFile } from "@/lib/file-store";
import type { ShopifyCatalogItem, SkuMapping, TikTokInventoryRecord } from "@/lib/types";

const FILE_NAME = "sku-mapping.json";

async function loadMappings() {
  return readJsonFile<SkuMapping[]>(FILE_NAME, []);
}

export async function listSkuMappings() {
  return loadMappings();
}

export async function saveSkuMappings(mappings: SkuMapping[]) {
  await writeJsonFile(FILE_NAME, mappings);
}

export async function findMappingByShopifyInventoryItemId(
  shopifyInventoryItemId: string,
) {
  const mappings = await loadMappings();
  return (
    mappings.find(
      (mapping) => mapping.shopify_inventory_item_id === shopifyInventoryItemId,
    ) ?? null
  );
}

export async function findMappingByTikTokSkuId(tiktokSkuId: string) {
  const mappings = await loadMappings();
  return mappings.find((mapping) => mapping.tiktok_sku_id === tiktokSkuId) ?? null;
}

export async function findMappingByInternalSku(internalSku: string) {
  const mappings = await loadMappings();
  return mappings.find((mapping) => mapping.internal_sku === internalSku) ?? null;
}

export async function upsertSkuMapping(
  tiktokItem: TikTokInventoryRecord,
  shopifyItem: ShopifyCatalogItem,
  syncEnabled: boolean,
) {
  const mappings = await loadMappings();
  const nextMapping: SkuMapping = {
    internal_sku: tiktokItem.sellerSku || shopifyItem.sku,
    shopify_inventory_item_id: shopifyItem.inventoryItemId,
    shopify_variant_id: shopifyItem.variantId,
    tiktok_product_id: tiktokItem.productId,
    tiktok_sku_id: tiktokItem.skuId,
    buffer_quantity: config.defaultBufferQuantity,
    sync_enabled: syncEnabled,
    tiktok_seller_sku: tiktokItem.sellerSku,
    shopify_product_title: shopifyItem.productTitle,
    shopify_variant_title: shopifyItem.variantTitle,
  };

  const index = mappings.findIndex(
    (mapping) =>
      mapping.tiktok_sku_id === tiktokItem.skuId ||
      mapping.shopify_variant_id === shopifyItem.variantId,
  );

  if (index >= 0) {
    mappings[index] = {
      ...mappings[index],
      ...nextMapping,
      buffer_quantity: mappings[index].buffer_quantity ?? config.defaultBufferQuantity,
    };
  } else {
    mappings.push(nextMapping);
  }

  await saveSkuMappings(mappings);
  return nextMapping;
}

export async function setMappingSyncEnabled(tiktokSkuId: string, syncEnabled: boolean) {
  const mappings = await loadMappings();
  const nextMappings = mappings.map((mapping) =>
    mapping.tiktok_sku_id === tiktokSkuId
      ? { ...mapping, sync_enabled: syncEnabled }
      : mapping,
  );

  await saveSkuMappings(nextMappings);
}

export function getBufferQuantity(mapping: SkuMapping) {
  return Number.isFinite(mapping.buffer_quantity)
    ? mapping.buffer_quantity
    : config.defaultBufferQuantity;
}

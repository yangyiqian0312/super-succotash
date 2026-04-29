import { config } from "@/lib/config";
import { hasDatabase, sql } from "@/lib/db";
import { readJsonFile, writeJsonFile } from "@/lib/file-store";
import type {
  ProductSyncField,
  ShopifyCatalogItem,
  SkuMapping,
  TikTokInventoryRecord,
} from "@/lib/types";

const FILE_NAME = "sku-mapping.json";

type SkuMappingRow = {
  internal_sku: string;
  shopify_product_id: string | null;
  shopify_inventory_item_id: string;
  shopify_variant_id: string;
  tiktok_product_id: string;
  tiktok_sku_id: string;
  buffer_quantity: number;
  sync_enabled: boolean;
  product_sync_fields: ProductSyncField[] | string | null;
  price_sync_percent: number | string | null;
  tiktok_seller_sku: string | null;
  shopify_product_title: string | null;
  shopify_variant_title: string | null;
};

function normalizeProductSyncFields(value: SkuMappingRow["product_sync_fields"]) {
  if (Array.isArray(value)) {
    return value.filter((field): field is ProductSyncField =>
      ["name", "price", "description", "image"].includes(field),
    );
  }

  if (typeof value === "string") {
    try {
      return normalizeProductSyncFields(JSON.parse(value) as ProductSyncField[]);
    } catch {
      return [];
    }
  }

  return [];
}

function rowToMapping(row: SkuMappingRow): SkuMapping {
  return {
    internal_sku: row.internal_sku,
    shopify_product_id: row.shopify_product_id ?? undefined,
    shopify_inventory_item_id: row.shopify_inventory_item_id,
    shopify_variant_id: row.shopify_variant_id,
    tiktok_product_id: row.tiktok_product_id,
    tiktok_sku_id: row.tiktok_sku_id,
    buffer_quantity: row.buffer_quantity,
    sync_enabled: row.sync_enabled,
    product_sync_fields: normalizeProductSyncFields(row.product_sync_fields),
    price_sync_percent: Number(row.price_sync_percent ?? 100),
    tiktok_seller_sku: row.tiktok_seller_sku ?? undefined,
    shopify_product_title: row.shopify_product_title ?? undefined,
    shopify_variant_title: row.shopify_variant_title ?? undefined,
  };
}

async function loadMappings() {
  if (hasDatabase) {
    const rows = await sql<SkuMappingRow>`SELECT * FROM sku_mappings ORDER BY updated_at DESC`;
    return rows.map(rowToMapping);
  }

  return readJsonFile<SkuMapping[]>(FILE_NAME, []);
}

export async function listSkuMappings() {
  return loadMappings();
}

export async function saveSkuMappings(mappings: SkuMapping[]) {
  if (hasDatabase) {
    for (const mapping of mappings) {
      await saveSkuMapping(mapping);
    }
    return;
  }

  await writeJsonFile(FILE_NAME, mappings);
}

async function saveSkuMapping(mapping: SkuMapping) {
  if (!hasDatabase) {
    return;
  }

  await sql`
    DELETE FROM sku_mappings
    WHERE
      (shopify_variant_id = ${mapping.shopify_variant_id}
        OR shopify_inventory_item_id = ${mapping.shopify_inventory_item_id})
      AND tiktok_sku_id <> ${mapping.tiktok_sku_id}
  `;

  await sql`
    INSERT INTO sku_mappings (
      internal_sku,
      shopify_product_id,
      shopify_inventory_item_id,
      shopify_variant_id,
      tiktok_product_id,
      tiktok_sku_id,
      buffer_quantity,
      sync_enabled,
      product_sync_fields,
      price_sync_percent,
      tiktok_seller_sku,
      shopify_product_title,
      shopify_variant_title,
      updated_at
    )
    VALUES (
      ${mapping.internal_sku},
      ${mapping.shopify_product_id ?? null},
      ${mapping.shopify_inventory_item_id},
      ${mapping.shopify_variant_id},
      ${mapping.tiktok_product_id},
      ${mapping.tiktok_sku_id},
      ${mapping.buffer_quantity},
      ${mapping.sync_enabled ?? false},
      ${JSON.stringify(mapping.product_sync_fields ?? [])}::jsonb,
      ${mapping.price_sync_percent ?? 100},
      ${mapping.tiktok_seller_sku ?? null},
      ${mapping.shopify_product_title ?? null},
      ${mapping.shopify_variant_title ?? null},
      NOW()
    )
    ON CONFLICT (tiktok_sku_id) DO UPDATE SET
      internal_sku = EXCLUDED.internal_sku,
      shopify_product_id = EXCLUDED.shopify_product_id,
      shopify_inventory_item_id = EXCLUDED.shopify_inventory_item_id,
      shopify_variant_id = EXCLUDED.shopify_variant_id,
      tiktok_product_id = EXCLUDED.tiktok_product_id,
      buffer_quantity = EXCLUDED.buffer_quantity,
      sync_enabled = EXCLUDED.sync_enabled,
      product_sync_fields = EXCLUDED.product_sync_fields,
      price_sync_percent = EXCLUDED.price_sync_percent,
      tiktok_seller_sku = EXCLUDED.tiktok_seller_sku,
      shopify_product_title = EXCLUDED.shopify_product_title,
      shopify_variant_title = EXCLUDED.shopify_variant_title,
      updated_at = NOW()
  `;
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

export function mappingMatchesTikTokItem(
  mapping: SkuMapping,
  tiktokItem: TikTokInventoryRecord,
) {
  const sellerSku = tiktokItem.sellerSku.trim().toLowerCase();

  return (
    mapping.tiktok_sku_id === tiktokItem.skuId ||
    (mapping.tiktok_product_id === tiktokItem.productId &&
      Boolean(sellerSku) &&
      (mapping.tiktok_seller_sku?.trim().toLowerCase() === sellerSku ||
        mapping.internal_sku.trim().toLowerCase() === sellerSku) &&
      (!tiktokItem.variantTitle ||
        !mapping.shopify_variant_title ||
        normalizeMatchText(tiktokItem.variantTitle) ===
          normalizeMatchText(mapping.shopify_variant_title)))
  );
}

function normalizeMatchText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s]/g, "");
}

export function findShopifyMatchForTikTokItem(
  tiktokItem: TikTokInventoryRecord,
  shopifyItems: ShopifyCatalogItem[],
) {
  const sellerSku = tiktokItem.sellerSku.trim().toLowerCase();
  const skuMatches = shopifyItems.filter(
    (item) => item.sku.trim().toLowerCase() === sellerSku,
  );

  if (skuMatches.length <= 1) {
    return skuMatches[0] ?? null;
  }

  const tiktokVariantValues = [
    tiktokItem.variantTitle,
    ...(tiktokItem.salesAttributes ?? []),
  ]
    .filter((value): value is string => Boolean(value))
    .map(normalizeMatchText);

  const variantMatch = skuMatches.find((item) => {
    const shopifyVariant = normalizeMatchText(item.variantTitle);
    return tiktokVariantValues.some(
      (value) => value === shopifyVariant || shopifyVariant.includes(value) || value.includes(shopifyVariant),
    );
  });

  return variantMatch ?? null;
}

export function mappingMatchesShopifyItem(
  mapping: SkuMapping,
  shopifyItem: ShopifyCatalogItem,
) {
  return (
    mapping.shopify_variant_id === shopifyItem.variantId ||
    mapping.shopify_inventory_item_id === shopifyItem.inventoryItemId
  );
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
    shopify_product_id: shopifyItem.productId,
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
      product_sync_fields: mappings[index].product_sync_fields ?? nextMapping.product_sync_fields,
      price_sync_percent: mappings[index].price_sync_percent ?? nextMapping.price_sync_percent,
    };
  } else {
    mappings.push(nextMapping);
  }

  const savedMapping = index >= 0 ? mappings[index] : nextMapping;
  if (hasDatabase) {
    await saveSkuMapping(savedMapping);
  } else {
    await saveSkuMappings(mappings);
  }

  return savedMapping;
}

export async function upsertDraftListingMapping(params: {
  tiktokProductId: string;
  shopifyItem: ShopifyCatalogItem;
  tiktokSkuId: string;
  tiktokSellerSku: string;
  syncEnabled: boolean;
}) {
  const skuRecord: TikTokInventoryRecord = {
    productId: params.tiktokProductId,
    skuId: params.tiktokSkuId,
    sellerSku: params.tiktokSellerSku,
    availableQuantity: params.shopifyItem.inventoryQuantity,
    productName: params.shopifyItem.productTitle,
    imageUrl: params.shopifyItem.imageUrl,
  };

  return upsertSkuMapping(skuRecord, params.shopifyItem, params.syncEnabled);
}

export async function setMappingSyncEnabled(tiktokSkuId: string, syncEnabled: boolean) {
  const mappings = await loadMappings();
  const nextMappings = mappings.map((mapping) =>
    mapping.tiktok_sku_id === tiktokSkuId
      ? { ...mapping, sync_enabled: syncEnabled }
      : mapping,
  );

  if (hasDatabase) {
    const mapping = nextMappings.find((item) => item.tiktok_sku_id === tiktokSkuId);
    if (mapping) {
      await saveSkuMapping(mapping);
    }
  } else {
    await saveSkuMappings(nextMappings);
  }
}

export async function setMappingProductSyncFields(
  tiktokSkuId: string,
  productSyncFields: ProductSyncField[],
  priceSyncPercent: number,
) {
  const mappings = await loadMappings();
  const nextMappings = mappings.map((mapping) =>
    mapping.tiktok_sku_id === tiktokSkuId
      ? {
          ...mapping,
          product_sync_fields: productSyncFields,
          price_sync_percent: priceSyncPercent,
        }
      : mapping,
  );

  if (hasDatabase) {
    const mapping = nextMappings.find((item) => item.tiktok_sku_id === tiktokSkuId);
    if (mapping) {
      await saveSkuMapping(mapping);
    }
  } else {
    await saveSkuMappings(nextMappings);
  }
}

export function getBufferQuantity(mapping: SkuMapping) {
  return Number.isFinite(mapping.buffer_quantity)
    ? mapping.buffer_quantity
    : config.defaultBufferQuantity;
}

import { NextResponse } from "next/server";
import { hasDatabase, sql } from "@/lib/db";
import { listSkuMappings } from "@/lib/mapping-store";
import { listShopifyCatalog } from "@/lib/shopify";
import { listTikTokInventoryCatalog } from "@/lib/tiktok";

export async function GET() {
  const checks: Record<string, unknown> = {
    storage: hasDatabase ? "database" : "file",
    hasDatabaseUrl: hasDatabase,
  };

  try {
    const mappings = await listSkuMappings();
    checks.mappingCount = mappings.length;
    checks.mappings = mappings.map((mapping) => ({
      tiktokSkuId: mapping.tiktok_sku_id,
      tiktokProductId: mapping.tiktok_product_id,
      shopifyVariantId: mapping.shopify_variant_id,
      syncEnabled: mapping.sync_enabled ?? false,
      productSyncFields: mapping.product_sync_fields ?? [],
      internalSku: mapping.internal_sku,
    }));
  } catch (error) {
    checks.mappingError = error instanceof Error ? error.message : String(error);
  }

  try {
    const tiktokItems = await listTikTokInventoryCatalog();
    checks.tiktokCount = tiktokItems.length;
    checks.tiktokSample = tiktokItems.slice(0, 5).map((item) => ({
      productId: item.productId,
      skuId: item.skuId,
      sellerSku: item.sellerSku,
      productName: item.productName,
    }));
  } catch (error) {
    checks.tiktokError = error instanceof Error ? error.message : String(error);
  }

  try {
    const shopifyItems = await listShopifyCatalog();
    checks.shopifyCount = shopifyItems.length;
    checks.shopifySample = shopifyItems.slice(0, 5).map((item) => ({
      variantId: item.variantId,
      inventoryItemId: item.inventoryItemId,
      sku: item.sku,
      productTitle: item.productTitle,
    }));
  } catch (error) {
    checks.shopifyError = error instanceof Error ? error.message : String(error);
  }

  if (hasDatabase) {
    try {
      const rows = await sql<{ now: string }>`SELECT NOW()::TEXT AS now`;
      checks.databaseOk = true;
      checks.databaseNow = rows[0]?.now;
      checks.recentEvents = await sql<{
        source: string;
        topic: string | null;
        status: string;
        details: unknown;
        created_at: string;
      }>`
        SELECT
          source,
          topic,
          status,
          details,
          created_at::TEXT
        FROM debug_events
        ORDER BY created_at DESC
        LIMIT 10
      `;
    } catch (error) {
      checks.databaseOk = false;
      checks.databaseError = error instanceof Error ? error.message : String(error);
    }
  }

  return NextResponse.json(checks);
}

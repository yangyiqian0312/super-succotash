import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/dashboard";
import { recordDebugEvent } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  setMappingProductSyncFields,
  setMappingSyncEnabled,
  upsertSkuMapping,
  findShopifyMatchForTikTokItem,
  mappingMatchesTikTokItem,
  listSkuMappings,
  mappingMatchesShopifyItem,
} from "@/lib/mapping-store";
import { listShopifyCatalog } from "@/lib/shopify";
import { syncShopifyProductToTikTok } from "@/lib/sync";
import { listTikTokInventoryCatalog } from "@/lib/tiktok";
import type { ProductSyncField } from "@/lib/types";

const productSyncFields = new Set<ProductSyncField>([
  "name",
  "price",
  "description",
  "image",
]);

function parseProductSyncFields(fields: unknown): ProductSyncField[] {
  if (!Array.isArray(fields)) {
    return [];
  }

  return fields.filter((field): field is ProductSyncField => productSyncFields.has(field));
}

function parsePriceSyncPercent(value: unknown) {
  const percent = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(percent) || percent <= 0) {
    return 100;
  }

  return Math.min(1000, Math.max(1, percent));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      tiktokSkuId?: string;
      syncEnabled?: boolean;
      productSyncFields?: ProductSyncField[];
      priceSyncPercent?: number;
    };

    if (!body.tiktokSkuId || typeof body.syncEnabled !== "boolean") {
      return NextResponse.json({ error: "Missing tiktokSkuId or syncEnabled" }, { status: 400 });
    }

    const fields = parseProductSyncFields(body.productSyncFields);
    const priceSyncPercent = parsePriceSyncPercent(body.priceSyncPercent);

    const [tiktokItems, shopifyItems] = await Promise.all([
      listTikTokInventoryCatalog(),
      listShopifyCatalog(),
    ]);

    const existingMappings = await listSkuMappings();
    const existingMapping = existingMappings.find(
      (mapping) => mapping.tiktok_sku_id === body.tiktokSkuId,
    );
    const tiktokItem =
      tiktokItems.find((item) => item.skuId === body.tiktokSkuId) ??
      (existingMapping
        ? tiktokItems.find((item) => mappingMatchesTikTokItem(existingMapping, item))
        : null);
    if (!tiktokItem) {
      return NextResponse.json({ error: "TikTok SKU not found" }, { status: 404 });
    }

    const shopifyItem =
      (existingMapping
        ? shopifyItems.find((item) => mappingMatchesShopifyItem(existingMapping, item))
        : null) ??
      findShopifyMatchForTikTokItem(tiktokItem, shopifyItems);

    if (body.syncEnabled && !shopifyItem) {
      return NextResponse.json(
        {
          error: "No Shopify SKU match found for this TikTok product",
          tiktokSkuId: tiktokItem.skuId,
          tiktokSellerSku: tiktokItem.sellerSku,
          shopifySkuSample: shopifyItems.slice(0, 10).map((item) => item.sku),
        },
        { status: 400 },
      );
    }

    if (shopifyItem) {
      await upsertSkuMapping(tiktokItem, shopifyItem, body.syncEnabled);
    } else {
      await setMappingSyncEnabled(body.tiktokSkuId, body.syncEnabled);
    }

    let syncWarning: string | null = null;

    if (body.syncEnabled) {
      await setMappingProductSyncFields(body.tiktokSkuId, fields, priceSyncPercent);
      try {
        await syncShopifyProductToTikTok({
          tiktokSkuId: body.tiktokSkuId,
          shopifyItems,
          fields,
        });
      } catch (error) {
        syncWarning = error instanceof Error ? error.message : String(error);
        logger.error("mapping.initial_sync.failed", {
          tiktokSkuId: body.tiktokSkuId,
          error: syncWarning,
        });
        await recordDebugEvent({
          source: "manual.sync",
          status: "initial_sync_failed",
          details: {
            tiktokSkuId: body.tiktokSkuId,
            error: syncWarning,
          },
        });
      }
    }

    const data = await getDashboardData();
    return NextResponse.json({ ok: true, data, warning: syncWarning });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("mapping.update.failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

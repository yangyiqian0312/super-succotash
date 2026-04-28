import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/dashboard";
import { logger } from "@/lib/logger";
import {
  setMappingProductSyncFields,
  setMappingSyncEnabled,
  upsertSkuMapping,
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: "toggle_sync" | "sync_product";
      tiktokSkuId?: string;
      syncEnabled?: boolean;
      productSyncFields?: ProductSyncField[];
    };

    if (body.action === "sync_product") {
      if (!body.tiktokSkuId) {
        return NextResponse.json({ error: "Missing tiktokSkuId" }, { status: 400 });
      }

      const fields = parseProductSyncFields(body.productSyncFields);
      if (fields.length === 0) {
        return NextResponse.json(
          { error: "Choose at least one product field to sync" },
          { status: 400 },
        );
      }

      await setMappingProductSyncFields(body.tiktokSkuId, fields);
      const shopifyItems = await listShopifyCatalog();
      await syncShopifyProductToTikTok({
        tiktokSkuId: body.tiktokSkuId,
        shopifyItems,
        fields,
      });

      const data = await getDashboardData();
      return NextResponse.json({ ok: true, data });
    }

    if (!body.tiktokSkuId || typeof body.syncEnabled !== "boolean") {
      return NextResponse.json({ error: "Missing tiktokSkuId or syncEnabled" }, { status: 400 });
    }

    const [tiktokItems, shopifyItems] = await Promise.all([
      listTikTokInventoryCatalog(),
      listShopifyCatalog(),
    ]);

    const tiktokItem = tiktokItems.find((item) => item.skuId === body.tiktokSkuId);
    if (!tiktokItem) {
      return NextResponse.json({ error: "TikTok SKU not found" }, { status: 404 });
    }

    const shopifyItem =
      shopifyItems.find(
        (item) => item.sku.trim().toLowerCase() === tiktokItem.sellerSku.trim().toLowerCase(),
      ) ?? null;

    if (body.syncEnabled && !shopifyItem) {
      return NextResponse.json(
        { error: "No Shopify SKU match found for this TikTok product" },
        { status: 400 },
      );
    }

    if (shopifyItem) {
      await upsertSkuMapping(tiktokItem, shopifyItem, body.syncEnabled);
    } else {
      await setMappingSyncEnabled(body.tiktokSkuId, body.syncEnabled);
    }

    const data = await getDashboardData();
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("mapping.update.failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/dashboard";
import { setMappingSyncEnabled, upsertSkuMapping } from "@/lib/mapping-store";
import { listShopifyCatalog } from "@/lib/shopify";
import { listTikTokInventoryCatalog } from "@/lib/tiktok";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    tiktokSkuId?: string;
    syncEnabled?: boolean;
  };

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
}

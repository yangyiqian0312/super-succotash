import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/dashboard";
import { createOrUpdateListingRequest } from "@/lib/listing-request-store";
import { listShopifyCatalog } from "@/lib/shopify";
import { createTikTokDraftListing } from "@/lib/tiktok";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    shopifyVariantIds?: string[];
  };

  if (!Array.isArray(body.shopifyVariantIds) || body.shopifyVariantIds.length === 0) {
    return NextResponse.json({ error: "Missing shopifyVariantIds" }, { status: 400 });
  }

  const shopifyItems = await listShopifyCatalog();
  const selectedItems = shopifyItems.filter((item) => body.shopifyVariantIds?.includes(item.variantId));

  if (selectedItems.length === 0) {
    return NextResponse.json({ error: "No Shopify products found" }, { status: 404 });
  }

  for (const item of selectedItems) {
    try {
      const result = await createTikTokDraftListing(item);
      await createOrUpdateListingRequest({
        item,
        status: "tiktok_draft_created",
        tiktokProductId: result.productId,
      });
    } catch (error) {
      await createOrUpdateListingRequest({
        item,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const data = await getDashboardData();
  return NextResponse.json({ ok: true, data });
}

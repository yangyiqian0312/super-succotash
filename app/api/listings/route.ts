import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/dashboard";
import { createListingRequests } from "@/lib/listing-request-store";
import { listShopifyCatalog } from "@/lib/shopify";

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

  await createListingRequests(selectedItems);
  const data = await getDashboardData();
  return NextResponse.json({ ok: true, data });
}

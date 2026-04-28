import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/dashboard";
import {
  createOrUpdateListingRequest,
  findListingRequestById,
  updateListingRequestStatus,
} from "@/lib/listing-request-store";
import { logger } from "@/lib/logger";
import { upsertDraftListingMapping } from "@/lib/mapping-store";
import { listShopifyCatalog } from "@/lib/shopify";
import { createTikTokDraftListing, listTikTokInventoryCatalog } from "@/lib/tiktok";

async function connectDraftToShopify(params: {
  listingRequestId: string;
  tiktokProductId: string;
  shopifyVariantId: string;
}) {
  const [shopifyItems, tiktokItems] = await Promise.all([
    listShopifyCatalog(),
    listTikTokInventoryCatalog(),
  ]);

  const shopifyItem = shopifyItems.find((item) => item.variantId === params.shopifyVariantId);
  if (!shopifyItem) {
    throw new Error("Shopify product not found for listing request");
  }

  const matchedTikTokSku =
    tiktokItems.find(
      (item) =>
        item.productId === params.tiktokProductId &&
        item.sellerSku.trim().toLowerCase() === shopifyItem.sku.trim().toLowerCase(),
    ) ??
    tiktokItems.find((item) => item.productId === params.tiktokProductId);

  if (!matchedTikTokSku?.skuId) {
    throw new Error(
      "TikTok draft SKU was not found yet. Wait a moment, refresh, then connect again.",
    );
  }

  await upsertDraftListingMapping({
    tiktokProductId: params.tiktokProductId,
    shopifyItem,
    tiktokSkuId: matchedTikTokSku.skuId,
    tiktokSellerSku: matchedTikTokSku.sellerSku || shopifyItem.sku,
    syncEnabled: true,
  });

  await updateListingRequestStatus({
    id: params.listingRequestId,
    status: "connected",
    tiktokProductId: params.tiktokProductId,
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: "create" | "connect";
      listingRequestId?: string;
      shopifyVariantIds?: string[];
    };

    if (body.action === "connect") {
      if (!body.listingRequestId) {
        return NextResponse.json({ error: "Missing listingRequestId" }, { status: 400 });
      }

      const listingRequest = await findListingRequestById(body.listingRequestId);
      if (!listingRequest) {
        return NextResponse.json({ error: "Listing request not found" }, { status: 404 });
      }

      if (!listingRequest.tiktokProductId) {
        return NextResponse.json(
          { error: "Listing request is missing a TikTok product ID" },
          { status: 400 },
        );
      }

      try {
        await connectDraftToShopify({
          listingRequestId: listingRequest.id,
          tiktokProductId: listingRequest.tiktokProductId,
          shopifyVariantId: listingRequest.shopifyVariantId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn("listing.connect_after_create.failed", {
          listingRequestId: listingRequest.id,
          tiktokProductId: listingRequest.tiktokProductId,
          error: message,
        });
        await updateListingRequestStatus({
          id: listingRequest.id,
          status: "tiktok_draft_created",
          tiktokProductId: listingRequest.tiktokProductId,
          error: message,
        });

        return NextResponse.json({ error: message }, { status: 409 });
      }

      const data = await getDashboardData();
      return NextResponse.json({ ok: true, data });
    }

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
        const listingRequests = await createOrUpdateListingRequest({
          item,
          status: "tiktok_draft_created",
          tiktokProductId: result.productId,
        });
        const listingRequest = listingRequests.find(
          (request) => request.shopifyVariantId === item.variantId,
        );

        if (listingRequest) {
          try {
            await connectDraftToShopify({
              listingRequestId: listingRequest.id,
              tiktokProductId: result.productId,
              shopifyVariantId: item.variantId,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn("listing.connect_after_create.failed", {
              listingRequestId: listingRequest.id,
              tiktokProductId: result.productId,
              error: message,
            });
            await updateListingRequestStatus({
              id: listingRequest.id,
              status: "tiktok_draft_created",
              tiktokProductId: result.productId,
              error: message,
            });
          }
        }
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("listing.create.failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

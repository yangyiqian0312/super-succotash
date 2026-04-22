import crypto from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { syncShopifyInventoryToTikTok } from "@/lib/sync";
import { logger } from "@/lib/logger";

function verifyShopifyWebhook(rawBody: string, hmacHeader: string | null) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    return true;
  }

  if (!hmacHeader) {
    return false;
  }

  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const headerStore = await headers();
  const hmacHeader = headerStore.get("x-shopify-hmac-sha256");

  if (!verifyShopifyWebhook(rawBody, hmacHeader)) {
    logger.error("shopify.webhook.invalid_signature", {
      hasHmacHeader: Boolean(hmacHeader),
    });

    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody) as {
    inventory_item_id?: string | number;
    available?: number;
  };

  logger.info("shopify.webhook.received", payload);

  if (!payload.inventory_item_id || typeof payload.available !== "number") {
    return NextResponse.json(
      { error: "Missing inventory_item_id or available" },
      { status: 400 },
    );
  }

  try {
    const result = await syncShopifyInventoryToTikTok({
      shopifyInventoryItemId: String(payload.inventory_item_id),
      available: payload.available,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    logger.error("shopify.webhook.failed", {
      error: error instanceof Error ? error.message : String(error),
      inventoryItemId: payload.inventory_item_id,
    });

    return NextResponse.json(
      { error: "Inventory sync failed" },
      { status: 500 },
    );
  }
}

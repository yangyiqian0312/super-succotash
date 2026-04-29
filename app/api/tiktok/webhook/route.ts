import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { recordDebugEvent } from "@/lib/db";
import { logger } from "@/lib/logger";
import { processTikTokOrderWebhook } from "@/lib/sync";
import { parseTikTokWebhookPayload, verifyTikTokWebhookSignature } from "@/lib/tiktok";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const headerStore = await headers();
  const signatureHeader =
    headerStore.get("tiktok-signature") ?? headerStore.get("TikTok-Signature");

  if (!verifyTikTokWebhookSignature(rawBody, signatureHeader)) {
    logger.error("tiktok.webhook.invalid_signature", {
      hasSignatureHeader: Boolean(signatureHeader),
    });
    await recordDebugEvent({
      source: "tiktok.webhook",
      status: "invalid_signature",
      details: {
        hasSignatureHeader: Boolean(signatureHeader),
      },
    });

    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  try {
    const payload = parseTikTokWebhookPayload(rawBody);
    logger.info("tiktok.webhook.received", {
      event: payload.event,
      create_time: payload.create_time,
    });
    await recordDebugEvent({
      source: "tiktok.webhook",
      topic: payload.event,
      status: "received",
      details: {
        type: payload.type,
        createTime: payload.create_time,
        orderId: payload.data?.order_id,
        orderStatus: payload.data?.order_status,
      },
    });

    const result = await processTikTokOrderWebhook(payload);
    await recordDebugEvent({
      source: "tiktok.webhook",
      topic: payload.event,
      status: "order_sync_result",
      details: {
        orderId: payload.data?.order_id,
        orderStatus: payload.data?.order_status,
        result,
      },
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("tiktok.webhook.failed", {
      error: message,
    });
    await recordDebugEvent({
      source: "tiktok.webhook",
      status: "failed",
      details: {
        error: message,
      },
    });

    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}

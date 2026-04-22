import { headers } from "next/headers";
import { NextResponse } from "next/server";
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

    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  try {
    const payload = parseTikTokWebhookPayload(rawBody);
    logger.info("tiktok.webhook.received", {
      event: payload.event,
      create_time: payload.create_time,
    });

    const result = await processTikTokOrderWebhook(payload);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    logger.error("tiktok.webhook.failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}

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

  let payload: ReturnType<typeof parseTikTokWebhookPayload> | null = null;

  try {
    payload = parseTikTokWebhookPayload(rawBody);
    logger.info("tiktok.webhook.received", {
      event: payload.event,
      create_time: payload.create_time,
    });

    const result = await processTikTokOrderWebhook(payload);
    if (shouldShowTikTokOrderActivity(result)) {
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
    }
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isMissingOrderScope =
      message.includes("\"code\":105005") ||
      (message.includes("Access denied") && message.includes("required access scope"));

    logger.error("tiktok.webhook.failed", {
      error: message,
    });
    if (!isMissingOrderScope) {
      await recordDebugEvent({
        source: "tiktok.webhook",
        topic: payload?.event,
        status: "failed",
        details: {
          error: message,
          orderId: payload?.data?.order_id,
          orderStatus: payload?.data?.order_status,
        },
      });
    }

    if (isMissingOrderScope) {
      return NextResponse.json({
        ok: false,
        retry: false,
        error: "TikTok app is missing the required Order API access scope.",
      });
    }

    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}

function shouldShowTikTokOrderActivity(result: unknown) {
  if (!result || typeof result !== "object") {
    return false;
  }

  const record = result as Record<string, unknown>;
  if (Number(record.appliedCount ?? 0) > 0) {
    return true;
  }

  const lineResults = Array.isArray(record.lineResults) ? record.lineResults : [];
  return lineResults.some((line) => {
    if (!line || typeof line !== "object") {
      return false;
    }
    return (line as Record<string, unknown>).skipped === false;
  });
}

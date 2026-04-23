import { NextResponse } from "next/server";
import { getShopWebhooks, updateShopWebhook } from "@/lib/tiktok";

const WEBHOOK_EVENTS = ["ORDER_STATUS_CHANGE", "CANCELLATION_STATUS_CHANGE"] as const;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    address?: string;
  };

  const address = body.address;
  if (!address) {
    return NextResponse.json({ error: "Missing address" }, { status: 400 });
  }

  const results = [];

  for (const eventType of WEBHOOK_EVENTS) {
    const result = await updateShopWebhook({
      address,
      eventType,
    });
    results.push({
      eventType,
      result,
    });
  }

  const current = await getShopWebhooks();

  return NextResponse.json({
    ok: true,
    registered: results,
    current,
  });
}

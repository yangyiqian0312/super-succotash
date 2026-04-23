import { NextResponse } from "next/server";
import { getShopWebhooks } from "@/lib/tiktok";

export async function GET() {
  const result = await getShopWebhooks();
  return NextResponse.json(result);
}

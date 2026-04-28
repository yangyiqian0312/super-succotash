import { NextResponse } from "next/server";
import { searchTikTokCategories } from "@/lib/tiktok";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const keyword = url.searchParams.get("keyword")?.trim() || "Trading Cards";

  try {
    const categories = await searchTikTokCategories(keyword);
    return NextResponse.json({ ok: true, keyword, categories });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

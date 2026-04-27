import { NextResponse } from "next/server";
import { exchangeTikTokAuthCode, getAuthorizedTikTokShops } from "@/lib/tiktok";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderEnvPage(values: Record<string, string>) {
  const envText = Object.entries(values)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TikTok Shop Connected</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        margin: 0;
        padding: 32px;
        background: #f6f7f9;
        color: #171717;
      }
      main {
        max-width: 920px;
        margin: 0 auto;
      }
      pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        background: #111827;
        color: #f9fafb;
        padding: 18px;
        border-radius: 8px;
        line-height: 1.5;
      }
      p {
        line-height: 1.6;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>TikTok Shop connected</h1>
      <p>Update these values in Vercel Environment Variables, then redeploy the app.</p>
      <pre>${escapeHtml(envText)}</pre>
      <p>Keep this page private. These values grant access to the authorized TikTok Shop.</p>
    </main>
  </body>
</html>`;
}

function renderErrorPage(message: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TikTok Shop Connection Error</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        margin: 0;
        padding: 32px;
        background: #f6f7f9;
        color: #171717;
      }
      main {
        max-width: 920px;
        margin: 0 auto;
      }
      pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        background: #fff7ed;
        color: #9a3412;
        border: 1px solid #fed7aa;
        padding: 18px;
        border-radius: 8px;
        line-height: 1.5;
      }
      p {
        line-height: 1.6;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>TikTok Shop connection failed</h1>
      <p>The authorization callback reached this app, but TikTok token setup did not finish.</p>
      <pre>${escapeHtml(message)}</pre>
      <p>After fixing this, start the TikTok authorization again because authorization codes are short-lived and single-use.</p>
    </main>
  </body>
</html>`;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const authCode = url.searchParams.get("code") ?? url.searchParams.get("auth_code");

    if (!authCode) {
      return NextResponse.json({ error: "Missing TikTok authorization code" }, { status: 400 });
    }

    const token = await exchangeTikTokAuthCode(authCode);
    const shops = await getAuthorizedTikTokShops(token.accessToken);
    const shop = shops[0];
    const shopCipher = shop?.shop_cipher ?? shop?.cipher ?? "";
    const shopId = shop?.shop_id ?? shop?.id ?? "";

    if (!shopCipher) {
      return NextResponse.json(
        {
          error: "TikTok authorization succeeded, but no shop_cipher was returned",
          shops,
        },
        { status: 502 },
      );
    }

    return new NextResponse(
      renderEnvPage({
        TIKTOK_ACCESS_TOKEN: token.accessToken,
        TIKTOK_REFRESH_TOKEN: token.refreshToken,
        TIKTOK_SHOP_CIPHER: shopCipher,
        TIKTOK_SHOP_ID: shopId,
      }),
      {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      },
    );
  } catch (error) {
    return new NextResponse(
      renderErrorPage(error instanceof Error ? error.message : String(error)),
      {
        status: 500,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      },
    );
  }
}

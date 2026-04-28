# Shopify + TikTok Shop Inventory Sync MVP

Minimal Next.js API project for keeping TikTok Shop inventory aligned to Shopify inventory.

## What is included

- `POST /api/shopify/webhook`
  Receives Shopify inventory webhooks and updates TikTok inventory.
- `POST /api/tiktok/webhook`
  Receives TikTok order webhooks and deducts Shopify inventory immediately.
- `/`
  A non-technical control panel for choosing which TikTok products sync inventory and which Shopify products should become new TikTok listing requests.
- `POST /api/mappings`
  Turns inventory sync on or off for a TikTok SKU using automatic SKU matching to Shopify.
- `POST /api/tiktok/register-webhooks`
  Registers TikTok shop webhooks through Event API for `ORDER_STATUS_CHANGE` and `CANCELLATION_STATUS_CHANGE`.
- `GET /api/tiktok/webhooks`
  Returns the current TikTok shop webhook configuration using Event API.
- `GET /api/tiktok/oauth/callback`
  Receives the TikTok Shop authorization callback, exchanges the authorization code for tokens, and retrieves the authorized shop cipher.
- `POST /api/listings`
  Creates listing requests for Shopify variants that are not on TikTok yet.
- `updateTikTokInventory(mapping, stock)`
  Calls TikTok `POST /product/202309/inventory/update`.
- `data/sku-mapping.json`
  Local fallback mapping store when `DATABASE_URL` is not configured.
- `data/listing-requests.json`
  Local fallback queue when `DATABASE_URL` is not configured.
- `db/schema.sql`
  SQL table definition for the Neon/Postgres production store.

## Sync rule

TikTok stock is always derived from Shopify stock:

```txt
stock = max(0, shopifyStock - buffer)
```

## Environment variables

Copy `.env.example` into `.env.local` and fill in:

- `TIKTOK_API_BASE_URL`
- `TIKTOK_AUTH_BASE_URL`
- `TIKTOK_ACCESS_TOKEN`
- `TIKTOK_REFRESH_TOKEN`
- `TIKTOK_CLIENT_KEY`
- `TIKTOK_CLIENT_SECRET`
- `TIKTOK_ORDER_EVENT_NAME`
- `TIKTOK_MERCHANT_ID`
- `TIKTOK_APP_KEY`
- `TIKTOK_APP_SECRET`
- `TIKTOK_SHOP_CIPHER`
- `TIKTOK_SHOP_ID`
- `TIKTOK_API_VERSION`
- `TIKTOK_SEARCH_PRODUCTS_PATH`
- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_SCOPES`
- `SHOPIFY_ADMIN_ACCESS_TOKEN`
- `SHOPIFY_LOCATION_ID`
- `SHOPIFY_WEBHOOK_SECRET` if you want webhook signature verification
- `DEFAULT_BUFFER_QUANTITY`
- `DATABASE_URL`

On Vercel, connect a Neon Postgres database and expose its `DATABASE_URL` to the project. The app automatically creates the required tables on first use.

## Start

```bash
npm install
npm run dev
```

## TikTok authorization

Configure the TikTok Shop app redirect URL as:

```txt
https://your-domain.example/api/tiktok/oauth/callback
```

After a seller authorizes the app, the callback exchanges the authorization code with TikTok's Node SDK, calls Get Authorized Shops, and displays the values needed for Vercel environment variables:

```env
TIKTOK_ACCESS_TOKEN=
TIKTOK_REFRESH_TOKEN=
TIKTOK_SHOP_CIPHER=
TIKTOK_SHOP_ID=
```

TikTok API calls refresh `TIKTOK_ACCESS_TOKEN` automatically when TikTok returns an expired-token 401, using `TIKTOK_REFRESH_TOKEN`, `TIKTOK_APP_KEY`, and `TIKTOK_APP_SECRET`.

For Vercel, keep `TIKTOK_REFRESH_TOKEN` in environment variables for this MVP. For production, move token storage to a persistent database or KV store if TikTok rotates refresh tokens for your app.

## TikTok webhook behavior

- Configure your HTTPS callback URL in TikTok Developer Portal as `/api/tiktok/webhook`.
- TikTok signs webhooks in the `TikTok-Signature` header.
- This project verifies the signature with `HMAC_SHA256(client_secret, timestamp + "." + rawBody)`.
- Webhooks are treated as at-least-once delivery, so duplicate events are ignored with a local idempotency store.

## Notes

- Shopify is treated as the single source of truth.
- All external API calls log request and response details.
- A simple retry wrapper is used for TikTok and Shopify requests.
- The TikTok order webhook parser supports common order payload shapes, but you should align `TIKTOK_ORDER_EVENT_NAME` and the `content` shape to your exact TikTok Shop event payload.
- Existing TikTok products can be enabled for sync when `seller_sku` matches a Shopify variant `sku`.
- The TikTok dashboard tab parses the real `products/search` response shape with `data.products[]`, `data.next_page_token`, `skus[]`, and summed SKU inventory quantities.
- Product search request signing is generated automatically with TikTok's HMAC-SHA256 rules using `TIKTOK_APP_SECRET`.
- Shopify uses the client credentials grant for stores you own. The dashboard exchanges `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` for a short-lived Admin access token and caches it in memory before calling the Admin API.
- New TikTok listings are queued as `needs_details` requests because TikTok product creation normally requires category-specific attributes that cannot be inferred safely from generic Shopify product data alone.

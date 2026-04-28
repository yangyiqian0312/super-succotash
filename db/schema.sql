CREATE TABLE IF NOT EXISTS sku_mappings (
  tiktok_sku_id TEXT PRIMARY KEY,
  internal_sku TEXT NOT NULL,
  shopify_product_id TEXT,
  shopify_inventory_item_id TEXT NOT NULL,
  shopify_variant_id TEXT NOT NULL,
  tiktok_product_id TEXT NOT NULL,
  buffer_quantity INTEGER NOT NULL DEFAULT 2,
  sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  product_sync_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  tiktok_seller_sku TEXT,
  shopify_product_title TEXT,
  shopify_variant_title TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sku_mappings_shopify_variant_idx
ON sku_mappings (shopify_variant_id);

CREATE UNIQUE INDEX IF NOT EXISTS sku_mappings_shopify_inventory_idx
ON sku_mappings (shopify_inventory_item_id);

CREATE TABLE IF NOT EXISTS listing_requests (
  id TEXT PRIMARY KEY,
  shopify_variant_id TEXT NOT NULL UNIQUE,
  shopify_product_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  tiktok_product_id TEXT,
  error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS processed_webhooks (
  key TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

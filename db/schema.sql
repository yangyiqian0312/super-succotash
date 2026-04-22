CREATE TABLE sku_mapping (
  internal_sku TEXT PRIMARY KEY,
  shopify_inventory_item_id TEXT NOT NULL UNIQUE,
  shopify_variant_id TEXT NOT NULL,
  tiktok_product_id TEXT NOT NULL,
  tiktok_sku_id TEXT NOT NULL UNIQUE,
  buffer_quantity INTEGER NOT NULL DEFAULT 2
);

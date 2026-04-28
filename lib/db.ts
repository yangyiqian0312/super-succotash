import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "";

export const hasDatabase = Boolean(databaseUrl);

const sqlClient = hasDatabase ? neon(databaseUrl) : null;
let schemaPromise: Promise<void> | null = null;

export async function sql<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]) {
  if (!sqlClient) {
    throw new Error("DATABASE_URL is not configured");
  }

  await ensureSchema();
  return sqlClient(strings, ...values) as Promise<T[]>;
}

async function runSchema(strings: TemplateStringsArray, ...values: unknown[]) {
  if (!sqlClient) {
    return;
  }

  await sqlClient(strings, ...values);
}

export async function ensureSchema() {
  if (!sqlClient) {
    return;
  }

  schemaPromise ??= (async () => {
    await runSchema`
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
        price_sync_percent NUMERIC NOT NULL DEFAULT 100,
        tiktok_seller_sku TEXT,
        shopify_product_title TEXT,
        shopify_variant_title TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await runSchema`
      ALTER TABLE sku_mappings
      ADD COLUMN IF NOT EXISTS price_sync_percent NUMERIC NOT NULL DEFAULT 100
    `;

    await runSchema`
      CREATE UNIQUE INDEX IF NOT EXISTS sku_mappings_shopify_variant_idx
      ON sku_mappings (shopify_variant_id)
    `;

    await runSchema`
      CREATE UNIQUE INDEX IF NOT EXISTS sku_mappings_shopify_inventory_idx
      ON sku_mappings (shopify_inventory_item_id)
    `;

    await runSchema`
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
      )
    `;

    await runSchema`
      CREATE TABLE IF NOT EXISTS processed_webhooks (
        key TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await runSchema`
      CREATE TABLE IF NOT EXISTS debug_events (
        id BIGSERIAL PRIMARY KEY,
        source TEXT NOT NULL,
        topic TEXT,
        status TEXT NOT NULL,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
  })();

  return schemaPromise;
}

export async function recordDebugEvent(input: {
  source: string;
  topic?: string;
  status: string;
  details?: Record<string, unknown>;
}) {
  if (!sqlClient) {
    return;
  }

  await ensureSchema();
  await sqlClient`
    INSERT INTO debug_events (source, topic, status, details, created_at)
    VALUES (
      ${input.source},
      ${input.topic ?? null},
      ${input.status},
      ${JSON.stringify(input.details ?? {})}::jsonb,
      NOW()
    )
  `;

  await sqlClient`
    DELETE FROM debug_events
    WHERE id IN (
      SELECT id FROM debug_events
      ORDER BY created_at DESC
      OFFSET 50
    )
  `;
}

export type ProductSyncField = "name" | "price" | "description" | "image";

export type SkuMapping = {
  internal_sku: string;
  shopify_product_id?: string;
  shopify_inventory_item_id: string;
  shopify_variant_id: string;
  tiktok_product_id: string;
  tiktok_sku_id: string;
  buffer_quantity: number;
  sync_enabled?: boolean;
  product_sync_fields?: ProductSyncField[];
  price_sync_percent?: number;
  tiktok_seller_sku?: string;
  shopify_product_title?: string;
  shopify_variant_title?: string;
};

export type ShopifyInventoryWebhookPayload = {
  inventory_item_id: string;
  available: number;
};

export type TikTokInventoryUpdateInput = {
  product_id: string;
  skus: Array<{
    sku_id: string;
    stock: number;
  }>;
};

export type TikTokWebhookPayload = {
  type?: number;
  tts_notification_id?: string;
  shop_id?: string;
  timestamp?: number;
  client_key?: string;
  event?: string;
  create_time?: number;
  user_openid?: string;
  content?: string;
  data?: {
    is_on_hold_order?: boolean;
    order_id?: string;
    order_status?: string;
    update_time?: number;
  };
};

export type TikTokInventoryRecord = {
  productId: string;
  skuId: string;
  sellerSku: string;
  availableQuantity: number;
  productName: string;
  variantTitle?: string;
  salesAttributes?: string[];
  imageUrl?: string;
  productStatus?: string;
  skuStatus?: string;
  source?: "tiktok" | "mapping";
};

export type ShopifyCatalogItem = {
  productId: string;
  productTitle: string;
  variantId: string;
  variantTitle: string;
  inventoryItemId: string;
  sku: string;
  inventoryQuantity: number;
  imageUrl?: string;
  descriptionHtml?: string;
  price?: string;
};

export type ListingRequest = {
  id: string;
  shopifyVariantId: string;
  shopifyProductId: string;
  sku: string;
  title: string;
  status:
    | "draft"
    | "queued"
    | "needs_details"
    | "tiktok_draft_created"
    | "connected"
    | "failed";
  createdAt: string;
  tiktokProductId?: string;
  error?: string;
};

export type TikTokSyncRow = {
  tiktok: TikTokInventoryRecord;
  shopifyMatch: ShopifyCatalogItem | null;
  mapping: SkuMapping | null;
  syncEnabled: boolean;
  canEnableSync: boolean;
};

export type ActivityLogEntry = {
  source: string;
  topic: string | null;
  status: string;
  details: unknown;
  createdAt: string;
};

export type DashboardData = {
  tiktokRows: TikTokSyncRow[];
  shopifyUnlisted: ShopifyCatalogItem[];
  listingRequests: ListingRequest[];
  activityLog: ActivityLogEntry[];
  shopifyConnection: {
    connected: boolean;
    shopDomain: string | null;
    scopes: string[];
    locationId: string | null;
    mode: "client_credentials" | "static_token";
  };
};

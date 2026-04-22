export type SkuMapping = {
  internal_sku: string;
  shopify_inventory_item_id: string;
  shopify_variant_id: string;
  tiktok_product_id: string;
  tiktok_sku_id: string;
  buffer_quantity: number;
  sync_enabled?: boolean;
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
  client_key?: string;
  event?: string;
  create_time?: number;
  user_openid?: string;
  content?: string;
};

export type TikTokInventoryRecord = {
  productId: string;
  skuId: string;
  sellerSku: string;
  availableQuantity: number;
  productName: string;
  imageUrl?: string;
  productStatus?: string;
  skuStatus?: string;
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
};

export type ListingRequest = {
  id: string;
  shopifyVariantId: string;
  shopifyProductId: string;
  sku: string;
  title: string;
  status: "draft" | "queued" | "needs_details";
  createdAt: string;
};

export type TikTokSyncRow = {
  tiktok: TikTokInventoryRecord;
  shopifyMatch: ShopifyCatalogItem | null;
  mapping: SkuMapping | null;
  syncEnabled: boolean;
  canEnableSync: boolean;
};

export type DashboardData = {
  tiktokRows: TikTokSyncRow[];
  shopifyUnlisted: ShopifyCatalogItem[];
  listingRequests: ListingRequest[];
  shopifyConnection: {
    connected: boolean;
    shopDomain: string | null;
    scopes: string[];
    locationId: string | null;
    mode: "client_credentials" | "static_token";
  };
};

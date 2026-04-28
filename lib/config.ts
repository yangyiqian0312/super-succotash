export const config = {
  tiktokApiBaseUrl:
    process.env.TIKTOK_API_BASE_URL ?? "https://open-api.tiktokglobalshop.com",
  tiktokAuthBaseUrl:
    process.env.TIKTOK_AUTH_BASE_URL ?? "https://auth.tiktok-shops.com",
  tiktokAccessToken: process.env.TIKTOK_ACCESS_TOKEN ?? "",
  tiktokRefreshToken: process.env.TIKTOK_REFRESH_TOKEN ?? "",
  tiktokAppSecret: process.env.TIKTOK_APP_SECRET ?? "",
  tiktokClientSecret: process.env.TIKTOK_CLIENT_SECRET ?? "",
  tiktokClientKey: process.env.TIKTOK_CLIENT_KEY ?? "",
  tiktokOrderEventName:
    process.env.TIKTOK_ORDER_EVENT_NAME ?? "tt_order_status_change",
  tiktokMerchantId: process.env.TIKTOK_MERCHANT_ID ?? "",
  tiktokAppKey: process.env.TIKTOK_APP_KEY ?? "",
  tiktokShopCipher: process.env.TIKTOK_SHOP_CIPHER ?? "",
  tiktokShopId: process.env.TIKTOK_SHOP_ID ?? "",
  tiktokApiVersion: process.env.TIKTOK_API_VERSION ?? "202502",
  tiktokSearchProductsPath:
    process.env.TIKTOK_SEARCH_PRODUCTS_PATH ?? "/product/202502/products/search",
  tiktokCreateProductPath:
    process.env.TIKTOK_CREATE_PRODUCT_PATH ?? "/product/202309/products",
  tiktokCreateProductVersion: process.env.TIKTOK_CREATE_PRODUCT_VERSION ?? "202309",
  tiktokCategoryVersion: process.env.TIKTOK_CATEGORY_VERSION ?? "V2",
  tiktokDefaultCategoryId: process.env.TIKTOK_DEFAULT_CATEGORY_ID ?? "1386384",
  tiktokDefaultWarehouseId: process.env.TIKTOK_DEFAULT_WAREHOUSE_ID ?? "",
  tiktokDefaultPackageWeightLb: process.env.TIKTOK_DEFAULT_PACKAGE_WEIGHT_LB ?? "0.5",
  tiktokDefaultPackageLengthIn: process.env.TIKTOK_DEFAULT_PACKAGE_LENGTH_IN ?? "5",
  tiktokDefaultPackageWidthIn: process.env.TIKTOK_DEFAULT_PACKAGE_WIDTH_IN ?? "5",
  tiktokDefaultPackageHeightIn: process.env.TIKTOK_DEFAULT_PACKAGE_HEIGHT_IN ?? "5",
  shopifyStoreDomain: process.env.SHOPIFY_STORE_DOMAIN ?? "",
  shopifyApiKey: process.env.SHOPIFY_API_KEY ?? "",
  shopifyApiSecret: process.env.SHOPIFY_API_SECRET ?? "",
  shopifyScopes:
    process.env.SHOPIFY_SCOPES ?? "read_products,read_inventory,write_inventory,read_locations",
  shopifyAdminAccessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ?? "",
  shopifyLocationId: process.env.SHOPIFY_LOCATION_ID ?? "",
  defaultBufferQuantity: Number(process.env.DEFAULT_BUFFER_QUANTITY ?? "2"),
};

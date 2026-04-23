import { config } from "@/lib/config";
import { readJsonFile, writeJsonFile } from "@/lib/file-store";
import { logger } from "@/lib/logger";
import { withRetry } from "@/lib/retry";
import type {
  SkuMapping,
  TikTokInventoryRecord,
  TikTokInventoryUpdateInput,
  TikTokWebhookPayload,
} from "@/lib/types";
import crypto from "node:crypto";

async function tiktokFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!config.tiktokAccessToken) {
    throw new Error("Missing TIKTOK_ACCESS_TOKEN");
  }

  const url = `${config.tiktokApiBaseUrl}${path}`;

  return withRetry(`tiktok:${path}`, async () => {
    logger.info("tiktok.request", {
      url,
      method: init?.method ?? "GET",
    });

    const response = await fetch(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-tts-access-token": config.tiktokAccessToken,
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });

    const bodyText = await response.text();
    logger.info("tiktok.response", {
      url,
      status: response.status,
      body: bodyText,
    });

    if (!response.ok) {
      throw new Error(`TikTok API ${response.status}: ${bodyText}`);
    }

    return JSON.parse(bodyText) as T;
  });
}

async function tiktokFetchAbsolute<T>(url: string, init?: RequestInit): Promise<T> {
  if (!config.tiktokAccessToken) {
    throw new Error("Missing TIKTOK_ACCESS_TOKEN");
  }

  return withRetry(`tiktok:absolute:${url}`, async () => {
    logger.info("tiktok.request", {
      url,
      method: init?.method ?? "GET",
    });

    const response = await fetch(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-tts-access-token": config.tiktokAccessToken,
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });

    const bodyText = await response.text();
    logger.info("tiktok.response", {
      url,
      status: response.status,
      body: bodyText,
    });

    if (!response.ok) {
      throw new Error(`TikTok API ${response.status}: ${bodyText}`);
    }

    return JSON.parse(bodyText) as T;
  });
}

export function buildTikTokSignedUrl(input: {
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  version?: string;
}) {
  const version = input.version ?? config.tiktokApiVersion;
  const queryInput: Record<string, string> = {
    access_token: config.tiktokAccessToken,
    app_key: config.tiktokAppKey,
    shop_cipher: config.tiktokShopCipher,
    timestamp: String(Math.floor(Date.now() / 1000)),
    version,
    ...(config.tiktokShopId ? { shop_id: config.tiktokShopId } : {}),
    ...(input.query ?? {}),
  };

  const sign = generateTikTokSign({
    path: input.path,
    query: queryInput,
    body: input.body,
    contentType: "application/json",
  });

  return `${config.tiktokApiBaseUrl}${input.path}?${new URLSearchParams({
    ...queryInput,
    sign,
  }).toString()}`;
}

function generateTikTokSign(input: {
  path: string;
  query: Record<string, string>;
  body?: Record<string, unknown>;
  contentType?: string;
}) {
  if (!config.tiktokAppSecret) {
    throw new Error("Missing TIKTOK_APP_SECRET");
  }

  const paramString = Object.keys(input.query)
    .filter((key) => key !== "sign" && key !== "access_token")
    .sort()
    .map((key) => `${key}${input.query[key]}`)
    .join("");

  let signString = `${input.path}${paramString}`;

  if (
    input.contentType !== "multipart/form-data" &&
    input.body &&
    Object.keys(input.body).length > 0
  ) {
    signString += JSON.stringify(input.body);
  }

  const wrapped = `${config.tiktokAppSecret}${signString}${config.tiktokAppSecret}`;
  const hmac = crypto.createHmac("sha256", config.tiktokAppSecret);
  hmac.update(wrapped);
  return hmac.digest("hex");
}

export async function updateTikTokInventory(mapping: SkuMapping, stock: number) {
  const payload: TikTokInventoryUpdateInput = {
    product_id: mapping.tiktok_product_id,
    skus: [
      {
        sku_id: mapping.tiktok_sku_id,
        stock,
      },
    ],
  };

  return tiktokFetch("/product/202309/inventory/update", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

const fallbackInventory: TikTokInventoryRecord[] = [
  {
    productId: "17293822501",
    skuId: "17293822502",
    sellerSku: "DEMO-SKU-001",
    availableQuantity: 10,
    productName: "Studio Hoodie",
  },
  {
    productId: "17293822503",
    skuId: "17293822504",
    sellerSku: "TT-ONLY-SKU-003",
    availableQuantity: 7,
    productName: "TikTok Exclusive Cap",
  },
];

function normalizeText(value: unknown, fallback: string) {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return fallback;
}

function normalizeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

type ProductImageCache = Record<string, string>;

const PRODUCT_IMAGE_CACHE_FILE = "tiktok-product-images.json";

async function loadProductImageCache() {
  return readJsonFile<ProductImageCache>(PRODUCT_IMAGE_CACHE_FILE, {});
}

async function saveProductImageCache(cache: ProductImageCache) {
  await writeJsonFile(PRODUCT_IMAGE_CACHE_FILE, cache);
}

async function getTikTokProductImage(productId: string) {
  if (!productId) {
    return "";
  }

  const cache = await loadProductImageCache();
  if (cache[productId]) {
    return cache[productId];
  }

  type TikTokProductDetailResponse = {
    data?: {
      main_images?: Array<{
        urls?: string[];
        thumb_urls?: string[];
      }>;
    };
  };

  const body = {};
  const queryInput: Record<string, string> = {
    access_token: config.tiktokAccessToken,
    app_key: config.tiktokAppKey,
    timestamp: String(Math.floor(Date.now() / 1000)),
    version: "202309",
  };

  if (config.tiktokShopCipher) {
    queryInput.shop_cipher = config.tiktokShopCipher;
  }

  if (config.tiktokShopId) {
    queryInput.shop_id = config.tiktokShopId;
  }

  const path = `/product/202309/products/${productId}`;
  const sign = generateTikTokSign({
    path,
    query: queryInput,
    body,
    contentType: "application/json",
  });

  const url = `${config.tiktokApiBaseUrl}${path}?${new URLSearchParams({
    ...queryInput,
    sign,
  }).toString()}`;

  const response = await tiktokFetchAbsolute<TikTokProductDetailResponse>(url, {
    method: "GET",
  });

  const imageUrl =
    response.data?.main_images?.[0]?.urls?.[0] ??
    response.data?.main_images?.[0]?.thumb_urls?.[0] ??
    "";

  if (imageUrl) {
    await saveProductImageCache({
      ...cache,
      [productId]: imageUrl,
    });
  }

  return imageUrl;
}

export async function listTikTokInventoryCatalog(): Promise<TikTokInventoryRecord[]> {
  if (
    !config.tiktokAccessToken ||
    !config.tiktokAppKey ||
    !config.tiktokAppSecret ||
    !config.tiktokShopCipher
  ) {
    return fallbackInventory;
  }

  type TikTokProductsSearchResponse = {
    code?: number;
    data?: {
      next_page_token?: string;
      total_count?: number;
      products?: Array<{
        id?: string | number;
        title?: string;
        status?: string;
        main_images?: Array<{
          urls?: string[];
          thumb_urls?: string[];
        }>;
        skus?: Array<{
          id?: string | number;
          seller_sku?: string;
          inventory?: Array<{
            quantity?: number;
          }>;
          status_info?: {
            status?: string;
          };
        }>;
      }>;
    };
  };

  const rows: TikTokInventoryRecord[] = [];
  const uniqueProductIds = new Set<string>();
  let nextPageToken = "";
  let pageCount = 0;

  do {
    pageCount += 1;
    const body = {
      status: "ALL",
    };
    const queryInput: Record<string, string> = {
      access_token: config.tiktokAccessToken,
      app_key: config.tiktokAppKey,
      page_size: "100",
      shop_cipher: config.tiktokShopCipher,
      timestamp: String(Math.floor(Date.now() / 1000)),
      version: config.tiktokApiVersion,
    };

    if (config.tiktokShopId) {
      queryInput.shop_id = config.tiktokShopId;
    }

    if (nextPageToken) {
      queryInput.page_token = nextPageToken;
    }

    const sign = generateTikTokSign({
      path: config.tiktokSearchProductsPath,
      query: queryInput,
      body,
      contentType: "application/json",
    });

    const query = new URLSearchParams({
      ...queryInput,
      sign,
    });
    const url = `${config.tiktokApiBaseUrl}${config.tiktokSearchProductsPath}?${query.toString()}`;
    const response = await tiktokFetchAbsolute<TikTokProductsSearchResponse>(url, {
      method: "POST",
      body: JSON.stringify(body),
    });

    const products = response.data?.products ?? [];

    for (const product of products) {
      const productId = String(product.id ?? "");
      const productName = product.title ?? "Untitled TikTok product";
      uniqueProductIds.add(productId);
      const imageUrl =
        product.main_images?.[0]?.urls?.[0] ?? product.main_images?.[0]?.thumb_urls?.[0] ?? "";

      for (const sku of product.skus ?? []) {
        const quantity = (sku.inventory ?? []).reduce(
          (sum, inventoryRow) => sum + (inventoryRow.quantity ?? 0),
          0,
        );

        rows.push({
          productId,
          skuId: String(sku.id ?? ""),
          sellerSku: sku.seller_sku ?? "",
          availableQuantity: quantity,
          productName,
          imageUrl,
          productStatus: product.status,
          skuStatus: sku.status_info?.status,
        });
      }
    }

    nextPageToken = response.data?.next_page_token ?? "";
  } while (nextPageToken);

  const productIdsNeedingImages = Array.from(uniqueProductIds).filter((productId) => {
    return rows.some((row) => row.productId === productId && !row.imageUrl);
  });

  for (const productId of productIdsNeedingImages.slice(0, 24)) {
    try {
      const imageUrl = await getTikTokProductImage(productId);
      if (!imageUrl) {
        continue;
      }

      for (const row of rows) {
        if (row.productId === productId && !row.imageUrl) {
          row.imageUrl = imageUrl;
        }
      }
    } catch (error) {
      logger.warn("tiktok.product.image_fetch_failed", {
        productId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return rows.length > 0 ? rows : fallbackInventory;
}

function safeCompare(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function parseSignatureHeader(headerValue: string | null) {
  if (!headerValue) {
    return null;
  }

  const parts = headerValue.split(",");
  const values = new Map<string, string>();

  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key && value) {
      values.set(key.trim().toLowerCase(), value.trim());
    }
  }

  const timestamp = values.get("t");
  const signature = values.get("s");

  if (!timestamp || !signature) {
    return null;
  }

  return { timestamp, signature };
}

export function verifyTikTokWebhookSignature(rawBody: string, signatureHeader: string | null) {
  if (!config.tiktokClientSecret) {
    return true;
  }

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) {
    return false;
  }

  const signedPayload = `${parsed.timestamp}.${rawBody}`;
  const expectedSignature = crypto
    .createHmac("sha256", config.tiktokClientSecret)
    .update(signedPayload, "utf8")
    .digest("hex");

  return safeCompare(expectedSignature, parsed.signature);
}

export function parseTikTokWebhookPayload(rawBody: string) {
  return JSON.parse(rawBody) as TikTokWebhookPayload;
}

export async function updateShopWebhook(params: {
  address: string;
  eventType: string;
}) {
  type Response = {
    code?: number;
    message?: string;
    data?: unknown;
  };

  const path = "/event/202309/webhooks";
  const body = {
    address: params.address,
    event_type: params.eventType,
  };

  const url = buildTikTokSignedUrl({
    path,
    method: "PUT",
    body,
    version: "202309",
  });

  return tiktokFetchAbsolute<Response>(url, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function getShopWebhooks() {
  type Response = {
    code?: number;
    message?: string;
    data?: unknown;
  };

  const path = "/event/202309/webhooks";
  const url = buildTikTokSignedUrl({
    path,
    method: "GET",
    version: "202309",
  });

  return tiktokFetchAbsolute<Response>(url, {
    method: "GET",
  });
}

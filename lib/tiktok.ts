import { config } from "@/lib/config";
import { readJsonFile, writeJsonFile } from "@/lib/file-store";
import { logger } from "@/lib/logger";
import { withRetry } from "@/lib/retry";
import { AccessTokenTool, ClientConfiguration, TikTokShopNodeApiClient } from "../client";
import type {
  SkuMapping,
  TikTokInventoryRecord,
  TikTokInventoryUpdateInput,
  TikTokWebhookPayload,
} from "@/lib/types";
import crypto from "node:crypto";

type TikTokTokenState = {
  accessToken: string;
  refreshToken: string;
};

let tokenState: TikTokTokenState = {
  accessToken: config.tiktokAccessToken,
  refreshToken: config.tiktokRefreshToken,
};

let refreshPromise: Promise<string> | null = null;

function configureTikTokSdk() {
  ClientConfiguration.globalConfig.app_key = config.tiktokAppKey;
  ClientConfiguration.globalConfig.app_secret = config.tiktokAppSecret;
  ClientConfiguration.globalConfig.basePath = config.tiktokApiBaseUrl;
}

function parseSdkBody<T>(body: unknown): T {
  if (typeof body === "string") {
    return JSON.parse(body) as T;
  }

  return body as T;
}

function isTikTokAuthExpired(status: number, bodyText: string) {
  return (
    status === 401 &&
    (bodyText.includes("Expired credentials") ||
      bodyText.includes("access_token") ||
      bodyText.includes("x-tts-access-token"))
  );
}

async function refreshTikTokAccessToken() {
  if (!tokenState.refreshToken) {
    throw new Error("Missing TIKTOK_REFRESH_TOKEN");
  }

  if (!config.tiktokAppKey || !config.tiktokAppSecret) {
    throw new Error("Missing TIKTOK_APP_KEY or TIKTOK_APP_SECRET");
  }

  if (!refreshPromise) {
    refreshPromise = (async () => {
      configureTikTokSdk();
      const { response, body } = await AccessTokenTool.refreshToken(
        tokenState.refreshToken,
        config.tiktokAppKey,
        config.tiktokAppSecret,
      );
      const payload = parseSdkBody<{
        data?: {
          access_token?: string;
          refresh_token?: string;
        };
        access_token?: string;
        refresh_token?: string;
        code?: number;
        message?: string;
      }>(body);
      logger.info("tiktok.token.refresh_response", {
        status: response.statusCode,
        code: payload.code,
        message: payload.message,
        hasAccessToken: Boolean(payload.data?.access_token ?? payload.access_token),
        hasRefreshToken: Boolean(payload.data?.refresh_token ?? payload.refresh_token),
      });

      if (
        !response.statusCode ||
        response.statusCode < 200 ||
        response.statusCode > 299 ||
        (payload.code !== undefined && payload.code !== 0)
      ) {
        throw new Error(`TikTok token refresh failed: ${JSON.stringify(payload)}`);
      }

      const accessToken = payload.data?.access_token ?? payload.access_token;
      const refreshToken = payload.data?.refresh_token ?? payload.refresh_token;

      if (!accessToken) {
        throw new Error(`TikTok token refresh missing access_token: ${JSON.stringify(payload)}`);
      }

      tokenState = {
        accessToken,
        refreshToken: refreshToken ?? tokenState.refreshToken,
      };

      return accessToken;
    })().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

async function getTikTokAccessToken() {
  if (tokenState.accessToken) {
    return tokenState.accessToken;
  }

  return refreshTikTokAccessToken();
}

function replaceAccessTokenInUrl(url: string, accessToken: string) {
  const parsed = new URL(url);
  parsed.searchParams.set("access_token", accessToken);
  return parsed.toString();
}

async function tiktokFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${config.tiktokApiBaseUrl}${path}`;

  return withRetry(`tiktok:${path}`, async () => {
    const accessToken = await getTikTokAccessToken();
    logger.info("tiktok.request", {
      url,
      method: init?.method ?? "GET",
    });

    const response = await fetch(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-tts-access-token": accessToken,
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

    if (isTikTokAuthExpired(response.status, bodyText)) {
      const refreshedAccessToken = await refreshTikTokAccessToken();
      const retryResponse = await fetch(url, {
        ...init,
        headers: {
          "content-type": "application/json",
          "x-tts-access-token": refreshedAccessToken,
          ...(init?.headers ?? {}),
        },
        cache: "no-store",
      });
      const retryBodyText = await retryResponse.text();

      logger.info("tiktok.response_after_refresh", {
        url,
        status: retryResponse.status,
        body: retryBodyText,
      });

      if (!retryResponse.ok) {
        throw new Error(`TikTok API ${retryResponse.status}: ${retryBodyText}`);
      }

      return JSON.parse(retryBodyText) as T;
    }

    if (!response.ok) {
      throw new Error(`TikTok API ${response.status}: ${bodyText}`);
    }

    return JSON.parse(bodyText) as T;
  });
}

async function tiktokFetchAbsolute<T>(url: string, init?: RequestInit): Promise<T> {
  return withRetry(`tiktok:absolute:${url}`, async () => {
    const accessToken = await getTikTokAccessToken();
    logger.info("tiktok.request", {
      url,
      method: init?.method ?? "GET",
    });

    const response = await fetch(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-tts-access-token": accessToken,
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

    if (isTikTokAuthExpired(response.status, bodyText)) {
      const refreshedAccessToken = await refreshTikTokAccessToken();
      const refreshedUrl = replaceAccessTokenInUrl(url, refreshedAccessToken);
      const retryResponse = await fetch(refreshedUrl, {
        ...init,
        headers: {
          "content-type": "application/json",
          "x-tts-access-token": refreshedAccessToken,
          ...(init?.headers ?? {}),
        },
        cache: "no-store",
      });
      const retryBodyText = await retryResponse.text();

      logger.info("tiktok.response_after_refresh", {
        url: refreshedUrl,
        status: retryResponse.status,
        body: retryBodyText,
      });

      if (!retryResponse.ok) {
        throw new Error(`TikTok API ${retryResponse.status}: ${retryBodyText}`);
      }

      return JSON.parse(retryBodyText) as T;
    }

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
  accessToken?: string;
  includeShopCipher?: boolean;
  includeShopId?: boolean;
}) {
  const version = input.version ?? config.tiktokApiVersion;
  const queryInput: Record<string, string> = {
    access_token: input.accessToken ?? tokenState.accessToken,
    app_key: config.tiktokAppKey,
    timestamp: String(Math.floor(Date.now() / 1000)),
    version,
    ...(input.includeShopCipher === false ? {} : { shop_cipher: config.tiktokShopCipher }),
    ...(input.includeShopId === false || !config.tiktokShopId ? {} : { shop_id: config.tiktokShopId }),
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

export async function exchangeTikTokAuthCode(authCode: string) {
  if (!config.tiktokAppKey || !config.tiktokAppSecret) {
    throw new Error("Missing TIKTOK_APP_KEY or TIKTOK_APP_SECRET");
  }

  type Response = {
    code?: number;
    message?: string;
    data?: {
      access_token?: string;
      refresh_token?: string;
      access_token_expire_in?: number;
      refresh_token_expire_in?: number;
      open_id?: string;
      seller_name?: string;
    };
    access_token?: string;
    refresh_token?: string;
  };

  configureTikTokSdk();
  const { response, body } = await AccessTokenTool.getAccessToken(
    authCode,
    config.tiktokAppKey,
    config.tiktokAppSecret,
  );
  const payload = parseSdkBody<Response>(body);

  logger.info("tiktok.oauth.exchange_response", {
    status: response.statusCode,
    code: payload.code,
    message: payload.message,
    hasAccessToken: Boolean(payload.data?.access_token ?? payload.access_token),
    hasRefreshToken: Boolean(payload.data?.refresh_token ?? payload.refresh_token),
  });

  if (
    !response.statusCode ||
    response.statusCode < 200 ||
    response.statusCode > 299 ||
    (payload.code !== undefined && payload.code !== 0)
  ) {
    throw new Error(`TikTok auth code exchange failed: ${JSON.stringify(payload)}`);
  }

  const accessToken = payload.data?.access_token ?? payload.access_token;
  const refreshToken = payload.data?.refresh_token ?? payload.refresh_token;

  if (!accessToken || !refreshToken) {
    throw new Error(`TikTok auth code exchange missing tokens: ${JSON.stringify(payload)}`);
  }

  tokenState = {
    accessToken,
    refreshToken,
  };

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresIn: payload.data?.access_token_expire_in,
    refreshTokenExpiresIn: payload.data?.refresh_token_expire_in,
  };
}

export async function getAuthorizedTikTokShops(accessToken: string) {
  type Shop = {
    id?: string;
    shop_id?: string;
    cipher?: string;
    shop_cipher?: string;
    name?: string;
    shop_name?: string;
    region?: string;
    shop_region?: string;
  };

  type Response = {
    code?: number;
    message?: string;
    data?: {
      shops?: Shop[];
      authorized_shops?: Shop[];
      shop_list?: Shop[];
    } | Shop[];
  };

  configureTikTokSdk();
  const client = new TikTokShopNodeApiClient({
    config: new ClientConfiguration(
      config.tiktokAppKey,
      config.tiktokAppSecret,
      config.tiktokApiBaseUrl,
    ),
  });
  const { body } = await client.api.AuthorizationV202309Api.ShopsGet(
    accessToken,
    "application/json",
  );
  const response = parseSdkBody<Response>(body);
  const data = response.data;

  if (Array.isArray(data)) {
    return data;
  }

  return data?.shops ?? data?.authorized_shops ?? data?.shop_list ?? [];
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

  const accessToken = await getTikTokAccessToken();
  const body = {};
  const queryInput: Record<string, string> = {
    access_token: accessToken,
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
    (!tokenState.accessToken && !tokenState.refreshToken) ||
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
    const accessToken = await getTikTokAccessToken();
    const body = {
      status: "ALL",
    };
    const queryInput: Record<string, string> = {
      access_token: accessToken,
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
    accessToken: await getTikTokAccessToken(),
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
    accessToken: await getTikTokAccessToken(),
  });

  return tiktokFetchAbsolute<Response>(url, {
    method: "GET",
  });
}

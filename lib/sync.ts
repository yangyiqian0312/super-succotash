import {
  findMappingByShopifyInventoryItemId,
  findMappingByTikTokSkuId,
  getBufferQuantity,
  listSkuMappings,
} from "@/lib/mapping-store";
import { hasProcessedWebhook, markWebhookProcessed } from "@/lib/idempotency-store";
import { logger } from "@/lib/logger";
import { adjustShopifyInventory } from "@/lib/shopify";
import { config } from "@/lib/config";
import {
  getTikTokOrderLines,
  updateTikTokInventory,
  updateTikTokProductFromShopify,
} from "@/lib/tiktok";
import type { ShopifyCatalogItem, TikTokWebhookPayload } from "@/lib/types";
import type { ProductSyncField, SkuMapping } from "@/lib/types";

export async function syncShopifyInventoryToTikTok(input: {
  shopifyInventoryItemId: string;
  available: number;
}) {
  const mapping = await findMappingByShopifyInventoryItemId(input.shopifyInventoryItemId);

  if (!mapping) {
    logger.warn("shopify.sync.mapping_not_found", {
      shopifyInventoryItemId: input.shopifyInventoryItemId,
    });

    return {
      skipped: true,
      reason: "mapping_not_found",
    };
  }

  if (mapping.sync_enabled === false) {
    logger.info("shopify.sync.disabled", {
      shopifyInventoryItemId: input.shopifyInventoryItemId,
      tiktokSkuId: mapping.tiktok_sku_id,
    });

    return {
      skipped: true,
      reason: "sync_disabled",
    };
  }

  const stock = Math.max(0, input.available - getBufferQuantity(mapping));

  logger.info("shopify.sync.calculated_stock", {
    shopifyInventoryItemId: input.shopifyInventoryItemId,
    shopifyAvailable: input.available,
    buffer: getBufferQuantity(mapping),
    tiktokStock: stock,
  });

  const response = await updateTikTokInventory(mapping, stock);

  logger.info("shopify.sync.completed", {
    shopifyInventoryItemId: input.shopifyInventoryItemId,
    tiktokSkuId: mapping.tiktok_sku_id,
    stock,
  });

  return {
    skipped: false,
    stock,
    response,
  };
}

export async function syncShopifyProductToTikTok(input: {
  tiktokSkuId: string;
  shopifyItems: ShopifyCatalogItem[];
  fields?: ProductSyncField[];
}) {
  const mappings = await listSkuMappings();
  const mapping = mappings.find((item) => item.tiktok_sku_id === input.tiktokSkuId);

  if (!mapping) {
    throw new Error("No Shopify mapping found for this TikTok SKU");
  }

  if (mapping.sync_enabled === false) {
    throw new Error("Inventory sync is off for this product. Turn Sync on before product sync.");
  }

  const shopifyItem = input.shopifyItems.find(
    (item) => item.variantId === mapping.shopify_variant_id,
  );

  if (!shopifyItem) {
    throw new Error("Shopify product not found for this mapping");
  }

  const fields = input.fields ?? mapping.product_sync_fields ?? [];
  const productResponse = await updateTikTokProductFromShopify(mapping, shopifyItem, fields);
  const inventoryResponse = await syncShopifyInventoryToTikTok({
    shopifyInventoryItemId: shopifyItem.inventoryItemId,
    available: shopifyItem.inventoryQuantity,
  });

  logger.info("product.sync.completed", {
    tiktokSkuId: mapping.tiktok_sku_id,
    tiktokProductId: mapping.tiktok_product_id,
    shopifyVariantId: mapping.shopify_variant_id,
  });

  return {
    productResponse,
    inventoryResponse,
  };
}

function idsReferToSameShopifyResource(left: string | undefined, right: string | number | undefined) {
  if (!left || right === undefined) {
    return false;
  }

  const rightValue = String(right);
  return left === rightValue || left.endsWith(`/${rightValue}`);
}

async function syncMappedProductFields(mapping: SkuMapping, shopifyItem: ShopifyCatalogItem) {
  const fields = mapping.product_sync_fields ?? [];

  if (fields.length === 0 || mapping.sync_enabled === false) {
    return {
      skipped: true,
      reason: fields.length === 0 ? "no_product_fields_selected" : "sync_disabled",
    };
  }

  const productResponse = await updateTikTokProductFromShopify(mapping, shopifyItem, fields);
  return {
    skipped: false,
    productResponse,
  };
}

export async function syncShopifyProductUpdateToTikTok(input: {
  shopifyProductId?: string | number;
  shopifyVariantIds?: Array<string | number>;
  shopifyItems: ShopifyCatalogItem[];
}) {
  const mappings = await listSkuMappings();
  const variantIds = input.shopifyVariantIds ?? [];
  const results = [];

  for (const mapping of mappings) {
    const shopifyItem = input.shopifyItems.find((item) => {
      const productMatches =
        idsReferToSameShopifyResource(item.productId, input.shopifyProductId) ||
        idsReferToSameShopifyResource(mapping.shopify_product_id, input.shopifyProductId);
      const variantMatches =
        variantIds.length > 0 &&
        variantIds.some(
          (variantId) =>
            idsReferToSameShopifyResource(item.variantId, variantId) ||
            idsReferToSameShopifyResource(mapping.shopify_variant_id, variantId),
        );

      return (
        item.variantId === mapping.shopify_variant_id &&
        (productMatches || variantMatches)
      );
    });

    if (!shopifyItem) {
      continue;
    }

    results.push({
      tiktokSkuId: mapping.tiktok_sku_id,
      tiktokProductId: mapping.tiktok_product_id,
      shopifyVariantId: mapping.shopify_variant_id,
      productSyncFields: mapping.product_sync_fields ?? [],
      priceSyncPercent: mapping.price_sync_percent ?? 100,
      ...(await syncMappedProductFields(mapping, shopifyItem)),
    });
  }

  logger.info("shopify.product_update.sync.completed", {
    shopifyProductId: input.shopifyProductId,
    appliedCount: results.filter((result) => !result.skipped).length,
    resultCount: results.length,
  });

  return results;
}

type ParsedOrderLine = {
  orderId: string;
  skuId: string;
  sellerSku: string;
  quantity: number;
};

type TikTokOrderWebhookContent = {
  orderId: string | null;
  orderStatus: string | null;
};

function normalizeWebhookContent(content: unknown) {
  if (typeof content === "string") {
    return JSON.parse(content) as Record<string, unknown>;
  }

  if (content && typeof content === "object") {
    return content as Record<string, unknown>;
  }

  return {};
}

function readString(value: unknown) {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return null;
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function extractOrderLines(content: Record<string, unknown>): ParsedOrderLine[] {
  const orderId =
    readString(content.order_id) ??
    readString(content.shop_order_id) ??
    readString(content.orderId);

  const rawLines = [
    ...(Array.isArray(content.skus) ? content.skus : []),
    ...(Array.isArray(content.line_items) ? content.line_items : []),
    ...(Array.isArray(content.order_lines) ? content.order_lines : []),
    ...(Array.isArray(content.items) ? content.items : []),
  ];

  if (!orderId || rawLines.length === 0) {
    return [];
  }

  return rawLines
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      orderId,
      skuId:
        readString(item.sku_id) ??
        readString(item.skuId) ??
        "",
      sellerSku:
        readString(item.seller_sku) ??
        readString(item.sellerSku) ??
        "",
      quantity:
        readNumber(item.quantity) ??
        readNumber(item.qty) ??
        readNumber(item.product_count) ??
        0,
    }))
    .filter((line) => (line.skuId.length > 0 || line.sellerSku.length > 0) && line.quantity > 0);
}

function extractTikTokOrderStatusPayload(payload: TikTokWebhookPayload): TikTokOrderWebhookContent {
  const content = normalizeWebhookContent(payload.content);
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};

  return {
    orderId:
      readString(data.order_id) ??
      readString(content.order_id) ??
      readString(content.shop_order_id) ??
      readString(content.orderId),
    orderStatus:
      readString(data.order_status) ??
      readString(content.order_status) ??
      readString(content.orderStatus) ??
      readString(payload.event),
  };
}

function shouldProcessTikTokOrderEvent(payload: TikTokWebhookPayload, orderStatus: string | null) {
  if (orderStatus) {
    return true;
  }

  return Boolean(payload.event && payload.event === config.tiktokOrderEventName);
}

function getInventoryDeltaForTikTokStatus(orderStatus: string | null) {
  const normalized = orderStatus?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (normalized === "AWAITINGSHIPMENT" || normalized === "AWAITSHIPMENT") {
    return -1;
  }

  if (normalized === "CANCEL" || normalized === "CANCELLED" || normalized === "CANCELED") {
    return 1;
  }

  return 0;
}

async function findOrderLineMapping(line: ParsedOrderLine) {
  if (line.skuId) {
    const bySkuId = await findMappingByTikTokSkuId(line.skuId);
    if (bySkuId) {
      return bySkuId;
    }
  }

  if (!line.sellerSku) {
    return null;
  }

  const sellerSku = line.sellerSku.trim().toLowerCase();
  const mappings = await listSkuMappings();
  return (
    mappings.find(
      (mapping) =>
        mapping.tiktok_seller_sku?.trim().toLowerCase() === sellerSku ||
        mapping.internal_sku.trim().toLowerCase() === sellerSku,
    ) ?? null
  );
}

export async function processTikTokOrderWebhook(payload: TikTokWebhookPayload) {
  if (config.tiktokClientKey && payload.client_key && payload.client_key !== config.tiktokClientKey) {
    throw new Error("TikTok client_key mismatch");
  }

  const statusPayload = extractTikTokOrderStatusPayload(payload);

  if (!shouldProcessTikTokOrderEvent(payload, statusPayload.orderStatus)) {
    logger.info("tiktok.webhook.ignored_event", {
      event: payload.event,
      type: payload.type,
      orderStatus: statusPayload.orderStatus,
    });

    return {
      skipped: true,
      reason: "ignored_event",
    };
  }

  const deltaDirection = getInventoryDeltaForTikTokStatus(statusPayload.orderStatus);

  if (!statusPayload.orderId || deltaDirection === 0) {
    logger.info("tiktok.webhook.ignored_status", {
      event: payload.event,
      type: payload.type,
      orderId: statusPayload.orderId,
      orderStatus: statusPayload.orderStatus,
    });

    return {
      skipped: true,
      reason: "ignored_status",
    };
  }

  const content = normalizeWebhookContent(payload.content);
  let orderLines = extractOrderLines(content);

  if (orderLines.length === 0) {
    orderLines = await getTikTokOrderLines(statusPayload.orderId);
  }

  if (orderLines.length === 0) {
    logger.warn("tiktok.webhook.no_order_lines", {
      event: payload.event,
      orderId: statusPayload.orderId,
      orderStatus: statusPayload.orderStatus,
    });

    return {
      skipped: true,
      reason: "no_order_lines",
    };
  }

  let appliedCount = 0;

  for (const line of orderLines) {
    const reserveKey = `tiktok:reserve:${line.orderId}:${line.skuId}`;
    const releaseKey = `tiktok:release:${line.orderId}:${line.skuId}`;
    const idempotencyKey = deltaDirection < 0 ? reserveKey : releaseKey;

    if (await hasProcessedWebhook(idempotencyKey)) {
      logger.info("tiktok.webhook.duplicate", {
        idempotencyKey,
      });
      continue;
    }

    if (deltaDirection > 0 && !(await hasProcessedWebhook(reserveKey))) {
      logger.info("tiktok.webhook.cancel_without_prior_reserve", {
        orderId: line.orderId,
        tiktokSkuId: line.skuId,
      });
      continue;
    }

    const mapping = await findOrderLineMapping(line);
    if (!mapping) {
      logger.warn("tiktok.webhook.mapping_not_found", {
        orderId: line.orderId,
        tiktokSkuId: line.skuId,
        sellerSku: line.sellerSku,
      });
      continue;
    }

    if (mapping.sync_enabled === false) {
      logger.info("tiktok.webhook.sync_disabled", {
        orderId: line.orderId,
        tiktokSkuId: line.skuId,
      });
      continue;
    }

    const availableDelta = deltaDirection * Math.abs(line.quantity);

    logger.info("tiktok.webhook.adjust_shopify_inventory", {
      orderId: line.orderId,
      tiktokSkuId: line.skuId,
      shopifyInventoryItemId: mapping.shopify_inventory_item_id,
      quantity: line.quantity,
      orderStatus: statusPayload.orderStatus,
      availableDelta,
    });

    await adjustShopifyInventory(mapping.shopify_inventory_item_id, availableDelta);
    await markWebhookProcessed(idempotencyKey);
    appliedCount += 1;
  }

  logger.info("tiktok.webhook.completed", {
    event: payload.event,
    orderStatus: statusPayload.orderStatus,
    appliedCount,
  });

  return {
    skipped: false,
    appliedCount,
  };
}

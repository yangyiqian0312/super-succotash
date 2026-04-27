import { findMappingByShopifyInventoryItemId, findMappingByTikTokSkuId, getBufferQuantity } from "@/lib/mapping-store";
import { hasProcessedWebhook, markWebhookProcessed } from "@/lib/idempotency-store";
import { logger } from "@/lib/logger";
import { adjustShopifyInventory } from "@/lib/shopify";
import { config } from "@/lib/config";
import { getTikTokOrderLines, updateTikTokInventory } from "@/lib/tiktok";
import type { TikTokWebhookPayload } from "@/lib/types";

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

type ParsedOrderLine = {
  orderId: string;
  skuId: string;
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
        readString(item.seller_sku) ??
        readString(item.skuId) ??
        "",
      quantity:
        readNumber(item.quantity) ??
        readNumber(item.qty) ??
        readNumber(item.product_count) ??
        0,
    }))
    .filter((line) => line.skuId.length > 0 && line.quantity > 0);
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
  const normalized = orderStatus?.trim().toUpperCase();

  if (normalized === "AWAITING_SHIPMENT") {
    return -1;
  }

  if (normalized === "CANCEL") {
    return 1;
  }

  return 0;
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

    const mapping = await findMappingByTikTokSkuId(line.skuId);
    if (!mapping) {
      logger.warn("tiktok.webhook.mapping_not_found", {
        orderId: line.orderId,
        tiktokSkuId: line.skuId,
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

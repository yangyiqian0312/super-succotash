import { hasDatabase, sql } from "@/lib/db";
import { readJsonFile, writeJsonFile } from "@/lib/file-store";
import type { ListingRequest, ShopifyCatalogItem } from "@/lib/types";

const FILE_NAME = "listing-requests.json";

type ListingRequestRow = {
  id: string;
  shopify_variant_id: string;
  shopify_product_id: string;
  sku: string;
  title: string;
  status: ListingRequest["status"];
  created_at: string;
  tiktok_product_id: string | null;
  error: string | null;
};

function rowToListingRequest(row: ListingRequestRow): ListingRequest {
  return {
    id: row.id,
    shopifyVariantId: row.shopify_variant_id,
    shopifyProductId: row.shopify_product_id,
    sku: row.sku,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    tiktokProductId: row.tiktok_product_id ?? undefined,
    error: row.error ?? undefined,
  };
}

async function loadRequests() {
  if (hasDatabase) {
    const rows = await sql<ListingRequestRow>`
      SELECT * FROM listing_requests ORDER BY created_at DESC
    `;
    return rows.map(rowToListingRequest);
  }

  return readJsonFile<ListingRequest[]>(FILE_NAME, []);
}

async function saveListingRequest(request: ListingRequest) {
  if (!hasDatabase) {
    return;
  }

  await sql`
    INSERT INTO listing_requests (
      id,
      shopify_variant_id,
      shopify_product_id,
      sku,
      title,
      status,
      created_at,
      tiktok_product_id,
      error,
      updated_at
    )
    VALUES (
      ${request.id},
      ${request.shopifyVariantId},
      ${request.shopifyProductId},
      ${request.sku},
      ${request.title},
      ${request.status},
      ${request.createdAt},
      ${request.tiktokProductId ?? null},
      ${request.error ?? null},
      NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      shopify_variant_id = EXCLUDED.shopify_variant_id,
      shopify_product_id = EXCLUDED.shopify_product_id,
      sku = EXCLUDED.sku,
      title = EXCLUDED.title,
      status = EXCLUDED.status,
      tiktok_product_id = EXCLUDED.tiktok_product_id,
      error = EXCLUDED.error,
      updated_at = NOW()
  `;
}

export async function listListingRequests() {
  return loadRequests();
}

export async function findListingRequestById(id: string) {
  const requests = await loadRequests();
  return requests.find((request) => request.id === id) ?? null;
}

export async function createListingRequests(items: ShopifyCatalogItem[]) {
  const current = await loadRequests();
  const now = new Date().toISOString();
  const next = [...current];

  for (const item of items) {
    const exists = current.find((request) => request.shopifyVariantId === item.variantId);
    if (exists) {
      continue;
    }

    next.push({
      id: `${item.variantId}-${Date.now()}`,
      shopifyVariantId: item.variantId,
      shopifyProductId: item.productId,
      sku: item.sku,
      title: `${item.productTitle} - ${item.variantTitle}`,
      status: "needs_details",
      createdAt: now,
    });
  }

  if (hasDatabase) {
    for (const request of next.slice(current.length)) {
      await saveListingRequest(request);
    }
  } else {
    await writeJsonFile(FILE_NAME, next);
  }

  return next;
}

export async function createOrUpdateListingRequest(params: {
  item: ShopifyCatalogItem;
  status: ListingRequest["status"];
  tiktokProductId?: string;
  error?: string;
}) {
  const current = await loadRequests();
  const now = new Date().toISOString();
  const existingIndex = current.findIndex(
    (request) => request.shopifyVariantId === params.item.variantId,
  );
  const request: ListingRequest = {
    id:
      existingIndex >= 0
        ? current[existingIndex].id
        : `${params.item.variantId}-${Date.now()}`,
    shopifyVariantId: params.item.variantId,
    shopifyProductId: params.item.productId,
    sku: params.item.sku,
    title: `${params.item.productTitle} - ${params.item.variantTitle}`,
    status: params.status,
    createdAt: existingIndex >= 0 ? current[existingIndex].createdAt : now,
    tiktokProductId: params.tiktokProductId,
    error: params.error,
  };

  const next = [...current];
  if (existingIndex >= 0) {
    next[existingIndex] = request;
  } else {
    next.push(request);
  }

  if (hasDatabase) {
    await saveListingRequest(request);
  } else {
    await writeJsonFile(FILE_NAME, next);
  }

  return next;
}

export async function updateListingRequestStatus(params: {
  id: string;
  status: ListingRequest["status"];
  tiktokProductId?: string;
  error?: string;
}) {
  const current = await loadRequests();
  const index = current.findIndex((request) => request.id === params.id);

  if (index < 0) {
    throw new Error("Listing request not found");
  }

  const next = [...current];
  next[index] = {
    ...next[index],
    status: params.status,
    tiktokProductId: params.tiktokProductId ?? next[index].tiktokProductId,
    error: params.error,
  };

  if (hasDatabase) {
    await saveListingRequest(next[index]);
  } else {
    await writeJsonFile(FILE_NAME, next);
  }

  return next[index];
}

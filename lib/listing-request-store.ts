import { readJsonFile, writeJsonFile } from "@/lib/file-store";
import type { ListingRequest, ShopifyCatalogItem } from "@/lib/types";

const FILE_NAME = "listing-requests.json";

async function loadRequests() {
  return readJsonFile<ListingRequest[]>(FILE_NAME, []);
}

export async function listListingRequests() {
  return loadRequests();
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

  await writeJsonFile(FILE_NAME, next);
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

  await writeJsonFile(FILE_NAME, next);
  return next;
}

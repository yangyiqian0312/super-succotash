"use client";

import { useDeferredValue, useMemo, useState, useTransition } from "react";
import type { DashboardData, ProductSyncField, ShopifyCatalogItem } from "@/lib/types";

type Props = {
  initialData: DashboardData;
  initialNotice?: string | null;
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const payload = text
    ? (JSON.parse(text) as T & { error?: string })
    : ({ error: `Empty response from ${url}` } as T & { error?: string });

  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed");
  }

  return payload;
}

const productFieldOptions: Array<{ field: ProductSyncField; label: string }> = [
  { field: "name", label: "Name" },
  { field: "price", label: "Price" },
  { field: "description", label: "Description" },
  { field: "image", label: "Image" },
];

export default function DashboardClient({ initialData, initialNotice }: Props) {
  const [data, setData] = useState(initialData);
  const [search, setSearch] = useState("");
  const [selectedShopifyIds, setSelectedShopifyIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<string>(initialNotice ?? "Ready");
  const [activeTab, setActiveTab] = useState<"tiktok" | "shopify">("tiktok");
  const [activeSyncModalSkuId, setActiveSyncModalSkuId] = useState<string | null>(null);
  const [productFieldDrafts, setProductFieldDrafts] = useState<Record<string, ProductSyncField[]>>(
    {},
  );
  const [pricePercentDrafts, setPricePercentDrafts] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();
  const deferredSearch = useDeferredValue(search);
  const activeSyncRow =
    data.tiktokRows.find((row) => row.tiktok.skuId === activeSyncModalSkuId) ?? null;

  const filteredTikTokRows = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    if (!query) {
      return data.tiktokRows;
    }

    return data.tiktokRows.filter((row) => {
      const values = [
        row.tiktok.productName,
        row.tiktok.sellerSku,
        row.shopifyMatch?.productTitle ?? "",
        row.shopifyMatch?.variantTitle ?? "",
      ];

      return values.some((value) => value.toLowerCase().includes(query));
    });
  }, [data.tiktokRows, deferredSearch]);

  const filteredShopify = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    if (!query) {
      return data.shopifyUnlisted;
    }

    return data.shopifyUnlisted.filter((item) =>
      [item.productTitle, item.variantTitle, item.sku].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [data.shopifyUnlisted, deferredSearch]);

  const toggleSelection = (variantId: string) => {
    setSelectedShopifyIds((current) =>
      current.includes(variantId)
        ? current.filter((item) => item !== variantId)
        : [...current, variantId],
    );
  };

  const getProductFieldDraft = (tiktokSkuId: string) => {
    const row = data.tiktokRows.find((item) => item.tiktok.skuId === tiktokSkuId);
    return productFieldDrafts[tiktokSkuId] ?? row?.mapping?.product_sync_fields ?? [];
  };

  const getPricePercentDraft = (tiktokSkuId: string) => {
    const row = data.tiktokRows.find((item) => item.tiktok.skuId === tiktokSkuId);
    return pricePercentDrafts[tiktokSkuId] ?? String(row?.mapping?.price_sync_percent ?? 100);
  };

  const openSyncModal = (tiktokSkuId: string) => {
    setActiveSyncModalSkuId(tiktokSkuId);
    setProductFieldDrafts((current) => ({
      ...current,
      [tiktokSkuId]: getProductFieldDraft(tiktokSkuId),
    }));
    setPricePercentDrafts((current) => ({
      ...current,
      [tiktokSkuId]: getPricePercentDraft(tiktokSkuId),
    }));
    setNotice("Choose product fields, then save sync.");
  };

  const saveSyncSettings = (tiktokSkuId: string) => {
    const productSyncFields = getProductFieldDraft(tiktokSkuId);

    startTransition(async () => {
      try {
        setNotice("Saving sync settings...");
        const payload = await postJson<{ ok: true; data: DashboardData }>("/api/mappings", {
          tiktokSkuId,
          syncEnabled: true,
          productSyncFields,
          priceSyncPercent: Number(getPricePercentDraft(tiktokSkuId)),
        });
        setData(payload.data);
        setActiveSyncModalSkuId(null);
        setNotice("Inventory sync enabled. Selected fields will auto-sync from Shopify.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not save sync settings.");
      }
    });
  };

  const turnOffSync = (tiktokSkuId: string) => {
    startTransition(async () => {
      try {
        setNotice("Turning sync off...");
        const payload = await postJson<{ ok: true; data: DashboardData }>("/api/mappings", {
          tiktokSkuId,
          syncEnabled: false,
        });
        setData(payload.data);
        setActiveSyncModalSkuId(null);
        setNotice("Inventory sync turned off.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not update sync setting.");
      }
    });
  };

  const toggleProductField = (tiktokSkuId: string, field: ProductSyncField) => {
    setProductFieldDrafts((current) => {
      const currentFields = getProductFieldDraft(tiktokSkuId);
      const nextFields = currentFields.includes(field)
        ? currentFields.filter((item) => item !== field)
        : [...currentFields, field];

      return {
        ...current,
        [tiktokSkuId]: nextFields,
      };
    });
  };

  const createListings = () => {
    startTransition(async () => {
      try {
        setNotice("Creating TikTok draft listings...");
        const payload = await postJson<{ ok: true; data: DashboardData }>("/api/listings", {
          shopifyVariantIds: selectedShopifyIds,
        });
        setData(payload.data);
        setSelectedShopifyIds([]);
        setNotice("TikTok draft attempt finished.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not create TikTok drafts.");
      }
    });
  };

  const connectListing = (listingRequestId: string) => {
    startTransition(async () => {
      try {
        setNotice("Connecting draft to Shopify...");
        const payload = await postJson<{ ok: true; data: DashboardData }>("/api/listings", {
          action: "connect",
          listingRequestId,
        });
        setData(payload.data);
        setNotice("Draft connected to Shopify inventory.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not connect draft.");
      }
    });
  };

  return (
    <main className="dashboard-shell">
      <section className="toolbar">
        <div className="tab-switcher" role="tablist" aria-label="Main sections">
          <button
            className={`tab-button ${activeTab === "tiktok" ? "active" : ""}`}
            onClick={() => setActiveTab("tiktok")}
            role="tab"
            aria-selected={activeTab === "tiktok"}
            type="button"
          >
            TikTok Sync
          </button>
          <button
            className={`tab-button ${activeTab === "shopify" ? "active" : ""}`}
            onClick={() => setActiveTab("shopify")}
            role="tab"
            aria-selected={activeTab === "shopify"}
            type="button"
          >
            Shopify Listings
          </button>
        </div>
        <input
          aria-label="Search catalog"
          className="search-input"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={
            activeTab === "tiktok"
              ? "Search TikTok products or SKU"
              : "Search Shopify products or SKU"
          }
        />
        <div className="shop-chip">
          {data.shopifyConnection.shopDomain}
          {data.shopifyConnection.locationId
            ? ` · Location ${data.shopifyConnection.locationId}`
            : ""}
          {data.shopifyConnection.connected
            ? ` · ${data.shopifyConnection.mode === "client_credentials" ? "Client credentials" : "Static token"}`
            : " · Connection failed"}
        </div>
        <div className="notice-chip" data-pending={isPending}>
          {notice}
        </div>
      </section>

      {activeTab === "tiktok" ? (
        <section className="panel single-panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">TikTok Inventory Sync</p>
              <h2>Choose which TikTok products should follow Shopify inventory</h2>
            </div>
          </div>

          <div className="card-list">
            {filteredTikTokRows.map((row) => (
              <article className="catalog-card" key={row.tiktok.skuId}>
                <div className="catalog-visual">
                  {row.tiktok.imageUrl ? (
                    <img
                      className="catalog-image"
                      src={row.tiktok.imageUrl}
                      alt={row.tiktok.productName}
                    />
                  ) : (
                    <div className="catalog-image placeholder">No image</div>
                  )}
                </div>
                <div className="catalog-main">
                  <div className="catalog-badge">{row.tiktok.availableQuantity} in TikTok</div>
                  <h3>{row.tiktok.productName}</h3>
                  <p className="sku-line">TikTok SKU: {row.tiktok.sellerSku}</p>
                  {row.tiktok.variantTitle ? (
                    <p className="sku-line">TikTok Variant: {row.tiktok.variantTitle}</p>
                  ) : null}
                  <p className="match-line">
                    {row.shopifyMatch
                      ? `Matched to Shopify: ${row.shopifyMatch.productTitle} / ${row.shopifyMatch.variantTitle}`
                      : "No Shopify SKU match found yet"}
                  </p>
                </div>
                <div className="catalog-action">
                  <label className={`sync-toggle ${row.syncEnabled ? "is-on" : ""}`}>
                    <input
                      type="checkbox"
                      checked={row.syncEnabled}
                      disabled={!row.canEnableSync || isPending}
                      onChange={() => openSyncModal(row.tiktok.skuId)}
                    />
                    <span>{row.syncEnabled ? "Sync on" : "Sync off"}</span>
                  </label>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <section className="panel single-panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Shopify To TikTok Listings</p>
              <h2>Choose Shopify products that should become new TikTok listings</h2>
            </div>
            <button
              className="primary-button"
              disabled={selectedShopifyIds.length === 0 || isPending}
              onClick={createListings}
            >
              Create TikTok draft
            </button>
          </div>

          <div className="card-list">
            {filteredShopify.map((item) => (
              <ShopifyChoiceCard
                key={item.variantId}
                item={item}
                checked={selectedShopifyIds.includes(item.variantId)}
                onToggle={() => toggleSelection(item.variantId)}
              />
            ))}
          </div>
        </section>
      )}

      <section className="panel queue-panel">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Queue</p>
            <h2>Listing requests</h2>
          </div>
        </div>

        <div className="queue-list">
          {data.listingRequests.length === 0 ? (
            <p className="empty-state">No listing requests yet.</p>
          ) : (
            data.listingRequests.map((request) => (
              <article className="queue-item" key={request.id}>
                <div>
                  <h3>{request.title}</h3>
                  <p className="sku-line">SKU: {request.sku}</p>
                  {request.tiktokProductId ? (
                    <p className="match-line">TikTok product ID: {request.tiktokProductId}</p>
                  ) : null}
                  {request.error ? <p className="error-line">{request.error}</p> : null}
                </div>
                <div className="queue-actions">
                  <span className="status-pill">{request.status.replace("_", " ")}</span>
                  {request.status === "tiktok_draft_created" && request.tiktokProductId ? (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={isPending}
                      onClick={() => connectListing(request.id)}
                    >
                      Connect Shopify
                    </button>
                  ) : null}
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="panel activity-panel">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Activity</p>
            <h2>Sync log</h2>
          </div>
        </div>

        <div className="activity-list">
          {data.activityLog.length === 0 ? (
            <p className="empty-state">No sync activity yet.</p>
          ) : (
            data.activityLog.map((entry, index) => (
              <article className="activity-item" key={`${entry.createdAt}-${index}`}>
                <div>
                  <div className="activity-title">
                    <span className="status-pill">{entry.status.replaceAll("_", " ")}</span>
                    <strong>{formatActivityTitle(entry)}</strong>
                  </div>
                  <p className="match-line">{formatActivityDetails(entry.details)}</p>
                </div>
                <time className="activity-time">{formatActivityTime(entry.createdAt)}</time>
              </article>
            ))
          )}
        </div>
      </section>

      {activeSyncRow ? (
        <div className="modal-backdrop" role="presentation">
          <section className="sync-modal" role="dialog" aria-modal="true" aria-labelledby="sync-modal-title">
            <div className="modal-header">
              <div>
                <p className="panel-kicker">Sync Settings</p>
                <h2 id="sync-modal-title">Choose Shopify fields</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close sync settings"
                onClick={() => setActiveSyncModalSkuId(null)}
              >
                x
              </button>
            </div>

            <div className="modal-product">
              <strong>{activeSyncRow.tiktok.productName}</strong>
              <span>{activeSyncRow.tiktok.sellerSku}</span>
            </div>

            <div className="modal-field-grid">
              {productFieldOptions.map((option) => (
                <label className="modal-field-choice" key={option.field}>
                  <input
                    type="checkbox"
                    checked={getProductFieldDraft(activeSyncRow.tiktok.skuId).includes(option.field)}
                    disabled={isPending}
                    onChange={() => toggleProductField(activeSyncRow.tiktok.skuId, option.field)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>

            {getProductFieldDraft(activeSyncRow.tiktok.skuId).includes("price") ? (
              <label className="percent-control">
                <span>TikTok price percentage</span>
                <div>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    step="0.01"
                    value={getPricePercentDraft(activeSyncRow.tiktok.skuId)}
                    onChange={(event) =>
                      setPricePercentDrafts((current) => ({
                        ...current,
                        [activeSyncRow.tiktok.skuId]: event.target.value,
                      }))
                    }
                  />
                  <span>% of Shopify price</span>
                </div>
              </label>
            ) : null}

            <div className="modal-actions">
              {activeSyncRow.syncEnabled ? (
                <button
                  className="danger-button"
                  type="button"
                  disabled={isPending}
                  onClick={() => turnOffSync(activeSyncRow.tiktok.skuId)}
                >
                  Turn off
                </button>
              ) : null}
              <button
                className="secondary-button"
                type="button"
                onClick={() => setActiveSyncModalSkuId(null)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={getProductFieldDraft(activeSyncRow.tiktok.skuId).length === 0 || isPending}
                onClick={() => saveSyncSettings(activeSyncRow.tiktok.skuId)}
              >
                Save sync
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function formatActivityTitle(entry: DashboardData["activityLog"][number]) {
  if (entry.source === "tiktok.webhook") {
    return `TikTok order ${readDetailString(entry.details, "orderId") || entry.topic || ""}`;
  }

  if (entry.source === "shopify.webhook") {
    return `Shopify ${entry.topic || "webhook"}`;
  }

  return entry.source;
}

function formatActivityDetails(details: unknown) {
  if (!details || typeof details !== "object") {
    return "";
  }

  const record = details as Record<string, unknown>;
  const result = record.result && typeof record.result === "object"
    ? (record.result as Record<string, unknown>)
    : null;
  const lineResults = Array.isArray(result?.lineResults) ? result.lineResults : [];

  if (lineResults.length > 0) {
    return lineResults
      .map((line) => {
        const item = line as Record<string, unknown>;
        const status = item.skipped ? `Skipped: ${item.reason ?? "unknown"}` : "Adjusted";
        const sku = item.sellerSku || item.tiktokSkuId || "unknown SKU";
        const quantity = item.quantity ? `qty ${item.quantity}` : "";
        const delta = item.availableDelta ? `delta ${item.availableDelta}` : "";
        return [status, sku, quantity, delta].filter(Boolean).join(" · ");
      })
      .join(" | ");
  }

  const pieces = [
    readDetailString(details, "orderStatus"),
    readDetailString(details, "orderId"),
    readDetailString(details, "error"),
    result?.appliedCount !== undefined ? `applied ${String(result.appliedCount)}` : "",
    result?.reason ? `reason ${String(result.reason)}` : "",
  ];

  return pieces.filter(Boolean).join(" · ");
}

function readDetailString(details: unknown, key: string) {
  if (!details || typeof details !== "object") {
    return "";
  }

  const value = (details as Record<string, unknown>)[key];
  return value === undefined || value === null ? "" : String(value);
}

function formatActivityTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function ShopifyChoiceCard({
  item,
  checked,
  onToggle,
}: {
  item: ShopifyCatalogItem;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className={`catalog-card selectable ${checked ? "selected" : ""}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <div className="catalog-visual">
        {item.imageUrl ? (
          <img className="catalog-image" src={item.imageUrl} alt={item.productTitle} />
        ) : (
          <div className="catalog-image placeholder">No image</div>
        )}
      </div>
      <div className="catalog-main">
        <div className="catalog-badge">{item.inventoryQuantity} in Shopify</div>
        <h3>{item.productTitle}</h3>
        <p className="sku-line">{item.variantTitle}</p>
        <p className="match-line">SKU: {item.sku || "Missing SKU"}</p>
      </div>
    </label>
  );
}

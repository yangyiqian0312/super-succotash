"use client";

import { useDeferredValue, useMemo, useState, useTransition } from "react";
import type { DashboardData, ShopifyCatalogItem } from "@/lib/types";

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

  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed");
  }

  return payload;
}

export default function DashboardClient({ initialData, initialNotice }: Props) {
  const [data, setData] = useState(initialData);
  const [search, setSearch] = useState("");
  const [selectedShopifyIds, setSelectedShopifyIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<string>(initialNotice ?? "Ready");
  const [activeTab, setActiveTab] = useState<"tiktok" | "shopify">("tiktok");
  const [isPending, startTransition] = useTransition();
  const deferredSearch = useDeferredValue(search);

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

  const toggleSync = (tiktokSkuId: string, syncEnabled: boolean) => {
    startTransition(async () => {
      try {
        setNotice(syncEnabled ? "Enabling sync..." : "Turning sync off...");
        const payload = await postJson<{ ok: true; data: DashboardData }>("/api/mappings", {
          tiktokSkuId,
          syncEnabled,
        });
        setData(payload.data);
        setNotice(syncEnabled ? "Inventory sync enabled." : "Inventory sync turned off.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not update sync setting.");
      }
    });
  };

  const createListings = () => {
    startTransition(async () => {
      try {
        setNotice("Creating listing requests...");
        const payload = await postJson<{ ok: true; data: DashboardData }>("/api/listings", {
          shopifyVariantIds: selectedShopifyIds,
        });
        setData(payload.data);
        setSelectedShopifyIds([]);
        setNotice("Listing requests created.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not create listing requests.");
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
                      onChange={(event) => toggleSync(row.tiktok.skuId, event.target.checked)}
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
              Create listing request
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
                </div>
                <span className="status-pill">{request.status.replace("_", " ")}</span>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
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

import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { SpApiService } from "../dist/sp-api-service.js";

const config = {
  defaultStore: "primary",
  stores: {
    primary: {
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshToken: "refresh-token",
      sellerId: "seller-id",
      region: "NA",
      marketplaceId: "ATVPDKIKX0DER",
      sandbox: false,
    },
  },
};

function recordingService(overrides = {}) {
  const calls = [];
  const api = new Proxy(overrides, {
    get(target, property) {
      if (property in target) return target[property];
      return async (...args) => {
        calls.push({ method: String(property), args });
        return { method: String(property), args };
      };
    },
  });
  return {
    service: new SpApiService(config, () => api),
    calls,
  };
}

test("maps FBA inventory and order requests to the official SDK", async () => {
  const { service, calls } = recordingService();
  await service.getFbaInventory({ sellerSkus: ["SKU-1"] });
  await service.getOrders({
    createdAfter: "2026-07-01T00:00:00Z",
    fulfillmentChannels: ["AFN"],
  });

  assert.equal(calls[0].method, "getInventorySummaries");
  assert.deepEqual(calls[0].args.slice(0, 3), [
    "Marketplace",
    "ATVPDKIKX0DER",
    ["ATVPDKIKX0DER"],
  ]);
  assert.deepEqual(calls[0].args[3].sellerSkus, ["SKU-1"]);
  assert.equal(calls[1].method, "getOrders");
  assert.deepEqual(calls[1].args[0], ["ATVPDKIKX0DER"]);
  assert.equal(calls[1].args[1].fulfillmentChannels[0], "AFN");
});

test("validates ambiguous catalog, pricing, order, and report inputs", async () => {
  const { service } = recordingService();
  await assert.rejects(() => service.getOrders({}), /createdAfter/);
  await assert.rejects(
    () =>
      service.searchCatalogItems({ keywords: ["shoe"], identifiers: ["x"] }),
    /either keywords or identifiers/,
  );
  await assert.rejects(
    () => service.getCompetitivePricing({ itemType: "Asin" }),
    /asins are required/,
  );
  await assert.rejects(
    () => service.listReports({}),
    /reportTypes or nextToken/,
  );
});

test("never returns Amazon-signed report document URLs", async () => {
  const { service } = recordingService({
    getReportDocument: async () => ({
      url: "https://example.s3.amazonaws.com/signed?secret=value",
      compressionAlgorithm: "GZIP",
    }),
  });
  const result = await service.getReportDocument("primary", "doc-1");
  assert.deepEqual(result, {
    reportDocumentId: "doc-1",
    compressionAlgorithm: "GZIP",
    downloadAvailable: true,
  });
  assert.doesNotMatch(JSON.stringify(result), /signed|secret|amazonaws/);
});

test("downloads and decompresses report documents only from Amazon hosts", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response(gzipSync(Buffer.from("sku\tquantity\nABC\t3\n")), {
      status: 200,
    });

  const { service } = recordingService({
    getReportDocument: async () => ({
      url: "https://reports.s3.amazonaws.com/document",
      compressionAlgorithm: "GZIP",
    }),
  });
  const result = await service.downloadReportDocument({
    reportDocumentId: "doc-1",
    maxBytes: 10_000,
  });
  assert.equal(result.content, "sku\tquantity\nABC\t3\n");
  assert.equal(result.bytes, 19);

  const blocked = recordingService({
    getReportDocument: async () => ({
      url: "https://attacker.example/document",
    }),
  }).service;
  await assert.rejects(
    () => blocked.downloadReportDocument({ reportDocumentId: "doc-2" }),
    /security validation/,
  );
});

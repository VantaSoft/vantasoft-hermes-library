import assert from "node:assert/strict";
import test from "node:test";
import * as sdk from "@amazon-sp-api-release/amazon-sp-api-sdk-js";

const expected = [
  [
    sdk.SellersSpApi,
    "SellersApi",
    ["getAccount", "getMarketplaceParticipations"],
  ],
  [sdk.FbainventorySpApi, "FbaInventoryApi", ["getInventorySummaries"]],
  [sdk.OrdersSpApi, "OrdersV0Api", ["getOrders", "getOrder", "getOrderItems"]],
  [
    sdk.CatalogitemsSpApi,
    "CatalogApi",
    ["getCatalogItem", "searchCatalogItems"],
  ],
  [
    sdk.ListingsitemsSpApi,
    "ListingsApi",
    ["getListingsItem", "searchListingsItems", "patchListingsItem"],
  ],
  [
    sdk.Pricing_v0SpApi,
    "ProductPricingApi",
    ["getCompetitivePricing", "getItemOffers"],
  ],
  [
    sdk.FinancesSpApi,
    "DefaultApi",
    ["listFinancialEvents", "listFinancialEventsByOrderId"],
  ],
  [
    sdk.ReportsSpApi,
    "ReportsApi",
    ["createReport", "getReport", "getReports", "getReportDocument"],
  ],
  [
    sdk.FulfillmentinboundSpApi,
    "FbaInboundApi",
    [
      "listInboundPlans",
      "getInboundPlan",
      "getShipment",
      "listInboundPlanItems",
    ],
  ],
  [sdk.FbaeligibilitySpApi, "FbaInboundApi", ["getItemEligibilityPreview"]],
  [sdk.ProductfeesSpApi, "FeesApi", ["getMyFeesEstimateForASIN"]],
  [
    sdk.SolicitationsSpApi,
    "SolicitationsApi",
    [
      "getSolicitationActionsForOrder",
      "createProductReviewAndSellerFeedbackSolicitation",
    ],
  ],
];

test("pinned official Amazon SDK exposes every API operation used by the MCP", () => {
  for (const [namespace, className, methods] of expected) {
    assert.equal(
      typeof namespace.ApiClient,
      "function",
      `${className} ApiClient`,
    );
    assert.equal(typeof namespace[className], "function", className);
    for (const method of methods) {
      assert.equal(
        typeof namespace[className].prototype[method],
        "function",
        `${className}.${method}`,
      );
    }
  }
});

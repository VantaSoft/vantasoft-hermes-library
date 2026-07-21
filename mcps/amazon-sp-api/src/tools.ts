import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";
import { sanitizeError } from "./errors.js";
import type { SpApiService } from "./sp-api-service.js";

const store = z
  .string()
  .min(1)
  .optional()
  .describe("Configured store name. Omit to use the default store.");
const marketplaceId = z
  .string()
  .min(1)
  .optional()
  .describe("Amazon marketplace ID. Omit to use the store default.");
const marketplaceIds = z
  .array(z.string().min(1))
  .min(1)
  .max(20)
  .optional()
  .describe("Amazon marketplace IDs. Omit to use the store default.");
const isoDateTime = z
  .string()
  .datetime({ offset: true })
  .describe("ISO 8601 date-time including a timezone offset.");

function text(value: unknown, isError = false) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value ?? null, null, 2),
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

function register<T extends ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  schema: T,
  handler: (args: z.infer<z.ZodObject<T>>) => Promise<unknown>,
  annotations: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  } = {},
): void {
  const registerTool = server.registerTool.bind(server) as unknown as (
    name: string,
    config: {
      description: string;
      inputSchema: ZodRawShape;
      annotations: Record<string, boolean>;
    },
    callback: (args: Record<string, unknown>) => Promise<unknown>,
  ) => unknown;
  registerTool(
    name,
    {
      description,
      inputSchema: schema,
      annotations: {
        readOnlyHint: annotations.readOnlyHint ?? true,
        destructiveHint: annotations.destructiveHint ?? false,
        idempotentHint: annotations.idempotentHint ?? true,
        openWorldHint: annotations.openWorldHint ?? true,
      },
    },
    async (args) => {
      try {
        return text(await handler(args as z.infer<z.ZodObject<T>>));
      } catch (error) {
        return text(sanitizeError(error), true);
      }
    },
  );
}

export function registerTools(
  server: McpServer,
  service: SpApiService,
  options: { enableMutations: boolean },
): void {
  register(
    server,
    "spapi_list_stores",
    "List configured Amazon SP-API stores without exposing credentials or seller identifiers",
    {},
    async () => service.listStores(),
  );

  register(
    server,
    "spapi_get_account",
    "Get the Amazon selling-partner account and marketplace summary",
    { store },
    async ({ store }) => service.getAccount(store),
  );

  register(
    server,
    "spapi_get_marketplace_participations",
    "List marketplaces where the seller can participate and their participation status",
    { store },
    async ({ store }) => service.getMarketplaceParticipations(store),
  );

  register(
    server,
    "spapi_get_fba_inventory",
    "Get FBA inventory summaries with pagination and optional SKU or change-date filters",
    {
      store,
      marketplaceId,
      details: z.boolean().optional().default(true),
      startDateTime: isoDateTime.optional(),
      sellerSkus: z.array(z.string().min(1)).min(1).max(50).optional(),
      nextToken: z.string().min(1).optional(),
    },
    async (args) => service.getFbaInventory(args),
  );

  register(
    server,
    "spapi_get_orders",
    "List Seller Central orders by creation or update date; supports statuses, FBA/MFN channel filters, and pagination",
    {
      store,
      marketplaceIds,
      createdAfter: isoDateTime.optional(),
      createdBefore: isoDateTime.optional(),
      lastUpdatedAfter: isoDateTime.optional(),
      lastUpdatedBefore: isoDateTime.optional(),
      orderStatuses: z.array(z.string().min(1)).min(1).max(20).optional(),
      fulfillmentChannels: z
        .array(z.enum(["AFN", "MFN"]))
        .min(1)
        .max(2)
        .optional(),
      maxResultsPerPage: z.number().int().min(1).max(100).optional(),
      nextToken: z.string().min(1).optional(),
    },
    async (args) => service.getOrders(args),
  );

  register(
    server,
    "spapi_get_order",
    "Get one Seller Central order by Amazon order ID, excluding restricted buyer-address tools",
    { store, orderId: z.string().min(1) },
    async ({ store, orderId }) => service.getOrder(store, orderId),
  );

  register(
    server,
    "spapi_get_order_items",
    "Get items for one Seller Central order with pagination",
    {
      store,
      orderId: z.string().min(1),
      nextToken: z.string().min(1).optional(),
    },
    async ({ store, orderId, nextToken }) =>
      service.getOrderItems(store, orderId, nextToken),
  );

  register(
    server,
    "spapi_get_catalog_item",
    "Get an Amazon catalog item by ASIN",
    {
      store,
      marketplaceIds,
      asin: z.string().min(1),
      includedData: z.array(z.string().min(1)).min(1).max(20).optional(),
      locale: z.string().min(2).optional(),
    },
    async (args) => service.getCatalogItem(args),
  );

  register(
    server,
    "spapi_search_catalog_items",
    "Search the Amazon catalog by keywords or product identifiers with pagination",
    {
      store,
      marketplaceIds,
      keywords: z.array(z.string().min(1)).min(1).max(20).optional(),
      identifiers: z.array(z.string().min(1)).min(1).max(20).optional(),
      identifiersType: z.string().min(1).optional(),
      includedData: z.array(z.string().min(1)).min(1).max(20).optional(),
      pageSize: z.number().int().min(1).max(20).optional(),
      pageToken: z.string().min(1).optional(),
    },
    async (args) => service.searchCatalogItems(args),
  );

  register(
    server,
    "spapi_get_listing_item",
    "Get one seller listing by SKU",
    {
      store,
      marketplaceIds,
      sku: z.string().min(1),
      includedData: z.array(z.string().min(1)).min(1).max(20).optional(),
      issueLocale: z.string().min(2).optional(),
    },
    async (args) => service.getListingItem(args),
  );

  register(
    server,
    "spapi_search_listing_items",
    "Search seller listings with identifier, status, issue-severity, and pagination filters",
    {
      store,
      marketplaceIds,
      identifiers: z.array(z.string().min(1)).min(1).max(20).optional(),
      identifiersType: z.string().min(1).optional(),
      includedData: z.array(z.string().min(1)).min(1).max(20).optional(),
      withIssueSeverity: z.array(z.string().min(1)).min(1).max(10).optional(),
      withStatus: z.array(z.string().min(1)).min(1).max(10).optional(),
      pageSize: z.number().int().min(1).max(20).optional(),
      pageToken: z.string().min(1).optional(),
    },
    async (args) => service.searchListingItems(args),
  );

  register(
    server,
    "spapi_get_competitive_pricing",
    "Get competitive pricing for up to 20 ASINs or seller SKUs",
    {
      store,
      marketplaceId,
      itemType: z.enum(["Asin", "Sku"]),
      asins: z.array(z.string().min(1)).min(1).max(20).optional(),
      skus: z.array(z.string().min(1)).min(1).max(20).optional(),
      customerType: z.enum(["Consumer", "Business"]).optional(),
    },
    async (args) => service.getCompetitivePricing(args),
  );

  register(
    server,
    "spapi_get_item_offers",
    "Get the lowest-priced offers for one ASIN",
    {
      store,
      marketplaceId,
      asin: z.string().min(1),
      itemCondition: z
        .enum(["New", "Used", "Collectible", "Refurbished", "Club"])
        .optional(),
      customerType: z.enum(["Consumer", "Business"]).optional(),
    },
    async (args) => service.getItemOffers(args),
  );

  register(
    server,
    "spapi_list_financial_events",
    "List Amazon financial events by posting date with pagination",
    {
      store,
      postedAfter: isoDateTime.optional(),
      postedBefore: isoDateTime.optional(),
      maxResultsPerPage: z.number().int().min(1).max(100).optional(),
      nextToken: z.string().min(1).optional(),
    },
    async (args) => service.listFinancialEvents(args),
  );

  register(
    server,
    "spapi_get_financial_events_by_order",
    "Get Amazon financial events for one order with pagination",
    {
      store,
      orderId: z.string().min(1),
      maxResultsPerPage: z.number().int().min(1).max(100).optional(),
      nextToken: z.string().min(1).optional(),
    },
    async (args) => service.getFinancialEventsByOrder(args),
  );

  register(
    server,
    "spapi_create_report",
    "Request generation of a Seller Central report; this creates only a report-processing job and does not change listings or orders",
    {
      store,
      reportType: z.string().min(1),
      marketplaceIds,
      dataStartTime: isoDateTime.optional(),
      dataEndTime: isoDateTime.optional(),
      reportOptions: z.record(z.string(), z.string()).optional(),
    },
    async (args) => service.createReport(args),
    { readOnlyHint: false, idempotentHint: false },
  );

  register(
    server,
    "spapi_get_report",
    "Get the processing status and document ID for one Seller Central report",
    { store, reportId: z.string().min(1) },
    async ({ store, reportId }) => service.getReport(store, reportId),
  );

  register(
    server,
    "spapi_list_reports",
    "List recent Seller Central reports by type and processing status with pagination",
    {
      store,
      reportTypes: z.array(z.string().min(1)).min(1).max(100).optional(),
      processingStatuses: z
        .array(
          z.enum(["CANCELLED", "DONE", "FATAL", "IN_PROGRESS", "IN_QUEUE"]),
        )
        .min(1)
        .max(5)
        .optional(),
      marketplaceIds,
      pageSize: z.number().int().min(1).max(100).optional(),
      createdSince: isoDateTime.optional(),
      createdUntil: isoDateTime.optional(),
      nextToken: z.string().min(1).optional(),
    },
    async (args) => service.listReports(args),
  );

  register(
    server,
    "spapi_get_report_document",
    "Get safe metadata for a report document without exposing its signed download URL",
    { store, reportDocumentId: z.string().min(1) },
    async ({ store, reportDocumentId }) =>
      service.getReportDocument(store, reportDocumentId),
  );

  register(
    server,
    "spapi_download_report_document",
    "Download a text report document through its Amazon-signed URL with hostname, redirect, timeout, and size protections",
    {
      store,
      reportDocumentId: z.string().min(1),
      maxBytes: z.number().int().min(1).max(5_000_000).optional(),
    },
    async (args) => service.downloadReportDocument(args),
  );

  register(
    server,
    "spapi_list_inbound_plans",
    "List current FBA inbound plans with status filtering and pagination",
    {
      store,
      pageSize: z.number().int().min(1).max(30).optional(),
      paginationToken: z.string().min(1).optional(),
      status: z.string().min(1).optional(),
      sortBy: z.string().min(1).optional(),
      sortOrder: z.enum(["ASC", "DESC"]).optional(),
    },
    async (args) => service.listInboundPlans(args),
  );

  register(
    server,
    "spapi_get_inbound_plan",
    "Get one FBA inbound plan",
    { store, inboundPlanId: z.string().min(1) },
    async ({ store, inboundPlanId }) =>
      service.getInboundPlan(store, inboundPlanId),
  );

  register(
    server,
    "spapi_get_inbound_shipment",
    "Get one shipment within an FBA inbound plan",
    {
      store,
      inboundPlanId: z.string().min(1),
      shipmentId: z.string().min(1),
    },
    async (args) => service.getInboundShipment(args),
  );

  register(
    server,
    "spapi_list_inbound_plan_items",
    "List SKUs and quantities in an FBA inbound plan with pagination",
    {
      store,
      inboundPlanId: z.string().min(1),
      pageSize: z.number().int().min(1).max(100).optional(),
      paginationToken: z.string().min(1).optional(),
    },
    async (args) => service.listInboundPlanItems(args),
  );

  register(
    server,
    "spapi_get_fba_eligibility",
    "Check whether an ASIN is eligible for FBA inbound or commingling",
    {
      store,
      marketplaceId,
      asin: z.string().min(1),
      program: z.enum(["INBOUND", "COMMINGLING"]).optional(),
    },
    async (args) => service.getFbaEligibility(args),
  );

  register(
    server,
    "spapi_estimate_fees",
    "Estimate Amazon selling and FBA fees for an ASIN and proposed price",
    {
      store,
      marketplaceId,
      asin: z.string().min(1),
      price: z.number().nonnegative(),
      shipping: z.number().nonnegative().optional(),
      currencyCode: z.string().length(3).optional(),
      isAmazonFulfilled: z.boolean().optional(),
      identifier: z.string().min(1).max(100).optional(),
    },
    async (args) => service.estimateFees(args),
  );

  register(
    server,
    "spapi_get_solicitation_actions",
    "Check whether an Amazon order is currently eligible for a review and seller-feedback solicitation",
    { store, marketplaceId, orderId: z.string().min(1) },
    async (args) => service.getSolicitationActions(args),
  );

  if (!options.enableMutations) return;

  const patchOperation = z
    .object({
      op: z.enum(["add", "replace", "delete"]),
      path: z
        .string()
        .regex(/^\/attributes\/[A-Za-z0-9_.-]+$/)
        .describe(
          "Top-level listing attribute path, such as /attributes/purchasable_offer",
        ),
      value: z.array(z.unknown()).optional(),
    })
    .superRefine((operation, context) => {
      if (operation.op !== "delete" && !operation.value) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["value"],
          message: "value is required for add and replace operations",
        });
      }
    });

  register(
    server,
    "spapi_patch_listing",
    "MUTATION: Partially update top-level attributes on one Amazon listing; requires SP_API_ENABLE_MUTATIONS=true",
    {
      store,
      marketplaceIds,
      sku: z.string().min(1),
      productType: z.string().min(1),
      patches: z.array(patchOperation).min(1).max(20),
      issueLocale: z.string().min(2).optional(),
    },
    async (args) => service.patchListing(args),
    {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  );

  register(
    server,
    "spapi_send_review_solicitation",
    "MUTATION: Send Amazon's standardized review and seller-feedback request to one order; requires SP_API_ENABLE_MUTATIONS=true",
    { store, marketplaceId, orderId: z.string().min(1) },
    async (args) => service.sendReviewSolicitation(args),
    { readOnlyHint: false, idempotentHint: false },
  );
}

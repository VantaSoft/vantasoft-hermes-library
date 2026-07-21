import { gunzipSync } from "node:zlib";
import {
  CatalogitemsSpApi,
  FbaeligibilitySpApi,
  FbainventorySpApi,
  FinancesSpApi,
  FulfillmentinboundSpApi,
  ListingsitemsSpApi,
  OrdersSpApi,
  Pricing_v0SpApi,
  ProductfeesSpApi,
  ReportsSpApi,
  SellersSpApi,
  SolicitationsSpApi,
} from "@amazon-sp-api-release/amazon-sp-api-sdk-js";
import {
  getStore,
  listSafeStores,
  type SpApiConfig,
  type StoreConfig,
  UserInputError,
} from "./config.js";

const ENDPOINTS = {
  NA: "https://sellingpartnerapi-na.amazon.com",
  EU: "https://sellingpartnerapi-eu.amazon.com",
  FE: "https://sellingpartnerapi-fe.amazon.com",
} as const;

const SANDBOX_ENDPOINTS = {
  NA: "https://sandbox.sellingpartnerapi-na.amazon.com",
  EU: "https://sandbox.sellingpartnerapi-eu.amazon.com",
  FE: "https://sandbox.sellingpartnerapi-fe.amazon.com",
} as const;

interface SdkClient {
  enableAutoRetrievalAccessToken(
    clientId: string,
    clientSecret: string,
    refreshToken: string,
    scope: null,
  ): unknown;
  enableRateLimiter(): void;
}

interface SdkNamespace {
  ApiClient: new (endpoint: string) => SdkClient;
  [key: string]: unknown;
}

function asSdkNamespace(value: unknown): SdkNamespace {
  return value as SdkNamespace;
}

function asDate(value?: string): Date | undefined {
  return value ? new Date(value) : undefined;
}

export type ApiFactory = (
  family: string,
  namespace: unknown,
  apiClassName: string,
  requestedStore?: string,
) => any;

export class SpApiService {
  private readonly clients = new Map<string, SdkClient>();

  constructor(
    private readonly config: SpApiConfig,
    private readonly apiFactory?: ApiFactory,
  ) {}

  listStores(): object[] {
    return listSafeStores(this.config);
  }

  private context(requestedStore?: string): {
    name: string;
    store: StoreConfig;
    marketplaceId: string;
  } {
    const selected = getStore(this.config, requestedStore);
    return {
      name: selected.name,
      store: selected.config,
      marketplaceId: selected.config.marketplaceId,
    };
  }

  private api(
    family: string,
    namespaceValue: unknown,
    apiClassName: string,
    requestedStore?: string,
  ): any {
    if (this.apiFactory) {
      return this.apiFactory(
        family,
        namespaceValue,
        apiClassName,
        requestedStore,
      );
    }
    const namespace = asSdkNamespace(namespaceValue);
    const context = this.context(requestedStore);
    const cacheKey = `${context.name}:${family}`;
    let client = this.clients.get(cacheKey);
    if (!client) {
      const endpoint = context.store.sandbox
        ? SANDBOX_ENDPOINTS[context.store.region]
        : ENDPOINTS[context.store.region];
      client = new namespace.ApiClient(endpoint);
      client.enableAutoRetrievalAccessToken(
        context.store.clientId,
        context.store.clientSecret,
        context.store.refreshToken,
        null,
      );
      client.enableRateLimiter();
      this.clients.set(cacheKey, client);
    }

    const ApiClass = namespace[apiClassName] as new (client: SdkClient) => any;
    if (!ApiClass)
      throw new Error(`Amazon SDK API class unavailable: ${apiClassName}`);
    return new ApiClass(client);
  }

  private marketplace(requestedStore?: string, override?: string): string {
    return override ?? this.context(requestedStore).marketplaceId;
  }

  private sellerId(requestedStore?: string): string {
    return this.context(requestedStore).store.sellerId;
  }

  async getAccount(store?: string): Promise<unknown> {
    return this.api("sellers", SellersSpApi, "SellersApi", store).getAccount();
  }

  async getMarketplaceParticipations(store?: string): Promise<unknown> {
    return this.api(
      "sellers",
      SellersSpApi,
      "SellersApi",
      store,
    ).getMarketplaceParticipations();
  }

  async getFbaInventory(input: {
    store?: string;
    marketplaceId?: string;
    details?: boolean;
    startDateTime?: string;
    sellerSkus?: string[];
    nextToken?: string;
  }): Promise<unknown> {
    const marketplaceId = this.marketplace(input.store, input.marketplaceId);
    return this.api(
      "fba-inventory",
      FbainventorySpApi,
      "FbaInventoryApi",
      input.store,
    ).getInventorySummaries("Marketplace", marketplaceId, [marketplaceId], {
      details: input.details ?? true,
      startDateTime: asDate(input.startDateTime),
      sellerSkus: input.sellerSkus,
      nextToken: input.nextToken,
    });
  }

  async getOrders(input: {
    store?: string;
    marketplaceIds?: string[];
    createdAfter?: string;
    createdBefore?: string;
    lastUpdatedAfter?: string;
    lastUpdatedBefore?: string;
    orderStatuses?: string[];
    fulfillmentChannels?: string[];
    maxResultsPerPage?: number;
    nextToken?: string;
  }): Promise<unknown> {
    if (!input.nextToken && !input.createdAfter && !input.lastUpdatedAfter) {
      throw new UserInputError(
        "Provide createdAfter, lastUpdatedAfter, or nextToken when listing orders",
      );
    }
    const marketplaces = input.marketplaceIds ?? [
      this.marketplace(input.store),
    ];
    return this.api(
      "orders",
      OrdersSpApi,
      "OrdersV0Api",
      input.store,
    ).getOrders(marketplaces, {
      createdAfter: input.createdAfter,
      createdBefore: input.createdBefore,
      lastUpdatedAfter: input.lastUpdatedAfter,
      lastUpdatedBefore: input.lastUpdatedBefore,
      orderStatuses: input.orderStatuses,
      fulfillmentChannels: input.fulfillmentChannels,
      maxResultsPerPage: input.maxResultsPerPage,
      nextToken: input.nextToken,
    });
  }

  async getOrder(store: string | undefined, orderId: string): Promise<unknown> {
    return this.api("orders", OrdersSpApi, "OrdersV0Api", store).getOrder(
      orderId,
    );
  }

  async getOrderItems(
    store: string | undefined,
    orderId: string,
    nextToken?: string,
  ): Promise<unknown> {
    return this.api("orders", OrdersSpApi, "OrdersV0Api", store).getOrderItems(
      orderId,
      { nextToken },
    );
  }

  async getCatalogItem(input: {
    store?: string;
    marketplaceIds?: string[];
    asin: string;
    includedData?: string[];
    locale?: string;
  }): Promise<unknown> {
    const marketplaces = input.marketplaceIds ?? [
      this.marketplace(input.store),
    ];
    return this.api(
      "catalog",
      CatalogitemsSpApi,
      "CatalogApi",
      input.store,
    ).getCatalogItem(input.asin, marketplaces, {
      includedData: input.includedData,
      locale: input.locale,
    });
  }

  async searchCatalogItems(input: {
    store?: string;
    marketplaceIds?: string[];
    keywords?: string[];
    identifiers?: string[];
    identifiersType?: string;
    includedData?: string[];
    pageSize?: number;
    pageToken?: string;
  }): Promise<unknown> {
    if (Boolean(input.keywords) === Boolean(input.identifiers)) {
      throw new UserInputError(
        "Provide either keywords or identifiers, but not both",
      );
    }
    if (input.identifiers && !input.identifiersType) {
      throw new UserInputError(
        "identifiersType is required when identifiers are provided",
      );
    }
    const marketplaces = input.marketplaceIds ?? [
      this.marketplace(input.store),
    ];
    return this.api(
      "catalog",
      CatalogitemsSpApi,
      "CatalogApi",
      input.store,
    ).searchCatalogItems(marketplaces, {
      keywords: input.keywords,
      identifiers: input.identifiers,
      identifiersType: input.identifiersType,
      sellerId:
        input.identifiersType === "SKU"
          ? this.sellerId(input.store)
          : undefined,
      includedData: input.includedData,
      pageSize: input.pageSize,
      pageToken: input.pageToken,
    });
  }

  async getListingItem(input: {
    store?: string;
    marketplaceIds?: string[];
    sku: string;
    includedData?: string[];
    issueLocale?: string;
  }): Promise<unknown> {
    const marketplaces = input.marketplaceIds ?? [
      this.marketplace(input.store),
    ];
    return this.api(
      "listings",
      ListingsitemsSpApi,
      "ListingsApi",
      input.store,
    ).getListingsItem(this.sellerId(input.store), input.sku, marketplaces, {
      includedData: input.includedData,
      issueLocale: input.issueLocale,
    });
  }

  async searchListingItems(input: {
    store?: string;
    marketplaceIds?: string[];
    identifiers?: string[];
    identifiersType?: string;
    includedData?: string[];
    withIssueSeverity?: string[];
    withStatus?: string[];
    pageSize?: number;
    pageToken?: string;
  }): Promise<unknown> {
    const marketplaces = input.marketplaceIds ?? [
      this.marketplace(input.store),
    ];
    return this.api(
      "listings",
      ListingsitemsSpApi,
      "ListingsApi",
      input.store,
    ).searchListingsItems(this.sellerId(input.store), marketplaces, {
      identifiers: input.identifiers,
      identifiersType: input.identifiersType,
      includedData: input.includedData,
      withIssueSeverity: input.withIssueSeverity,
      withStatus: input.withStatus,
      pageSize: input.pageSize,
      pageToken: input.pageToken,
    });
  }

  async getCompetitivePricing(input: {
    store?: string;
    marketplaceId?: string;
    itemType: "Asin" | "Sku";
    asins?: string[];
    skus?: string[];
    customerType?: "Consumer" | "Business";
  }): Promise<unknown> {
    if (input.itemType === "Asin" && !input.asins?.length) {
      throw new UserInputError("asins are required when itemType is Asin");
    }
    if (input.itemType === "Sku" && !input.skus?.length) {
      throw new UserInputError("skus are required when itemType is Sku");
    }
    return this.api(
      "pricing-v0",
      Pricing_v0SpApi,
      "ProductPricingApi",
      input.store,
    ).getCompetitivePricing(
      this.marketplace(input.store, input.marketplaceId),
      input.itemType,
      {
        asins: input.asins,
        skus: input.skus,
        customerType: input.customerType,
      },
    );
  }

  async getItemOffers(input: {
    store?: string;
    marketplaceId?: string;
    asin: string;
    itemCondition?: string;
    customerType?: string;
  }): Promise<unknown> {
    return this.api(
      "pricing-v0",
      Pricing_v0SpApi,
      "ProductPricingApi",
      input.store,
    ).getItemOffers(
      this.marketplace(input.store, input.marketplaceId),
      input.itemCondition ?? "New",
      input.asin,
      { customerType: input.customerType },
    );
  }

  async listFinancialEvents(input: {
    store?: string;
    postedAfter?: string;
    postedBefore?: string;
    maxResultsPerPage?: number;
    nextToken?: string;
  }): Promise<unknown> {
    return this.api(
      "finances-v0",
      FinancesSpApi,
      "DefaultApi",
      input.store,
    ).listFinancialEvents({
      postedAfter: asDate(input.postedAfter),
      postedBefore: asDate(input.postedBefore),
      maxResultsPerPage: input.maxResultsPerPage,
      nextToken: input.nextToken,
    });
  }

  async getFinancialEventsByOrder(input: {
    store?: string;
    orderId: string;
    maxResultsPerPage?: number;
    nextToken?: string;
  }): Promise<unknown> {
    return this.api(
      "finances-v0",
      FinancesSpApi,
      "DefaultApi",
      input.store,
    ).listFinancialEventsByOrderId(input.orderId, {
      maxResultsPerPage: input.maxResultsPerPage,
      nextToken: input.nextToken,
    });
  }

  async createReport(input: {
    store?: string;
    reportType: string;
    marketplaceIds?: string[];
    dataStartTime?: string;
    dataEndTime?: string;
    reportOptions?: Record<string, string>;
  }): Promise<unknown> {
    return this.api(
      "reports",
      ReportsSpApi,
      "ReportsApi",
      input.store,
    ).createReport({
      reportType: input.reportType,
      marketplaceIds: input.marketplaceIds ?? [this.marketplace(input.store)],
      dataStartTime: asDate(input.dataStartTime),
      dataEndTime: asDate(input.dataEndTime),
      reportOptions: input.reportOptions,
    });
  }

  async getReport(
    store: string | undefined,
    reportId: string,
  ): Promise<unknown> {
    return this.api("reports", ReportsSpApi, "ReportsApi", store).getReport(
      reportId,
    );
  }

  async listReports(input: {
    store?: string;
    reportTypes?: string[];
    processingStatuses?: string[];
    marketplaceIds?: string[];
    pageSize?: number;
    createdSince?: string;
    createdUntil?: string;
    nextToken?: string;
  }): Promise<unknown> {
    if (!input.nextToken && !input.reportTypes?.length) {
      throw new UserInputError("reportTypes or nextToken is required");
    }
    return this.api(
      "reports",
      ReportsSpApi,
      "ReportsApi",
      input.store,
    ).getReports({
      reportTypes: input.reportTypes,
      processingStatuses: input.processingStatuses,
      marketplaceIds:
        input.marketplaceIds ??
        (input.nextToken ? undefined : [this.marketplace(input.store)]),
      pageSize: input.pageSize,
      createdSince: asDate(input.createdSince),
      createdUntil: asDate(input.createdUntil),
      nextToken: input.nextToken,
    });
  }

  async getReportDocument(
    store: string | undefined,
    reportDocumentId: string,
  ): Promise<unknown> {
    const document = await this.api(
      "reports",
      ReportsSpApi,
      "ReportsApi",
      store,
    ).getReportDocument(reportDocumentId);
    return {
      reportDocumentId,
      compressionAlgorithm: document.compressionAlgorithm ?? null,
      downloadAvailable: Boolean(document.url),
    };
  }

  async downloadReportDocument(input: {
    store?: string;
    reportDocumentId: string;
    maxBytes?: number;
  }): Promise<unknown> {
    const document = await this.api(
      "reports",
      ReportsSpApi,
      "ReportsApi",
      input.store,
    ).getReportDocument(input.reportDocumentId);
    if (!document.url)
      throw new Error("Report document download URL is unavailable");

    const url = new URL(document.url);
    if (
      url.protocol !== "https:" ||
      !(
        url.hostname === "amazonaws.com" ||
        url.hostname.endsWith(".amazonaws.com")
      )
    ) {
      throw new Error("Report document URL failed security validation");
    }

    const maxBytes = input.maxBytes ?? 1_000_000;
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok || !response.body) {
      throw Object.assign(new Error("Report document download failed"), {
        statusCode: response.status,
      });
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new UserInputError(
        `Report document exceeds maxBytes (${maxBytes})`,
      );
    }

    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new UserInputError(
          `Report document exceeds maxBytes (${maxBytes})`,
        );
      }
      chunks.push(value);
    }

    let output = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    if (document.compressionAlgorithm === "GZIP") {
      output = gunzipSync(output);
      if (output.byteLength > maxBytes) {
        throw new UserInputError(
          `Decompressed report document exceeds maxBytes (${maxBytes})`,
        );
      }
    }

    return {
      reportDocumentId: input.reportDocumentId,
      compressionAlgorithm: document.compressionAlgorithm ?? null,
      bytes: output.byteLength,
      content: output.toString("utf8"),
    };
  }

  async listInboundPlans(input: {
    store?: string;
    pageSize?: number;
    paginationToken?: string;
    status?: string;
    sortBy?: string;
    sortOrder?: string;
  }): Promise<unknown> {
    return this.api(
      "fulfillment-inbound",
      FulfillmentinboundSpApi,
      "FbaInboundApi",
      input.store,
    ).listInboundPlans({
      pageSize: input.pageSize,
      paginationToken: input.paginationToken,
      status: input.status,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
    });
  }

  async getInboundPlan(
    store: string | undefined,
    inboundPlanId: string,
  ): Promise<unknown> {
    return this.api(
      "fulfillment-inbound",
      FulfillmentinboundSpApi,
      "FbaInboundApi",
      store,
    ).getInboundPlan(inboundPlanId);
  }

  async getInboundShipment(input: {
    store?: string;
    inboundPlanId: string;
    shipmentId: string;
  }): Promise<unknown> {
    return this.api(
      "fulfillment-inbound",
      FulfillmentinboundSpApi,
      "FbaInboundApi",
      input.store,
    ).getShipment(input.inboundPlanId, input.shipmentId);
  }

  async listInboundPlanItems(input: {
    store?: string;
    inboundPlanId: string;
    pageSize?: number;
    paginationToken?: string;
  }): Promise<unknown> {
    return this.api(
      "fulfillment-inbound",
      FulfillmentinboundSpApi,
      "FbaInboundApi",
      input.store,
    ).listInboundPlanItems(input.inboundPlanId, {
      pageSize: input.pageSize,
      paginationToken: input.paginationToken,
    });
  }

  async getFbaEligibility(input: {
    store?: string;
    marketplaceId?: string;
    asin: string;
    program?: "INBOUND" | "COMMINGLING";
  }): Promise<unknown> {
    const program = input.program ?? "INBOUND";
    return this.api(
      "fba-eligibility",
      FbaeligibilitySpApi,
      "FbaInboundApi",
      input.store,
    ).getItemEligibilityPreview(input.asin, program, {
      marketplaceIds:
        program === "INBOUND"
          ? [this.marketplace(input.store, input.marketplaceId)]
          : undefined,
    });
  }

  async estimateFees(input: {
    store?: string;
    marketplaceId?: string;
    asin: string;
    price: number;
    shipping?: number;
    currencyCode?: string;
    isAmazonFulfilled?: boolean;
    identifier?: string;
  }): Promise<unknown> {
    const currencyCode = input.currencyCode ?? "USD";
    return this.api(
      "product-fees",
      ProductfeesSpApi,
      "FeesApi",
      input.store,
    ).getMyFeesEstimateForASIN(input.asin, {
      FeesEstimateRequest: {
        MarketplaceId: this.marketplace(input.store, input.marketplaceId),
        IsAmazonFulfilled: input.isAmazonFulfilled ?? true,
        PriceToEstimateFees: {
          ListingPrice: { CurrencyCode: currencyCode, Amount: input.price },
          Shipping: {
            CurrencyCode: currencyCode,
            Amount: input.shipping ?? 0,
          },
        },
        Identifier: input.identifier ?? `mcp-${input.asin}`,
      },
    });
  }

  async getSolicitationActions(input: {
    store?: string;
    marketplaceId?: string;
    orderId: string;
  }): Promise<unknown> {
    return this.api(
      "solicitations",
      SolicitationsSpApi,
      "SolicitationsApi",
      input.store,
    ).getSolicitationActionsForOrder(input.orderId, [
      this.marketplace(input.store, input.marketplaceId),
    ]);
  }

  async patchListing(input: {
    store?: string;
    marketplaceIds?: string[];
    sku: string;
    productType: string;
    patches: unknown[];
    issueLocale?: string;
  }): Promise<unknown> {
    const marketplaces = input.marketplaceIds ?? [
      this.marketplace(input.store),
    ];
    return this.api(
      "listings",
      ListingsitemsSpApi,
      "ListingsApi",
      input.store,
    ).patchListingsItem(
      this.sellerId(input.store),
      input.sku,
      marketplaces,
      { productType: input.productType, patches: input.patches },
      { issueLocale: input.issueLocale },
    );
  }

  async sendReviewSolicitation(input: {
    store?: string;
    marketplaceId?: string;
    orderId: string;
  }): Promise<unknown> {
    return this.api(
      "solicitations",
      SolicitationsSpApi,
      "SolicitationsApi",
      input.store,
    ).createProductReviewAndSellerFeedbackSolicitation(input.orderId, [
      this.marketplace(input.store, input.marketplaceId),
    ]);
  }
}

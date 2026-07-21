import {
  createAdminApiClient,
  type AdminApiClient,
} from "@shopify/admin-api-client";
import { AccessTokenProvider } from "./access-token-provider.js";
import {
  type ShopifyConfig,
  UserInputError,
  listSafeStores,
} from "./config.js";
import * as operations from "./operations.js";

export type RequestFunction = (
  operation: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<{
  data?: unknown;
  errors?: { networkStatusCode?: number };
  extensions?: Record<string, unknown>;
}>;

export type ClientFactory = (input: {
  storeDomain: string;
  apiVersion: string;
  accessToken: string;
}) => RequestFunction;

interface CachedClient {
  accessToken: string;
  request: RequestFunction;
}

export class ShopifyService {
  private readonly clients = new Map<string, CachedClient>();

  constructor(
    private readonly config: ShopifyConfig,
    private readonly tokens = new AccessTokenProvider(config),
    private readonly clientFactory: ClientFactory = (input) => {
      const client: AdminApiClient = createAdminApiClient({
        ...input,
        retries: 3,
        userAgentPrefix: "VantaSoft-Shopify-Admin-MCP/1.0.0",
      });
      return client.request.bind(client) as RequestFunction;
    },
  ) {}

  listStores(): object[] {
    return listSafeStores(this.config);
  }

  private async request(
    operation: string,
    variables: Record<string, unknown>,
    requestedStore?: string,
  ): Promise<unknown> {
    const selected = await this.tokens.get(requestedStore);
    let cached = this.clients.get(selected.name);
    if (!cached || cached.accessToken !== selected.accessToken) {
      cached = {
        accessToken: selected.accessToken,
        request: this.clientFactory({
          storeDomain: selected.store.shopDomain,
          apiVersion: selected.store.apiVersion,
          accessToken: selected.accessToken,
        }),
      };
      this.clients.set(selected.name, cached);
    }

    const response = await cached.request(operation, { variables });
    if (response.errors) {
      throw {
        networkStatusCode: response.errors.networkStatusCode,
      };
    }
    this.rejectUserErrors(response.data);
    return {
      data: response.data ?? null,
      ...(response.extensions?.cost ? { cost: response.extensions.cost } : {}),
    };
  }

  private rejectUserErrors(data: unknown): void {
    if (!data || typeof data !== "object") return;
    for (const value of Object.values(data as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const errors = (value as Record<string, unknown>).userErrors;
      if (!Array.isArray(errors) || errors.length === 0) continue;
      const fields = errors
        .map((entry) => {
          if (!entry || typeof entry !== "object") return undefined;
          const field = (entry as Record<string, unknown>).field;
          return Array.isArray(field) ? field.join(".") : undefined;
        })
        .filter((field): field is string => Boolean(field));
      const suffix =
        fields.length > 0 ? ` at ${[...new Set(fields)].join(", ")}` : "";
      throw new UserInputError(`Shopify rejected the mutation${suffix}`);
    }
  }

  getShop(store?: string): Promise<unknown> {
    return this.request(operations.SHOP_QUERY, {}, store);
  }

  listProducts(input: {
    store?: string;
    first?: number;
    after?: string;
    query?: string;
    reverse?: boolean;
  }): Promise<unknown> {
    return this.request(
      operations.PRODUCTS_QUERY,
      {
        first: input.first ?? 25,
        after: input.after,
        query: input.query,
        reverse: input.reverse ?? false,
      },
      input.store,
    );
  }

  getProduct(input: {
    store?: string;
    id: string;
    variantsFirst?: number;
  }): Promise<unknown> {
    return this.request(
      operations.PRODUCT_QUERY,
      { id: input.id, variantsFirst: input.variantsFirst ?? 50 },
      input.store,
    );
  }

  listCollections(input: {
    store?: string;
    first?: number;
    after?: string;
    query?: string;
  }): Promise<unknown> {
    return this.request(
      operations.COLLECTIONS_QUERY,
      { first: input.first ?? 25, after: input.after, query: input.query },
      input.store,
    );
  }

  getCollection(input: {
    store?: string;
    id: string;
    productsFirst?: number;
  }): Promise<unknown> {
    return this.request(
      operations.COLLECTION_QUERY,
      { id: input.id, productsFirst: input.productsFirst ?? 50 },
      input.store,
    );
  }

  listOrders(input: {
    store?: string;
    first?: number;
    after?: string;
    query?: string;
    reverse?: boolean;
  }): Promise<unknown> {
    return this.request(
      operations.ORDERS_QUERY,
      {
        first: input.first ?? 25,
        after: input.after,
        query: input.query,
        reverse: input.reverse ?? true,
      },
      input.store,
    );
  }

  getOrder(input: {
    store?: string;
    id: string;
    lineItemsFirst?: number;
  }): Promise<unknown> {
    return this.request(
      operations.ORDER_QUERY,
      { id: input.id, lineItemsFirst: input.lineItemsFirst ?? 50 },
      input.store,
    );
  }

  listCustomers(input: {
    store?: string;
    first?: number;
    after?: string;
    query?: string;
    reverse?: boolean;
  }): Promise<unknown> {
    return this.request(
      operations.CUSTOMERS_QUERY,
      {
        first: input.first ?? 25,
        after: input.after,
        query: input.query,
        reverse: input.reverse ?? true,
      },
      input.store,
    );
  }

  getCustomer(input: {
    store?: string;
    id: string;
    ordersFirst?: number;
  }): Promise<unknown> {
    return this.request(
      operations.CUSTOMER_QUERY,
      { id: input.id, ordersFirst: input.ordersFirst ?? 25 },
      input.store,
    );
  }

  listInventoryItems(input: {
    store?: string;
    first?: number;
    after?: string;
    query?: string;
  }): Promise<unknown> {
    return this.request(
      operations.INVENTORY_ITEMS_QUERY,
      { first: input.first ?? 25, after: input.after, query: input.query },
      input.store,
    );
  }

  getInventoryItem(input: {
    store?: string;
    id: string;
    levelsFirst?: number;
  }): Promise<unknown> {
    return this.request(
      operations.INVENTORY_ITEM_QUERY,
      { id: input.id, levelsFirst: input.levelsFirst ?? 50 },
      input.store,
    );
  }

  listLocations(input: {
    store?: string;
    first?: number;
    after?: string;
    query?: string;
  }): Promise<unknown> {
    return this.request(
      operations.LOCATIONS_QUERY,
      { first: input.first ?? 25, after: input.after, query: input.query },
      input.store,
    );
  }

  getFulfillmentOrders(input: {
    store?: string;
    orderId: string;
    first?: number;
  }): Promise<unknown> {
    return this.request(
      operations.FULFILLMENT_ORDERS_QUERY,
      { orderId: input.orderId, first: input.first ?? 25 },
      input.store,
    );
  }

  listDraftOrders(input: {
    store?: string;
    first?: number;
    after?: string;
    query?: string;
    reverse?: boolean;
  }): Promise<unknown> {
    return this.request(
      operations.DRAFT_ORDERS_QUERY,
      {
        first: input.first ?? 25,
        after: input.after,
        query: input.query,
        reverse: input.reverse ?? true,
      },
      input.store,
    );
  }

  getDraftOrder(input: {
    store?: string;
    id: string;
    lineItemsFirst?: number;
  }): Promise<unknown> {
    return this.request(
      operations.DRAFT_ORDER_QUERY,
      { id: input.id, lineItemsFirst: input.lineItemsFirst ?? 50 },
      input.store,
    );
  }

  listMetafieldDefinitions(input: {
    store?: string;
    ownerType: string;
    first?: number;
    after?: string;
    query?: string;
  }): Promise<unknown> {
    return this.request(
      operations.METAFIELD_DEFINITIONS_QUERY,
      {
        ownerType: input.ownerType,
        first: input.first ?? 25,
        after: input.after,
        query: input.query,
      },
      input.store,
    );
  }

  getMetafields(input: {
    store?: string;
    id: string;
    first?: number;
    after?: string;
    namespace?: string;
  }): Promise<unknown> {
    return this.request(
      operations.OWNER_METAFIELDS_QUERY,
      {
        id: input.id,
        first: input.first ?? 25,
        after: input.after,
        namespace: input.namespace,
      },
      input.store,
    );
  }

  listWebhooks(input: {
    store?: string;
    first?: number;
    after?: string;
  }): Promise<unknown> {
    return this.request(
      operations.WEBHOOKS_QUERY,
      { first: input.first ?? 25, after: input.after },
      input.store,
    );
  }

  listPublications(input: {
    store?: string;
    first?: number;
    after?: string;
  }): Promise<unknown> {
    return this.request(
      operations.PUBLICATIONS_QUERY,
      { first: input.first ?? 25, after: input.after },
      input.store,
    );
  }

  listMarkets(input: {
    store?: string;
    first?: number;
    after?: string;
  }): Promise<unknown> {
    return this.request(
      operations.MARKETS_QUERY,
      { first: input.first ?? 25, after: input.after },
      input.store,
    );
  }

  listPriceLists(input: {
    store?: string;
    first?: number;
    after?: string;
  }): Promise<unknown> {
    return this.request(
      operations.PRICE_LISTS_QUERY,
      { first: input.first ?? 25, after: input.after },
      input.store,
    );
  }

  createProduct(input: {
    store?: string;
    title: string;
    descriptionHtml?: string;
    handle?: string;
    vendor?: string;
    productType?: string;
    tags?: string[];
  }): Promise<unknown> {
    const { store, ...product } = input;
    return this.request(
      operations.PRODUCT_CREATE_MUTATION,
      { product: { ...product, status: "DRAFT" } },
      store,
    );
  }

  updateProduct(input: {
    store?: string;
    id: string;
    title?: string;
    descriptionHtml?: string;
    handle?: string;
    vendor?: string;
    productType?: string;
    status?: "ACTIVE" | "ARCHIVED" | "DRAFT";
  }): Promise<unknown> {
    const { store, ...product } = input;
    return this.request(operations.PRODUCT_UPDATE_MUTATION, { product }, store);
  }

  setInventory(input: {
    store?: string;
    name: "available" | "on_hand";
    reason: string;
    referenceDocumentUri: string;
    quantities: Array<{
      inventoryItemId: string;
      locationId: string;
      quantity: number;
      compareQuantity: number;
    }>;
  }): Promise<unknown> {
    const { store, ...inventory } = input;
    return this.request(
      operations.INVENTORY_SET_MUTATION,
      { input: inventory },
      store,
    );
  }

  addTags(input: {
    store?: string;
    id: string;
    tags: string[];
  }): Promise<unknown> {
    return this.request(
      operations.TAGS_ADD_MUTATION,
      { id: input.id, tags: input.tags },
      input.store,
    );
  }

  removeTags(input: {
    store?: string;
    id: string;
    tags: string[];
  }): Promise<unknown> {
    return this.request(
      operations.TAGS_REMOVE_MUTATION,
      { id: input.id, tags: input.tags },
      input.store,
    );
  }

  setMetafields(input: {
    store?: string;
    metafields: Array<{
      ownerId: string;
      namespace: string;
      key: string;
      type: string;
      value: string;
    }>;
  }): Promise<unknown> {
    return this.request(
      operations.METAFIELDS_SET_MUTATION,
      { metafields: input.metafields },
      input.store,
    );
  }
}

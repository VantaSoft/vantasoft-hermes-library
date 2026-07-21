import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";
import { sanitizeError } from "./errors.js";
import type { ShopifyService } from "./shopify-service.js";

const store = z
  .string()
  .min(1)
  .optional()
  .describe("Configured Shopify store name. Omit to use the default store.");
const first = z.number().int().min(1).max(100).optional().default(25);
const after = z.string().min(1).optional();
const query = z.string().min(1).max(500).optional();
const gid = z
  .string()
  .startsWith("gid://shopify/")
  .max(256)
  .describe("Shopify GraphQL global ID");

interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

function result(value: unknown, isError = false) {
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
  annotations: ToolAnnotations = {},
): void {
  const registerTool = server.registerTool.bind(server) as unknown as (
    toolName: string,
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
        return result(await handler(args as z.infer<z.ZodObject<T>>));
      } catch (error) {
        return result(sanitizeError(error), true);
      }
    },
  );
}

export function registerTools(
  server: McpServer,
  service: ShopifyService,
  options: { enableMutations: boolean },
): void {
  register(
    server,
    "shopify_list_stores",
    "List configured Shopify stores without exposing access tokens or client secrets",
    {},
    async () => service.listStores(),
  );
  register(
    server,
    "shopify_get_shop",
    "Get the selected Shopify store's identity, domain, currency, timezone, and plan summary",
    { store },
    async ({ store }) => service.getShop(store),
  );
  register(
    server,
    "shopify_list_products",
    "List or search products with status, pricing, inventory, and cursor pagination",
    { store, first, after, query, reverse: z.boolean().optional() },
    async (args) => service.listProducts(args),
  );
  register(
    server,
    "shopify_get_product",
    "Get one product with options, variants, collections, media, pricing, and inventory",
    {
      store,
      id: gid,
      variantsFirst: z.number().int().min(1).max(100).optional(),
    },
    async (args) => service.getProduct(args),
  );
  register(
    server,
    "shopify_list_collections",
    "List or search Shopify collections with product counts and cursor pagination",
    { store, first, after, query },
    async (args) => service.listCollections(args),
  );
  register(
    server,
    "shopify_get_collection",
    "Get one Shopify collection and its products",
    {
      store,
      id: gid,
      productsFirst: z.number().int().min(1).max(100).optional(),
    },
    async (args) => service.getCollection(args),
  );
  register(
    server,
    "shopify_list_orders",
    "List or search orders without shipping or billing addresses; supports cursor pagination",
    { store, first, after, query, reverse: z.boolean().optional() },
    async (args) => service.listOrders(args),
  );
  register(
    server,
    "shopify_get_order",
    "Get one order with totals, statuses, line items, customer reference, and fulfillment tracking but no addresses",
    {
      store,
      id: gid,
      lineItemsFirst: z.number().int().min(1).max(100).optional(),
    },
    async (args) => service.getOrder(args),
  );
  register(
    server,
    "shopify_list_customers",
    "List customers with lifecycle and aggregate order data; omits email, phone, and addresses",
    { store, first, after, query, reverse: z.boolean().optional() },
    async (args) => service.listCustomers(args),
  );
  register(
    server,
    "shopify_get_customer",
    "Get one customer including email and phone plus recent order summaries; returns confidential customer data but no addresses",
    {
      store,
      id: gid,
      ordersFirst: z.number().int().min(1).max(100).optional(),
    },
    async (args) => service.getCustomer(args),
  );
  register(
    server,
    "shopify_list_inventory_items",
    "List or search inventory items with SKU, tracking, shipping, weight, variant, and product data",
    { store, first, after, query },
    async (args) => service.listInventoryItems(args),
  );
  register(
    server,
    "shopify_get_inventory_item",
    "Get one inventory item and its available, on-hand, committed, and incoming quantities by location",
    {
      store,
      id: gid,
      levelsFirst: z.number().int().min(1).max(100).optional(),
    },
    async (args) => service.getInventoryItem(args),
  );
  register(
    server,
    "shopify_list_locations",
    "List Shopify locations and inventory/fulfillment status",
    { store, first, after, query },
    async (args) => service.listLocations(args),
  );
  register(
    server,
    "shopify_get_fulfillment_orders",
    "Get fulfillment orders and remaining line-item quantities for one order without creating a fulfillment",
    {
      store,
      orderId: gid,
      first: z.number().int().min(1).max(100).optional(),
    },
    async (args) => service.getFulfillmentOrders(args),
  );
  register(
    server,
    "shopify_list_draft_orders",
    "List or search draft orders with totals and customer references",
    { store, first, after, query, reverse: z.boolean().optional() },
    async (args) => service.listDraftOrders(args),
  );
  register(
    server,
    "shopify_get_draft_order",
    "Get one draft order with totals, customer reference, and line items",
    {
      store,
      id: gid,
      lineItemsFirst: z.number().int().min(1).max(100).optional(),
    },
    async (args) => service.getDraftOrder(args),
  );
  register(
    server,
    "shopify_list_metafield_definitions",
    "List metafield definitions for a Shopify owner type",
    {
      store,
      ownerType: z.string().min(1).max(64),
      first,
      after,
      query,
    },
    async (args) => service.listMetafieldDefinitions(args),
  );
  register(
    server,
    "shopify_get_metafields",
    "Get metafields for a Shopify resource global ID",
    {
      store,
      id: gid,
      first,
      after,
      namespace: z.string().min(1).max(255).optional(),
    },
    async (args) => service.getMetafields(args),
  );
  register(
    server,
    "shopify_list_webhooks",
    "List this app's webhook subscriptions without returning delivery destinations or changing configuration",
    { store, first, after },
    async (args) => service.listWebhooks(args),
  );
  register(
    server,
    "shopify_list_publications",
    "List sales-channel publications available to the app",
    { store, first, after },
    async (args) => service.listPublications(args),
  );
  register(
    server,
    "shopify_list_markets",
    "List Shopify Markets and their status",
    { store, first, after },
    async (args) => service.listMarkets(args),
  );
  register(
    server,
    "shopify_list_price_lists",
    "List Shopify price lists and currencies",
    { store, first, after },
    async (args) => service.listPriceLists(args),
  );

  if (!options.enableMutations) return;

  register(
    server,
    "shopify_create_product",
    "MUTATION: Create a new product in DRAFT status; requires SHOPIFY_ENABLE_MUTATIONS=true",
    {
      store,
      title: z.string().min(1).max(255),
      descriptionHtml: z.string().max(100_000).optional(),
      handle: z.string().min(1).max(255).optional(),
      vendor: z.string().max(255).optional(),
      productType: z.string().max(255).optional(),
      tags: z.array(z.string().min(1).max(255)).max(250).optional(),
    },
    async (args) => service.createProduct(args),
    { readOnlyHint: false, idempotentHint: false },
  );
  register(
    server,
    "shopify_update_product",
    "MUTATION: Update one product, including optional publication status changes; requires SHOPIFY_ENABLE_MUTATIONS=true",
    {
      store,
      id: gid,
      title: z.string().min(1).max(255).optional(),
      descriptionHtml: z.string().max(100_000).optional(),
      handle: z.string().min(1).max(255).optional(),
      vendor: z.string().max(255).optional(),
      productType: z.string().max(255).optional(),
      status: z.enum(["ACTIVE", "ARCHIVED", "DRAFT"]).optional(),
    },
    async (args) => service.updateProduct(args),
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  );
  register(
    server,
    "shopify_set_inventory",
    "MUTATION: Set available or on-hand inventory with compare-and-set protection; requires SHOPIFY_ENABLE_MUTATIONS=true",
    {
      store,
      name: z.enum(["available", "on_hand"]),
      reason: z.string().min(1).max(255),
      referenceDocumentUri: z.string().url().max(500),
      quantities: z
        .array(
          z.object({
            inventoryItemId: gid,
            locationId: gid,
            quantity: z.number().int(),
            compareQuantity: z.number().int(),
          }),
        )
        .min(1)
        .max(100),
    },
    async (args) => service.setInventory(args),
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  );
  register(
    server,
    "shopify_add_tags",
    "MUTATION: Add tags to one Shopify resource; requires SHOPIFY_ENABLE_MUTATIONS=true",
    {
      store,
      id: gid,
      tags: z.array(z.string().min(1).max(255)).min(1).max(250),
    },
    async (args) => service.addTags(args),
    { readOnlyHint: false },
  );
  register(
    server,
    "shopify_remove_tags",
    "MUTATION: Remove tags from one Shopify resource; requires SHOPIFY_ENABLE_MUTATIONS=true",
    {
      store,
      id: gid,
      tags: z.array(z.string().min(1).max(255)).min(1).max(250),
    },
    async (args) => service.removeTags(args),
    { readOnlyHint: false, destructiveHint: true },
  );
  register(
    server,
    "shopify_set_metafields",
    "MUTATION: Create or replace metafields on Shopify resources; requires SHOPIFY_ENABLE_MUTATIONS=true",
    {
      store,
      metafields: z
        .array(
          z.object({
            ownerId: gid,
            namespace: z.string().min(1).max(255),
            key: z.string().min(1).max(255),
            type: z.string().min(1).max(255),
            value: z.string().max(1_000_000),
          }),
        )
        .min(1)
        .max(25),
    },
    async (args) => service.setMetafields(args),
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  );
}

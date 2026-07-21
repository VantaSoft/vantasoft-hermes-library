export const SHOP_QUERY = `#graphql
  query ShopSummary {
    shop {
      id
      name
      myshopifyDomain
      primaryDomain { host url }
      currencyCode
      timezoneOffsetMinutes
      createdAt
      plan { displayName partnerDevelopment shopifyPlus }
    }
  }
`;

export const PRODUCTS_QUERY = `#graphql
  query Products($first: Int!, $after: String, $query: String, $reverse: Boolean) {
    products(first: $first, after: $after, query: $query, reverse: $reverse) {
      nodes {
        id title handle status vendor productType totalInventory createdAt updatedAt
        priceRangeV2 {
          minVariantPrice { amount currencyCode }
          maxVariantPrice { amount currencyCode }
        }
        featuredMedia { preview { image { url altText } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const PRODUCT_QUERY = `#graphql
  query Product($id: ID!, $variantsFirst: Int!) {
    product(id: $id) {
      id title handle descriptionHtml status vendor productType tags
      createdAt updatedAt totalInventory
      options { id name optionValues { id name } }
      variants(first: $variantsFirst) {
        nodes {
          id title sku barcode price compareAtPrice inventoryQuantity
          inventoryItem { id tracked }
        }
        pageInfo { hasNextPage endCursor }
      }
      collections(first: 25) { nodes { id title handle } }
      featuredMedia { preview { image { url altText } } }
    }
  }
`;

export const COLLECTIONS_QUERY = `#graphql
  query Collections($first: Int!, $after: String, $query: String) {
    collections(first: $first, after: $after, query: $query) {
      nodes { id title handle descriptionHtml updatedAt productsCount { count } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const COLLECTION_QUERY = `#graphql
  query Collection($id: ID!, $productsFirst: Int!) {
    collection(id: $id) {
      id title handle descriptionHtml updatedAt productsCount { count }
      products(first: $productsFirst) {
        nodes { id title handle status totalInventory }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

export const ORDERS_QUERY = `#graphql
  query Orders($first: Int!, $after: String, $query: String, $reverse: Boolean) {
    orders(first: $first, after: $after, query: $query, reverse: $reverse) {
      nodes {
        id name createdAt updatedAt cancelledAt closedAt
        displayFinancialStatus displayFulfillmentStatus
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        currentSubtotalPriceSet { shopMoney { amount currencyCode } }
        totalShippingPriceSet { shopMoney { amount currencyCode } }
        customer { id displayName state }
        tags
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const ORDER_QUERY = `#graphql
  query Order($id: ID!, $lineItemsFirst: Int!) {
    order(id: $id) {
      id name createdAt updatedAt cancelledAt cancelReason closedAt note tags
      displayFinancialStatus displayFulfillmentStatus
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      currentSubtotalPriceSet { shopMoney { amount currencyCode } }
      totalShippingPriceSet { shopMoney { amount currencyCode } }
      customer { id displayName state }
      lineItems(first: $lineItemsFirst) {
        nodes {
          id name sku quantity currentQuantity fulfillableQuantity
          originalUnitPriceSet { shopMoney { amount currencyCode } }
          discountedTotalSet { shopMoney { amount currencyCode } }
          product { id title handle }
          variant { id title sku }
        }
        pageInfo { hasNextPage endCursor }
      }
      fulfillments {
        id status createdAt updatedAt
        trackingInfo { company number url }
      }
    }
  }
`;

export const CUSTOMERS_QUERY = `#graphql
  query Customers($first: Int!, $after: String, $query: String, $reverse: Boolean) {
    customers(first: $first, after: $after, query: $query, reverse: $reverse) {
      nodes {
        id displayName state createdAt updatedAt numberOfOrders
        amountSpent { amount currencyCode }
        tags verifiedEmail
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const CUSTOMER_QUERY = `#graphql
  query Customer($id: ID!, $ordersFirst: Int!) {
    customer(id: $id) {
      id displayName firstName lastName email phone state locale note tags
      createdAt updatedAt verifiedEmail numberOfOrders
      amountSpent { amount currencyCode }
      orders(first: $ordersFirst, reverse: true) {
        nodes {
          id name createdAt displayFinancialStatus displayFulfillmentStatus
          currentTotalPriceSet { shopMoney { amount currencyCode } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

export const INVENTORY_ITEMS_QUERY = `#graphql
  query InventoryItems($first: Int!, $after: String, $query: String) {
    inventoryItems(first: $first, after: $after, query: $query) {
      nodes {
        id sku tracked requiresShipping
        measurement { weight { value unit } }
        variant { id title product { id title handle status } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const INVENTORY_ITEM_QUERY = `#graphql
  query InventoryItem($id: ID!, $levelsFirst: Int!) {
    inventoryItem(id: $id) {
      id sku tracked requiresShipping
      measurement { weight { value unit } }
      variant { id title product { id title handle status } }
      inventoryLevels(first: $levelsFirst) {
        nodes {
          id
          quantities(names: ["available", "on_hand", "committed", "incoming"]) {
            name quantity
          }
          location { id name isActive }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

export const LOCATIONS_QUERY = `#graphql
  query Locations($first: Int!, $after: String, $query: String) {
    locations(first: $first, after: $after, query: $query) {
      nodes { id name isActive fulfillsOnlineOrders hasActiveInventory }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const FULFILLMENT_ORDERS_QUERY = `#graphql
  query FulfillmentOrders($orderId: ID!, $first: Int!) {
    order(id: $orderId) {
      id name
      fulfillmentOrders(first: $first) {
        nodes {
          id status requestStatus
          assignedLocation { name location { id name } }
          deliveryMethod { methodType }
          lineItems(first: 50) {
            nodes {
              id totalQuantity remainingQuantity
              lineItem { id name sku quantity }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

export const DRAFT_ORDERS_QUERY = `#graphql
  query DraftOrders($first: Int!, $after: String, $query: String, $reverse: Boolean) {
    draftOrders(first: $first, after: $after, query: $query, reverse: $reverse) {
      nodes {
        id name status createdAt updatedAt completedAt invoiceSentAt
        subtotalPriceSet { shopMoney { amount currencyCode } }
        totalPriceSet { shopMoney { amount currencyCode } }
        customer { id displayName state }
        tags
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const DRAFT_ORDER_QUERY = `#graphql
  query DraftOrder($id: ID!, $lineItemsFirst: Int!) {
    draftOrder(id: $id) {
      id name status createdAt updatedAt completedAt invoiceSentAt note2 tags
      subtotalPriceSet { shopMoney { amount currencyCode } }
      totalPriceSet { shopMoney { amount currencyCode } }
      customer { id displayName state }
      lineItems(first: $lineItemsFirst) {
        nodes {
          id name sku quantity originalUnitPriceSet { shopMoney { amount currencyCode } }
          product { id title }
          variant { id title sku }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

export const METAFIELD_DEFINITIONS_QUERY = `#graphql
  query MetafieldDefinitions($ownerType: MetafieldOwnerType!, $first: Int!, $after: String, $query: String) {
    metafieldDefinitions(ownerType: $ownerType, first: $first, after: $after, query: $query) {
      nodes {
        id name namespace key description
        type { name category }
        validations { name value }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const OWNER_METAFIELDS_QUERY = `#graphql
  query OwnerMetafields($id: ID!, $first: Int!, $after: String, $namespace: String) {
    node(id: $id) {
      id
      ... on HasMetafields {
        metafields(first: $first, after: $after, namespace: $namespace) {
          nodes { id namespace key type value createdAt updatedAt }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

export const WEBHOOKS_QUERY = `#graphql
  query WebhookSubscriptions($first: Int!, $after: String) {
    webhookSubscriptions(first: $first, after: $after) {
      nodes {
        id topic createdAt updatedAt
        apiVersion { displayName handle supported }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const PUBLICATIONS_QUERY = `#graphql
  query Publications($first: Int!, $after: String) {
    publications(first: $first, after: $after) {
      nodes { id name supportsFuturePublishing app { id title } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const MARKETS_QUERY = `#graphql
  query Markets($first: Int!, $after: String) {
    markets(first: $first, after: $after) {
      nodes { id name handle status primary }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const PRICE_LISTS_QUERY = `#graphql
  query PriceLists($first: Int!, $after: String) {
    priceLists(first: $first, after: $after) {
      nodes { id name currency }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const PRODUCT_CREATE_MUTATION = `#graphql
  mutation ProductCreate($product: ProductCreateInput!) {
    productCreate(product: $product) {
      product { id title handle status createdAt updatedAt }
      userErrors { field message }
    }
  }
`;

export const PRODUCT_UPDATE_MUTATION = `#graphql
  mutation ProductUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id title handle status updatedAt }
      userErrors { field message }
    }
  }
`;

export const INVENTORY_SET_MUTATION = `#graphql
  mutation InventorySetQuantities($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup {
        createdAt reason referenceDocumentUri
        changes { name delta }
      }
      userErrors { field message code }
    }
  }
`;

export const TAGS_ADD_MUTATION = `#graphql
  mutation TagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node { id }
      userErrors { field message }
    }
  }
`;

export const TAGS_REMOVE_MUTATION = `#graphql
  mutation TagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      node { id }
      userErrors { field message }
    }
  }
`;

export const METAFIELDS_SET_MUTATION = `#graphql
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id namespace key type value createdAt updatedAt }
      userErrors { field message code }
    }
  }
`;

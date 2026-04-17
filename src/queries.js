// All GraphQL queries and mutations used by the Printavo MCP server.
// Field names verified against Printavo API v2 via schema introspection.
// NOTE: Orders API returns Quote type nodes, not Invoice type.

// Core Quote fragment — used across multiple queries
const QUOTE_FIELDS = `
  id visualId nickname total subtotal totalUntaxed totalQuantity
  amountPaid amountOutstanding createdAt dueAt invoiceAt startAt
  paidInFull productionNote tags
  status { id name color }
  contact { id fullName email }
  owner { id email }
`;

export const SEARCH_INVOICES_QUERY = `
  query(
    $first: Int
    $after: String
    $inProductionAfter: ISO8601DateTime
    $inProductionBefore: ISO8601DateTime
    $statusIds: [ID!]
    $paymentStatus: OrderPaymentStatus
    $query: String
  ) {
    orders(
      first: $first
      after: $after
      inProductionAfter: $inProductionAfter
      inProductionBefore: $inProductionBefore
      statusIds: $statusIds
      paymentStatus: $paymentStatus
      query: $query
      sortOn: VISUAL_ID
    ) {
      nodes {
        ... on Quote {
          ${QUOTE_FIELDS}
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// For get_invoice_detail: search by visualId since invoice(id:) requires numeric IDs
// We search orders and pull 1 result with full line item detail
export const GET_ORDER_DETAIL_QUERY = `
  query(
    $first: Int
    $query: String
  ) {
    orders(
      first: $first
      query: $query
      sortOn: VISUAL_ID
    ) {
      nodes {
        ... on Quote {
          id visualId nickname total subtotal totalUntaxed totalQuantity
          amountPaid amountOutstanding createdAt dueAt invoiceAt startAt
          paidInFull productionNote customerNote tags merch
          status { id name color }
          contact { id fullName email }
          owner { id email }
          deliveryMethod { id name }
          shippingAddress { address1 city state zipCode }
          billingAddress { address1 city state zipCode }
          lineItemGroups {
            nodes {
              id position
              imprints { nodes { id typeOfWork { id name } details } }
              lineItems {
                nodes {
                  id description color itemNumber items price position taxed markupPercentage
                  category { id name }
                  product { id description itemNumber brand color }
                  sizes { size count }
                }
              }
            }
          }
          fees { nodes { id description amount } }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// Batch query with full line item detail — 3 orders per page to stay under complexity limit
export const BATCH_DETAIL_QUERY = `
  query(
    $first: Int
    $after: String
    $inProductionAfter: ISO8601DateTime
    $inProductionBefore: ISO8601DateTime
  ) {
    orders(
      first: $first
      after: $after
      inProductionAfter: $inProductionAfter
      inProductionBefore: $inProductionBefore
      sortOn: VISUAL_ID
    ) {
      nodes {
        ... on Quote {
          id visualId nickname total subtotal totalUntaxed totalQuantity
          amountPaid amountOutstanding createdAt dueAt invoiceAt startAt
          paidInFull productionNote tags
          status { id name }
          contact { id fullName email }
          owner { id email }
          deliveryMethod { id name }
          shippingAddress { city state zipCode }
          lineItemGroups {
            nodes {
              id position
              imprints { nodes { id typeOfWork { id name } details } }
              lineItems {
                nodes {
                  id description color itemNumber items price position taxed markupPercentage
                  category { id name }
                  product { id description itemNumber brand color }
                  sizes { size count }
                }
              }
            }
          }
          fees { nodes { id description amount } }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const SEARCH_CUSTOMERS_QUERY = `
  query($first: Int, $after: String) {
    customers(first: $first, after: $after) {
      nodes {
        id
        companyName
        internalNote
        orderCount
        primaryContact {
          id fullName email phone
        }
      }
      pageInfo { hasNextPage endCursor }
      totalNodes
    }
  }
`;

export const GET_CUSTOMER_DETAIL_QUERY = `
  query($id: ID!) {
    contact(id: $id) {
      id fullName email phone
      customer {
        id companyName internalNote orderCount
      }
    }
  }
`;

export const LIST_STATUSES_QUERY = `
  query {
    statuses {
      nodes {
        id name color position type
      }
    }
  }
`;

export const GET_ACCOUNT_INFO_QUERY = `
  query {
    account {
      id companyName companyEmail phone website
      address { address1 address2 city state zipCode }
    }
  }
`;

// Paginated orders for stats — lightweight, no line items
export const ORDERS_PAGINATED_QUERY = `
  query(
    $first: Int
    $after: String
    $inProductionAfter: ISO8601DateTime
    $inProductionBefore: ISO8601DateTime
    $statusIds: [ID!]
  ) {
    orders(
      first: $first
      after: $after
      inProductionAfter: $inProductionAfter
      inProductionBefore: $inProductionBefore
      statusIds: $statusIds
      sortOn: VISUAL_ID
    ) {
      nodes {
        ... on Quote {
          id visualId nickname total totalQuantity
          amountPaid amountOutstanding paidInFull
          dueAt startAt createdAt
          status { id name color }
          contact { id fullName }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// Raw query passthrough — for testing and advanced use
export const RAW_QUERY = null; // handled dynamically in tools.js

// ---------------------------------------------------------------------------
// Pricing Matrix queries (READ-ONLY)
// ---------------------------------------------------------------------------
// Printavo's public GraphQL API does NOT expose cell values (quantity/price/markup)
// on the PricingMatrixCell type — only column + id. To read actual matrix rates
// we use the lineItemGroupPricing calculator query, which returns computed prices
// given (matrix column, type of work, quantity, blank cost). See CALCULATE_PRICE_QUERY.

export const LIST_PRICING_MATRICES_QUERY = `
  query {
    account {
      pricingMatrices(first: 50) {
        totalNodes
        nodes {
          id
          name
          typeOfWork { id name }
          columns { id columnId columnName }
        }
      }
    }
  }
`;

// lineItemGroupPricing is a READ-ONLY query (not a mutation) despite taking an input.
// Printavo built it as a pricing calculator — no invoices, quotes, or records are created.
// It returns [{ price, defaultMarkupPercentage, description, signature }].
export const CALCULATE_PRICE_QUERY = `
  query($input: LineItemGroupPricingInput!) {
    lineItemGroupPricing(lineItemGroup: $input) {
      price
      defaultMarkupPercentage
      description
      signature
    }
  }
`;

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

// lineItemCreate — add a new line item to an existing line item group
// Uses LineItemCreateInput (position is required).
// sizes uses LineItemSizeCountInput: { size: LineItemSize!, count: Int }
export const LINE_ITEM_CREATE_MUTATION = `
  mutation(
    $lineItemGroupId: ID!
    $input: LineItemCreateInput!
  ) {
    lineItemCreate(
      lineItemGroupId: $lineItemGroupId
      input: $input
    ) {
      id
      description
      color
      itemNumber
      items
      price
      position
      taxed
      sizes { size count }
      lineItemGroup {
        id
        position
      }
    }
  }
`;

// lineItemUpdate — update an existing line item
// Uses LineItemInput (position is required).
export const LINE_ITEM_UPDATE_MUTATION = `
  mutation(
    $id: ID!
    $input: LineItemInput!
  ) {
    lineItemUpdate(
      id: $id
      input: $input
    ) {
      id
      description
      color
      itemNumber
      items
      price
      position
      taxed
      sizes { size count }
      lineItemGroup {
        id
        position
      }
    }
  }
`;

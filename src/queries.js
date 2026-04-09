// All GraphQL queries used by the Printavo MCP server.
// READ-ONLY — no mutations.
// Field names verified against Printavo API v2 documentation.

export const SEARCH_INVOICES_QUERY = `
  query(
    $first: Int
    $after: String
    $inProductionAfter: ISO8601DateTime
    $inProductionBefore: ISO8601DateTime
    $statusIds: [ID!]
    $paymentStatus: OrderPaymentStatus
    $query: String
    $sortOn: OrderSortField
    $sortDescending: Boolean
  ) {
    orders(
      first: $first
      after: $after
      inProductionAfter: $inProductionAfter
      inProductionBefore: $inProductionBefore
      statusIds: $statusIds
      paymentStatus: $paymentStatus
      query: $query
      sortOn: $sortOn
      sortDescending: $sortDescending
    ) {
      nodes {
        ... on Invoice {
          id
          visualId
          nickname
          total
          subtotal
          totalUntaxed
          totalQuantity
          amountPaid
          amountOutstanding
          createdAt
          dueAt
          invoiceAt
          startAt
          paidInFull
          productionNote
          status { id name color }
          contact {
            id
            fullName
            email
            customer { companyName }
          }
          owner { id email }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const GET_INVOICE_DETAIL_QUERY = `
  query($id: ID!) {
    invoice(id: $id) {
      id
      visualId
      nickname
      total
      subtotal
      totalUntaxed
      totalQuantity
      amountPaid
      amountOutstanding
      salesTax
      salesTaxAmount
      discount
      discountAmount
      discountAsPercentage
      createdAt
      dueAt
      invoiceAt
      customerDueAt
      startAt
      paidInFull
      productionNote
      customerNote
      publicUrl
      packingSlipUrl
      status { id name color }
      contact {
        id
        fullName
        email
        phone
        customer { companyName }
      }
      owner { id email }
      billingAddress {
        address1
        address2
        city
        state
        zipCode
        companyName
        customerName
      }
      shippingAddress {
        address1
        address2
        city
        state
        zipCode
        companyName
        customerName
      }
      lineItemGroups {
        nodes {
          id
          title
          lineItems {
            nodes {
              id
              description
              color
              itemNumber
              items
              price
              sizes {
                sOther
                sYxs
                sYs
                sYm
                sYl
                sYxl
                sXs
                sS
                sM
                sL
                sXl
                s2xl
                s3xl
                s4xl
                s5xl
                s6xl
              }
            }
          }
        }
      }
    }
  }
`;

// Note: The customers query returns Customer objects.
// Customer type has: id, companyName, internalNote, orderCount, primaryContact { fullName email phone }
// The customers query does NOT have a query/search argument — pagination only.
export const SEARCH_CUSTOMERS_QUERY = `
  query($first: Int, $after: String) {
    customers(first: $first, after: $after) {
      nodes {
        id
        companyName
        internalNote
        orderCount
        primaryContact {
          id
          fullName
          firstName
          lastName
          email
          phone
        }
      }
      pageInfo { hasNextPage endCursor }
      totalNodes
      totalAmount
    }
  }
`;

// contact query: returns Contact type with customer relationship
export const GET_CUSTOMER_DETAIL_QUERY = `
  query($id: ID!) {
    contact(id: $id) {
      id
      fullName
      firstName
      lastName
      email
      phone
      orderCount
      customer {
        id
        companyName
        internalNote
        orderCount
      }
    }
  }
`;

// Top-level statuses query (not nested under account)
export const LIST_STATUSES_QUERY = `
  query {
    statuses {
      nodes {
        id
        name
        color
        position
        type
      }
    }
  }
`;

export const GET_ACCOUNT_INFO_QUERY = `
  query {
    account {
      id
      companyName
      companyEmail
      phone
      website
      address {
        address1
        address2
        city
        state
        zipCode
      }
    }
  }
`;

// Reusable paginated orders query for stats and production schedule
export const ORDERS_PAGINATED_QUERY = `
  query(
    $first: Int
    $after: String
    $inProductionAfter: ISO8601DateTime
    $inProductionBefore: ISO8601DateTime
    $statusIds: [ID!]
    $sortOn: OrderSortField
    $sortDescending: Boolean
  ) {
    orders(
      first: $first
      after: $after
      inProductionAfter: $inProductionAfter
      inProductionBefore: $inProductionBefore
      statusIds: $statusIds
      sortOn: $sortOn
      sortDescending: $sortDescending
    ) {
      nodes {
        ... on Invoice {
          id
          visualId
          nickname
          total
          totalQuantity
          amountPaid
          amountOutstanding
          paidInFull
          dueAt
          startAt
          createdAt
          status { id name color }
          contact {
            id
            fullName
            customer { companyName }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

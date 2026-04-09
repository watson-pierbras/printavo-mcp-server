/**
 * MCP tool definitions and handlers for the Printavo read-only connector.
 * ALL tools are read-only. No mutations.
 * Field names verified against Printavo API v2 documentation.
 */

import { executeQuery, paginateQuery } from './printavo-client.js';
import {
  SEARCH_INVOICES_QUERY,
  GET_INVOICE_DETAIL_QUERY,
  SEARCH_CUSTOMERS_QUERY,
  GET_CUSTOMER_DETAIL_QUERY,
  LIST_STATUSES_QUERY,
  GET_ACCOUNT_INFO_QUERY,
  ORDERS_PAGINATED_QUERY,
} from './queries.js';

// ---------------------------------------------------------------------------
// Helper formatters
// ---------------------------------------------------------------------------

function formatCurrency(value) {
  if (value == null) return 'N/A';
  const num = parseFloat(value);
  if (isNaN(num)) return String(value);
  return `$${num.toFixed(2)}`;
}

function formatDate(isoString) {
  if (!isoString) return 'N/A';
  try {
    return new Date(isoString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch (_) {
    return isoString;
  }
}

function formatAddress(addr) {
  if (!addr) return null;
  const parts = [
    addr.companyName,
    addr.customerName,
    addr.address1,
    addr.address2,
    [addr.city, addr.state, addr.zipCode].filter(Boolean).join(', '),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join('\n    ') : null;
}

function formatSizes(sizes) {
  if (!sizes) return '';
  const sizeMap = {
    sYxs: 'YXS', sYs: 'YS', sYm: 'YM', sYl: 'YL', sYxl: 'YXL',
    sXs: 'XS', sS: 'S', sM: 'M', sL: 'L', sXl: 'XL',
    s2xl: '2XL', s3xl: '3XL', s4xl: '4XL', s5xl: '5XL', s6xl: '6XL',
    sOther: 'Other',
  };
  return Object.entries(sizeMap)
    .filter(([key]) => sizes[key] && sizes[key] > 0)
    .map(([key, label]) => `${label}:${sizes[key]}`)
    .join(' ');
}

// Get company name from invoice contact (company is on customer, not contact)
function getContactCompany(contact) {
  return contact?.customer?.companyName || null;
}

function formatContactLine(contact) {
  if (!contact) return 'N/A';
  const company = getContactCompany(contact);
  const name = contact.fullName || 'N/A';
  return company ? `${name} — ${company}` : name;
}

// ---------------------------------------------------------------------------
// Tool definitions (JSON Schema)
// ---------------------------------------------------------------------------

export const toolDefinitions = [
  {
    name: 'search_invoices',
    description:
      'Read-only. Search Printavo invoices/orders with optional filters for date range, status, payment status, and free-text query. Returns a paginated list of matching invoices with key details.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: {
          type: 'string',
          description: 'ISO 8601 date (YYYY-MM-DD). Filter invoices with production start on or after this date.',
        },
        end_date: {
          type: 'string',
          description: 'ISO 8601 date (YYYY-MM-DD). Filter invoices with production due on or before this date.',
        },
        status_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by status IDs. Use list_statuses to discover available IDs.',
        },
        payment_status: {
          type: 'string',
          enum: ['PAID', 'UNPAID', 'PARTIAL'],
          description: 'Filter by payment status: PAID, UNPAID, or PARTIAL.',
        },
        query: {
          type: 'string',
          description: 'Free-text search query (searches customer name, visual ID, nickname, etc.).',
        },
        sort_by: {
          type: 'string',
          enum: ['VISUAL_ID', 'CREATED_AT', 'DUE_DATE', 'TOTAL'],
          description: 'Field to sort results by. Defaults to CREATED_AT.',
        },
        sort_desc: {
          type: 'boolean',
          description: 'Sort in descending order. Defaults to true.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (1–100). Defaults to 25.',
          minimum: 1,
          maximum: 100,
        },
        after: {
          type: 'string',
          description: 'Pagination cursor from a previous response to fetch the next page.',
        },
      },
    },
  },

  {
    name: 'get_invoice_detail',
    description:
      'Read-only. Get complete detail for a single Printavo invoice by ID, including all line item groups, line items with sizes, pricing, addresses, and notes.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: {
          type: 'string',
          description: 'The Printavo invoice ID (not the visual order number).',
        },
      },
    },
  },

  {
    name: 'search_customers',
    description:
      'Read-only. Search/list Printavo customers with pagination. Returns customer company name, primary contact info, and order count. Filter client-side by name if needed.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional text to filter results client-side by name, company, or email.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (1–100). Defaults to 25.',
          minimum: 1,
          maximum: 100,
        },
        after: {
          type: 'string',
          description: 'Pagination cursor from a previous response.',
        },
      },
    },
  },

  {
    name: 'get_customer_detail',
    description:
      'Read-only. Get detailed information for a specific Printavo contact by ID, including their customer account details.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: {
          type: 'string',
          description: 'The Printavo contact ID.',
        },
      },
    },
  },

  {
    name: 'list_statuses',
    description:
      'Read-only. List all order statuses configured in the Printavo account. Returns status IDs, names, colors, and positions. Use these IDs with search_invoices and get_order_stats.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'get_order_stats',
    description:
      'Read-only. Compute aggregate statistics for orders in a date range: total orders, revenue, pieces, average order value, average pieces per order, and a breakdown by status. Paginates through all matching orders automatically.',
    inputSchema: {
      type: 'object',
      required: ['start_date', 'end_date'],
      properties: {
        start_date: {
          type: 'string',
          description: 'ISO 8601 date (YYYY-MM-DD). Start of the date range (production start).',
        },
        end_date: {
          type: 'string',
          description: 'ISO 8601 date (YYYY-MM-DD). End of the date range (production due).',
        },
        status_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional filter by status IDs.',
        },
      },
    },
  },

  {
    name: 'get_production_schedule',
    description:
      'Read-only. Get orders currently in production or due within a date range, sorted by due date. Useful for daily/weekly production planning.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: {
          type: 'string',
          description: 'ISO 8601 date. Start of range. Defaults to today.',
        },
        end_date: {
          type: 'string',
          description: 'ISO 8601 date. End of range. Defaults to 14 days from today.',
        },
        exclude_status_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Status IDs to exclude from results (e.g. completed/invoiced statuses).',
        },
      },
    },
  },

  {
    name: 'get_account_info',
    description:
      'Read-only. Get basic Printavo account information: company name, contact details, and address.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function handleSearchInvoices(args) {
  const {
    start_date,
    end_date,
    status_ids,
    payment_status,
    query,
    sort_by = 'CREATED_AT',
    sort_desc = true,
    limit = 25,
    after,
  } = args || {};

  const variables = {
    first: Math.min(Math.max(parseInt(limit) || 25, 1), 100),
    sortOn: sort_by,
    sortDescending: sort_desc,
  };

  if (after) variables.after = after;
  if (start_date) variables.inProductionAfter = start_date;
  if (end_date) variables.inProductionBefore = end_date;
  if (status_ids?.length) variables.statusIds = status_ids;
  if (payment_status) variables.paymentStatus = payment_status;
  if (query) variables.query = query;

  const data = await executeQuery(SEARCH_INVOICES_QUERY, variables);
  const orders = data.orders;
  const nodes = orders.nodes || [];
  const pageInfo = orders.pageInfo || {};

  if (nodes.length === 0) {
    return 'No invoices found matching the given criteria.';
  }

  const lines = [
    `Found ${nodes.length} invoice(s)${pageInfo.hasNextPage ? ' (more available)' : ''}:`,
    '',
  ];

  for (const inv of nodes) {
    lines.push(`Order #${inv.visualId || 'N/A'} (ID: ${inv.id})`);
    if (inv.nickname) lines.push(`  Name: ${inv.nickname}`);
    lines.push(`  Customer: ${formatContactLine(inv.contact)}`);
    lines.push(`  Status: ${inv.status?.name || 'N/A'}`);
    lines.push(`  Total: ${formatCurrency(inv.total)} | Paid: ${formatCurrency(inv.amountPaid)} | Outstanding: ${formatCurrency(inv.amountOutstanding)}`);
    lines.push(`  Qty: ${inv.totalQuantity ?? 'N/A'} | Paid in Full: ${inv.paidInFull ? 'Yes' : 'No'}`);
    lines.push(`  Production Start: ${formatDate(inv.startAt)} | Due: ${formatDate(inv.dueAt)} | Created: ${formatDate(inv.createdAt)}`);
    if (inv.productionNote) lines.push(`  Production Note: ${inv.productionNote}`);
    lines.push('');
  }

  if (pageInfo.hasNextPage) {
    lines.push(`Next page cursor: ${pageInfo.endCursor}`);
    lines.push('Pass this as `after` to get the next page.');
  }

  return lines.join('\n');
}

async function handleGetInvoiceDetail(args) {
  const { id } = args || {};
  if (!id) throw new Error('`id` is required for get_invoice_detail');

  const data = await executeQuery(GET_INVOICE_DETAIL_QUERY, { id });
  const inv = data.invoice;

  if (!inv) return `No invoice found with ID: ${id}`;

  const lines = [
    `=== Invoice #${inv.visualId || 'N/A'} (ID: ${inv.id}) ===`,
    '',
  ];

  if (inv.nickname) lines.push(`Name: ${inv.nickname}`);
  lines.push(`Status: ${inv.status?.name || 'N/A'} (ID: ${inv.status?.id || 'N/A'})`);
  lines.push('');
  lines.push('--- Customer ---');
  const contact = inv.contact;
  lines.push(`Name: ${contact?.fullName || 'N/A'}`);
  const company = getContactCompany(contact);
  if (company) lines.push(`Company: ${company}`);
  if (contact?.email) lines.push(`Email: ${contact.email}`);
  if (contact?.phone) lines.push(`Phone: ${contact.phone}`);
  lines.push('');
  lines.push('--- Dates ---');
  lines.push(`Created: ${formatDate(inv.createdAt)}`);
  lines.push(`Production Start: ${formatDate(inv.startAt)}`);
  lines.push(`Production Due: ${formatDate(inv.dueAt)}`);
  lines.push(`Customer Due: ${formatDate(inv.customerDueAt)}`);
  lines.push(`Invoiced: ${formatDate(inv.invoiceAt)}`);
  lines.push('');
  lines.push('--- Financials ---');
  lines.push(`Subtotal: ${formatCurrency(inv.subtotal)}`);
  if (inv.discount) lines.push(`Discount: ${inv.discountAsPercentage ? inv.discount + '%' : formatCurrency(inv.discountAmount)}`);
  if (inv.salesTax) lines.push(`Tax: ${inv.salesTax}% = ${formatCurrency(inv.salesTaxAmount)}`);
  lines.push(`Total: ${formatCurrency(inv.total)}`);
  lines.push(`Amount Paid: ${formatCurrency(inv.amountPaid)}`);
  lines.push(`Outstanding: ${formatCurrency(inv.amountOutstanding)}`);
  lines.push(`Paid in Full: ${inv.paidInFull ? 'Yes' : 'No'}`);
  lines.push(`Total Quantity: ${inv.totalQuantity ?? 'N/A'}`);
  lines.push('');

  const billing = formatAddress(inv.billingAddress);
  const shipping = formatAddress(inv.shippingAddress);
  if (billing || shipping) {
    lines.push('--- Addresses ---');
    if (billing) lines.push(`Billing:\n    ${billing}`);
    if (shipping) lines.push(`Shipping:\n    ${shipping}`);
    lines.push('');
  }

  if (inv.productionNote) {
    lines.push('--- Production Note ---');
    lines.push(inv.productionNote);
    lines.push('');
  }
  if (inv.customerNote) {
    lines.push('--- Customer Note ---');
    lines.push(inv.customerNote);
    lines.push('');
  }

  if (inv.publicUrl) lines.push(`Public URL: ${inv.publicUrl}`);
  if (inv.packingSlipUrl) lines.push(`Packing Slip: ${inv.packingSlipUrl}`);

  const groups = inv.lineItemGroups?.nodes || [];
  if (groups.length > 0) {
    lines.push('');
    lines.push('--- Line Items ---');
    for (const group of groups) {
      lines.push('');
      lines.push(`Group: ${group.title || '(Untitled)'}`);
      const items = group.lineItems?.nodes || [];
      for (const item of items) {
        lines.push(`  • ${item.description || 'N/A'}`);
        if (item.itemNumber) lines.push(`    Item #: ${item.itemNumber}`);
        if (item.color) lines.push(`    Color: ${item.color}`);
        lines.push(`    Price: ${formatCurrency(item.price)} | Qty: ${item.items ?? 'N/A'}`);
        const sizeStr = formatSizes(item.sizes);
        if (sizeStr) lines.push(`    Sizes: ${sizeStr}`);
      }
    }
  }

  return lines.join('\n');
}

async function handleSearchCustomers(args) {
  const { query, limit = 25, after } = args || {};

  const variables = {
    first: Math.min(Math.max(parseInt(limit) || 25, 1), 100),
  };
  if (after) variables.after = after;

  const data = await executeQuery(SEARCH_CUSTOMERS_QUERY, variables);
  const result = data.customers;
  let nodes = result.nodes || [];
  const pageInfo = result.pageInfo || {};
  const totalNodes = result.totalNodes;
  const totalAmount = result.totalAmount;

  // Client-side filter if query provided
  if (query) {
    const q = query.toLowerCase();
    nodes = nodes.filter((c) => {
      return (
        c.companyName?.toLowerCase().includes(q) ||
        c.primaryContact?.fullName?.toLowerCase().includes(q) ||
        c.primaryContact?.firstName?.toLowerCase().includes(q) ||
        c.primaryContact?.lastName?.toLowerCase().includes(q) ||
        c.primaryContact?.email?.toLowerCase().includes(q)
      );
    });
  }

  if (nodes.length === 0) {
    return query
      ? `No customers found matching "${query}".`
      : 'No customers found.';
  }

  const lines = [`Found ${nodes.length} customer(s) (shown)`];
  if (totalNodes != null) lines.push(`Total customers in account: ${totalNodes}`);
  if (totalAmount != null) lines.push(`Total spend across account: ${formatCurrency(totalAmount)}`);
  lines.push('');

  for (const c of nodes) {
    const pc = c.primaryContact;
    const displayName = c.companyName || pc?.fullName || 'N/A';
    lines.push(`Customer: ${displayName} (ID: ${c.id})`);
    if (pc?.fullName && c.companyName) lines.push(`  Primary Contact: ${pc.fullName}`);
    if (pc?.email) lines.push(`  Email: ${pc.email}`);
    if (pc?.phone) lines.push(`  Phone: ${pc.phone}`);
    lines.push(`  Orders: ${c.orderCount ?? 'N/A'}`);
    if (c.internalNote) lines.push(`  Internal Note: ${c.internalNote}`);
    lines.push('');
  }

  if (pageInfo.hasNextPage) {
    lines.push(`Next page cursor: ${pageInfo.endCursor}`);
    lines.push('Pass this as `after` to get the next page.');
  }

  return lines.join('\n');
}

async function handleGetCustomerDetail(args) {
  const { id } = args || {};
  if (!id) throw new Error('`id` is required for get_customer_detail');

  const data = await executeQuery(GET_CUSTOMER_DETAIL_QUERY, { id });
  const c = data.contact;

  if (!c) return `No contact found with ID: ${id}`;

  const lines = [
    `=== Contact: ${c.fullName || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'N/A'} (ID: ${c.id}) ===`,
    '',
  ];

  if (c.email) lines.push(`Email: ${c.email}`);
  if (c.phone) lines.push(`Phone: ${c.phone}`);
  if (c.orderCount != null) lines.push(`Order Count: ${c.orderCount}`);

  const cust = c.customer;
  if (cust) {
    lines.push('');
    lines.push('--- Customer Account ---');
    if (cust.companyName) lines.push(`Company: ${cust.companyName}`);
    if (cust.orderCount != null) lines.push(`Total Orders: ${cust.orderCount}`);
    if (cust.internalNote) lines.push(`Internal Note: ${cust.internalNote}`);
  }

  return lines.join('\n');
}

async function handleListStatuses() {
  const data = await executeQuery(LIST_STATUSES_QUERY, {});
  const statuses = data.statuses?.nodes || [];

  if (statuses.length === 0) return 'No statuses found in this account.';

  // Sort by position
  const sorted = [...statuses].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const lines = [`${sorted.length} order status(es) configured:`, ''];
  for (const s of sorted) {
    lines.push(`• [#${s.position ?? '?'}] ${s.name} (ID: ${s.id}) — Color: ${s.color || 'N/A'} | Type: ${s.type || 'N/A'}`);
  }
  lines.push('');
  lines.push('Use these IDs with the status_ids parameter in search_invoices and get_order_stats.');

  return lines.join('\n');
}

async function handleGetOrderStats(args) {
  const { start_date, end_date, status_ids } = args || {};
  if (!start_date || !end_date) throw new Error('`start_date` and `end_date` are required for get_order_stats');

  const variables = {
    first: 100,
    inProductionAfter: start_date,
    inProductionBefore: end_date,
    sortOn: 'CREATED_AT',
    sortDescending: false,
  };
  if (status_ids?.length) variables.statusIds = status_ids;

  console.log(`Fetching order stats for ${start_date} to ${end_date}...`);
  const nodes = await paginateQuery(ORDERS_PAGINATED_QUERY, variables, 'orders', 50);

  if (nodes.length === 0) {
    return `No orders found between ${start_date} and ${end_date}.`;
  }

  let totalRevenue = 0;
  let totalPieces = 0;
  const statusBreakdown = {};

  for (const order of nodes) {
    const total = parseFloat(order.total) || 0;
    totalRevenue += total;
    totalPieces += order.totalQuantity || 0;

    const statusName = order.status?.name || 'Unknown';
    if (!statusBreakdown[statusName]) {
      statusBreakdown[statusName] = { count: 0, revenue: 0, pieces: 0 };
    }
    statusBreakdown[statusName].count++;
    statusBreakdown[statusName].revenue += total;
    statusBreakdown[statusName].pieces += order.totalQuantity || 0;
  }

  const count = nodes.length;
  const avgOrderValue = count > 0 ? totalRevenue / count : 0;
  const avgPieces = count > 0 ? totalPieces / count : 0;

  const lines = [
    `=== Order Stats: ${start_date} to ${end_date} ===`,
    '',
    `Total Orders:       ${count}`,
    `Total Revenue:      ${formatCurrency(totalRevenue)}`,
    `Total Pieces:       ${totalPieces}`,
    `Avg Order Value:    ${formatCurrency(avgOrderValue)}`,
    `Avg Pieces/Order:   ${avgPieces.toFixed(1)}`,
    '',
    '--- Breakdown by Status ---',
  ];

  const sorted = Object.entries(statusBreakdown).sort((a, b) => b[1].count - a[1].count);
  for (const [statusName, stat] of sorted) {
    lines.push(
      `  ${statusName}: ${stat.count} orders | ${formatCurrency(stat.revenue)} | ${stat.pieces} pcs`
    );
  }

  return lines.join('\n');
}

async function handleGetProductionSchedule(args) {
  const { exclude_status_ids } = args || {};

  const today = new Date();
  const defaultEnd = new Date(today);
  defaultEnd.setDate(defaultEnd.getDate() + 14);

  const start_date = args?.start_date || today.toISOString().split('T')[0];
  const end_date = args?.end_date || defaultEnd.toISOString().split('T')[0];

  const variables = {
    first: 100,
    inProductionAfter: start_date,
    inProductionBefore: end_date,
    sortOn: 'DUE_DATE',
    sortDescending: false,
  };

  const nodes = await paginateQuery(ORDERS_PAGINATED_QUERY, variables, 'orders', 20);

  // Client-side exclude filter
  let filtered = nodes;
  if (exclude_status_ids?.length) {
    const excludeSet = new Set(exclude_status_ids.map(String));
    filtered = nodes.filter((o) => !excludeSet.has(String(o.status?.id)));
  }

  if (filtered.length === 0) {
    return `No orders in production between ${start_date} and ${end_date}.`;
  }

  const lines = [
    `=== Production Schedule: ${start_date} to ${end_date} ===`,
    `${filtered.length} order(s)`,
    '',
  ];

  for (const order of filtered) {
    lines.push(`Order #${order.visualId || 'N/A'} (ID: ${order.id})`);
    if (order.nickname) lines.push(`  Name: ${order.nickname}`);
    lines.push(`  Customer: ${formatContactLine(order.contact)}`);
    lines.push(`  Status: ${order.status?.name || 'N/A'}`);
    lines.push(`  Start: ${formatDate(order.startAt)} | Due: ${formatDate(order.dueAt)}`);
    lines.push(`  Qty: ${order.totalQuantity ?? 'N/A'} | Total: ${formatCurrency(order.total)}`);
    lines.push('');
  }

  return lines.join('\n');
}

async function handleGetAccountInfo() {
  const data = await executeQuery(GET_ACCOUNT_INFO_QUERY, {});
  const account = data.account;

  if (!account) return 'Could not retrieve account information.';

  const lines = [
    `=== Printavo Account: ${account.companyName || 'N/A'} ===`,
    '',
  ];

  if (account.companyEmail) lines.push(`Email: ${account.companyEmail}`);
  if (account.phone) lines.push(`Phone: ${account.phone}`);
  if (account.website) lines.push(`Website: ${account.website}`);

  const addr = account.address;
  if (addr) {
    const addrParts = [addr.address1, addr.address2, [addr.city, addr.state, addr.zipCode].filter(Boolean).join(', ')].filter(Boolean);
    if (addrParts.length > 0) lines.push(`Address: ${addrParts.join(', ')}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/**
 * Route a tool call to the appropriate handler.
 *
 * @param {string} name - Tool name
 * @param {object} args - Tool arguments
 * @returns {Promise<string>} - Formatted text response
 */
export async function handleToolCall(name, args) {
  switch (name) {
    case 'search_invoices':
      return handleSearchInvoices(args);
    case 'get_invoice_detail':
      return handleGetInvoiceDetail(args);
    case 'search_customers':
      return handleSearchCustomers(args);
    case 'get_customer_detail':
      return handleGetCustomerDetail(args);
    case 'list_statuses':
      return handleListStatuses();
    case 'get_order_stats':
      return handleGetOrderStats(args);
    case 'get_production_schedule':
      return handleGetProductionSchedule(args);
    case 'get_account_info':
      return handleGetAccountInfo();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

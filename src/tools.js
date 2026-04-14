/**
 * MCP tool definitions and handlers for the Printavo connector.
 * Includes read-only queries and line item mutations.
 * Field names verified against Printavo API v2 via schema introspection.
 * NOTE: orders query returns Quote type nodes, not Invoice.
 */

import { executeQuery, paginateQuery } from './printavo-client.js';
import {
  SEARCH_INVOICES_QUERY,
  GET_ORDER_DETAIL_QUERY,
  SEARCH_CUSTOMERS_QUERY,
  GET_CUSTOMER_DETAIL_QUERY,
  LIST_STATUSES_QUERY,
  GET_ACCOUNT_INFO_QUERY,
  ORDERS_PAGINATED_QUERY,
  LINE_ITEM_CREATE_MUTATION,
  LINE_ITEM_UPDATE_MUTATION,
} from './queries.js';

function formatCurrency(value) {
  if (value == null) return 'N/A';
  const num = parseFloat(value);
  return isNaN(num) ? String(value) : `$${num.toFixed(2)}`;
}

function formatDate(isoString) {
  if (!isoString) return 'N/A';
  try { return new Date(isoString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch (_) { return isoString; }
}

function formatAddress(addr) {
  if (!addr) return null;
  return [addr.address1, [addr.city, addr.state, addr.zipCode].filter(Boolean).join(', ')].filter(Boolean).join(', ');
}

function formatSizes(sizes) {
  if (!sizes || !Array.isArray(sizes)) return '';
  return sizes.filter(s => s.count > 0).map(s => `${s.size}:${s.count}`).join(' ');
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const toolDefinitions = [
  {
    name: 'search_invoices',
    description: 'Read-only. Search Printavo invoices/orders with optional filters for date range, status, payment status, and free-text query. Returns a paginated list of matching invoices with key details.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'ISO 8601 date (YYYY-MM-DD). Production start on or after.' },
        end_date: { type: 'string', description: 'ISO 8601 date (YYYY-MM-DD). Production due on or before.' },
        status_ids: { type: 'array', items: { type: 'string' }, description: 'Filter by status IDs.' },
        payment_status: { type: 'string', enum: ['PAID', 'UNPAID', 'PARTIAL'] },
        query: { type: 'string', description: 'Free-text search (customer name, visual ID, nickname).' },
        limit: { type: 'number', minimum: 1, maximum: 25, description: '1–25 results per page. Default 25.' },
        after: { type: 'string', description: 'Pagination cursor.' },
      },
    },
  },
  {
    name: 'get_invoice_detail',
    description: 'Read-only. Get complete detail for a Printavo order by visual ID (e.g. "12345"), including all line items with sizes, pricing, categories, imprint methods, and fees.',
    inputSchema: {
      type: 'object',
      required: ['visual_id'],
      properties: {
        visual_id: { type: 'string', description: 'The visual order number shown in Printavo (e.g. "12345"), NOT the internal ID.' },
      },
    },
  },
  {
    name: 'search_customers',
    description: 'Read-only. Search/list Printavo customers with pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Filter by name, company, or email (client-side).' },
        limit: { type: 'number', minimum: 1, maximum: 25 },
        after: { type: 'string' },
      },
    },
  },
  {
    name: 'get_customer_detail',
    description: 'Read-only. Get detailed information for a specific Printavo contact by ID.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
  },
  {
    name: 'list_statuses',
    description: 'Read-only. List all order statuses configured in the Printavo account.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_order_stats',
    description: 'Read-only. Aggregate statistics for orders in a date range: total orders, revenue, pieces, average order value, average pieces per order, breakdown by status.',
    inputSchema: {
      type: 'object',
      required: ['start_date', 'end_date'],
      properties: {
        start_date: { type: 'string' },
        end_date: { type: 'string' },
        status_ids: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'get_production_schedule',
    description: 'Read-only. Get orders currently in production or due within a date range, sorted by due date.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Defaults to today.' },
        end_date: { type: 'string', description: 'Defaults to 14 days from today.' },
        exclude_status_ids: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'get_account_info',
    description: 'Read-only. Get basic Printavo account information.',
    inputSchema: { type: 'object', properties: {} },
  },

  // -------------------------------------------------------------------------
  // Mutation tools — line items
  // -------------------------------------------------------------------------

  {
    name: 'add_line_item',
    description: 'MUTATION. Add a new line item to an existing line item group on an invoice. Requires the line item group ID (get it from get_invoice_detail). Returns the created line item with its new ID.',
    inputSchema: {
      type: 'object',
      required: ['line_item_group_id', 'description', 'position'],
      properties: {
        line_item_group_id: { type: 'string', description: 'The ID of the line item group to add this line item to. Get this from get_invoice_detail.' },
        description: { type: 'string', description: 'Style description (e.g. "Gildan 5000 Heavy Cotton Tee").' },
        item_number: { type: 'string', description: 'Item/style number (e.g. "G5000").' },
        color: { type: 'string', description: 'Color of the item (e.g. "Black").' },
        price: { type: 'number', description: 'Price per item in dollars.' },
        position: { type: 'number', description: 'Position/order of this line item within the group (1-based).' },
        taxed: { type: 'boolean', description: 'Whether this line item is taxable. Defaults to true.' },
        sizes: { type: 'object', description: 'Size quantities as key-value pairs. Keys: YXS, YS, YM, YL, YXL, XS, S, M, L, XL, 2XL, 3XL, 4XL, 5XL, 6XL, OTHER, 6M, 12M, 18M, 24M, 2T, 3T, 4T, 5T. Values: integer counts. Example: { "S": 5, "M": 10, "L": 8 }' },
      },
    },
  },
  {
    name: 'update_line_item',
    description: 'MUTATION. Update an existing line item on an invoice. Can change description, item number, color, price, position, and/or taxed status. Use update_line_item_sizes to change size quantities.',
    inputSchema: {
      type: 'object',
      required: ['id', 'position'],
      properties: {
        id: { type: 'string', description: 'The ID of the line item to update. Get this from get_invoice_detail.' },
        description: { type: 'string', description: 'New style description.' },
        item_number: { type: 'string', description: 'New item/style number.' },
        color: { type: 'string', description: 'New color.' },
        price: { type: 'number', description: 'New price per item in dollars.' },
        position: { type: 'number', description: 'Position of this line item within the group (1-based). Required by the API.' },
        taxed: { type: 'boolean', description: 'Whether this line item is taxable.' },
      },
    },
  },
  {
    name: 'update_line_item_sizes',
    description: 'MUTATION. Update the size quantities for an existing line item. Replaces all sizes with the provided values. Any size not included will be set to 0.',
    inputSchema: {
      type: 'object',
      required: ['id', 'position', 'sizes'],
      properties: {
        id: { type: 'string', description: 'The ID of the line item to update sizes for. Get this from get_invoice_detail.' },
        position: { type: 'number', description: 'Current position of the line item (required by the API). Get this from get_invoice_detail.' },
        sizes: { type: 'object', description: 'Size quantities as key-value pairs. Keys: YXS, YS, YM, YL, YXL, XS, S, M, L, XL, 2XL, 3XL, 4XL, 5XL, 6XL, OTHER, 6M, 12M, 18M, 24M, 2T, 3T, 4T, 5T. Values: integer counts. Example: { "S": 5, "M": 10, "L": 8, "XL": 3 }' },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleSearchInvoices(args) {
  const { start_date, end_date, status_ids, payment_status, query, limit = 25, after } = args || {};
  const variables = { first: Math.min(parseInt(limit) || 25, 25) };
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

  if (nodes.length === 0) return 'No invoices found matching the given criteria.';

  const lines = [`Found ${nodes.length} invoice(s)${pageInfo.hasNextPage ? ' (more available)' : ''}:`, ''];
  for (const inv of nodes) {
    lines.push(`Order #${inv.visualId || 'N/A'} (ID: ${inv.id})`);
    if (inv.nickname) lines.push(`  Name: ${inv.nickname}`);
    lines.push(`  Customer: ${inv.contact?.fullName || 'N/A'}`);
    lines.push(`  Status: ${inv.status?.name || 'N/A'}`);
    lines.push(`  Total: ${formatCurrency(inv.total)} | Qty: ${inv.totalQuantity ?? 'N/A'} | Paid: ${inv.paidInFull ? 'Yes' : 'No'}`);
    lines.push(`  Due: ${formatDate(inv.dueAt)} | Tags: ${(inv.tags || []).join(', ') || 'none'}`);
    if (inv.productionNote) lines.push(`  Note: ${inv.productionNote}`);
    lines.push('');
  }
  if (pageInfo.hasNextPage) lines.push(`Next page cursor: ${pageInfo.endCursor}`);
  return lines.join('\n');
}

async function handleGetInvoiceDetail(args) {
  const { visual_id } = args || {};
  if (!visual_id) throw new Error('`visual_id` is required');

  const data = await executeQuery(GET_ORDER_DETAIL_QUERY, { first: 1, query: String(visual_id) });
  const nodes = data.orders?.nodes || [];
  const inv = nodes[0];
  if (!inv) return `No order found with visual ID: ${visual_id}`;

  const lines = [
    `=== Order #${inv.visualId || 'N/A'} — ${inv.nickname || ''} ===`,
    `Status: ${inv.status?.name || 'N/A'}`,
    `Customer: ${inv.contact?.fullName || 'N/A'} (${inv.contact?.email || 'N/A'})`,
    `Owner: ${inv.owner?.email || 'N/A'}`,
    '',
    `Total: ${formatCurrency(inv.total)} | Paid: ${formatCurrency(inv.amountPaid)} | Outstanding: ${formatCurrency(inv.amountOutstanding)}`,
    `Qty: ${inv.totalQuantity ?? 'N/A'} | Paid in Full: ${inv.paidInFull ? 'Yes' : 'No'}`,
    `Created: ${formatDate(inv.createdAt)} | Start: ${formatDate(inv.startAt)} | Due: ${formatDate(inv.dueAt)}`,
    `Tags: ${(inv.tags || []).join(', ') || 'none'}`,
    `Delivery: ${inv.deliveryMethod?.name || 'N/A'}`,
    `Ship to: ${formatAddress(inv.shippingAddress) || 'N/A'}`,
    '',
  ];

  if (inv.productionNote) lines.push(`Production Note: ${inv.productionNote}`, '');
  if (inv.customerNote) lines.push(`Customer Note: ${inv.customerNote}`, '');

  const groups = inv.lineItemGroups?.nodes || [];
  if (groups.length > 0) {
    lines.push('--- Line Items ---');
    for (const g of groups) {
      lines.push(`  Group: ${g.id ? `(Group ID: ${g.id})` : '(No Group ID)'}`);
      const imprints = (g.imprints?.nodes || []).map(i => [i.typeOfWork?.name, i.details].filter(Boolean).join(': ')).filter(Boolean).join('; ');
      if (imprints) lines.push(`  Imprint: ${imprints}`);
      for (const li of (g.lineItems?.nodes || [])) {
        const prod = li.product;
        const prodStr = [prod?.itemNumber, prod?.description, prod?.brand, prod?.color].filter(Boolean).join(' / ');
        lines.push(`  • [${li.category?.name || 'No Category'}] ${li.description || 'N/A'} (Line Item ID: ${li.id || 'N/A'}, Position: ${li.position ?? 'N/A'})`);
        if (prodStr) lines.push(`    Product: ${prodStr}`);
        if (li.color) lines.push(`    Color: ${li.color}`);
        if (li.itemNumber) lines.push(`    Item #: ${li.itemNumber}`);
        lines.push(`    Qty: ${li.items ?? 'N/A'} @ ${formatCurrency(li.price)} = ${formatCurrency((li.items || 0) * (li.price || 0))}`);
        const sizes = formatSizes(li.sizes);
        if (sizes) lines.push(`    Sizes: ${sizes}`);
        lines.push('');
      }
    }
  }

  const fees = inv.fees?.nodes || [];
  if (fees.length > 0) {
    lines.push('--- Fees ---');
    for (const f of fees) lines.push(`  ${f.description || 'Fee'}: ${formatCurrency(f.amount)}`);
  }

  return lines.join('\n');
}

async function handleSearchCustomers(args) {
  const { query, limit = 25, after } = args || {};
  const variables = { first: Math.min(parseInt(limit) || 25, 25) };
  if (after) variables.after = after;

  const data = await executeQuery(SEARCH_CUSTOMERS_QUERY, variables);
  let nodes = data.customers?.nodes || [];
  const pageInfo = data.customers?.pageInfo || {};
  const totalNodes = data.customers?.totalNodes;

  if (query) {
    const q = query.toLowerCase();
    nodes = nodes.filter(c =>
      c.companyName?.toLowerCase().includes(q) ||
      c.primaryContact?.fullName?.toLowerCase().includes(q) ||
      c.primaryContact?.email?.toLowerCase().includes(q)
    );
  }

  if (nodes.length === 0) return query ? `No customers found matching "${query}".` : 'No customers found.';

  const lines = [`${nodes.length} customer(s)${totalNodes ? ` (of ${totalNodes} total)` : ''}:`, ''];
  for (const c of nodes) {
    const pc = c.primaryContact;
    lines.push(`${c.companyName || pc?.fullName || 'N/A'} (ID: ${c.id})`);
    if (pc?.fullName && c.companyName) lines.push(`  Contact: ${pc.fullName}`);
    if (pc?.email) lines.push(`  Email: ${pc.email}`);
    lines.push(`  Orders: ${c.orderCount ?? 'N/A'}`);
    lines.push('');
  }
  if (pageInfo.hasNextPage) lines.push(`Next page cursor: ${pageInfo.endCursor}`);
  return lines.join('\n');
}

async function handleGetCustomerDetail(args) {
  const { id } = args || {};
  if (!id) throw new Error('`id` is required');
  const data = await executeQuery(GET_CUSTOMER_DETAIL_QUERY, { id });
  const c = data.contact;
  if (!c) return `No contact found with ID: ${id}`;
  const lines = [`${c.fullName || 'N/A'} (ID: ${c.id})`];
  if (c.email) lines.push(`Email: ${c.email}`);
  if (c.phone) lines.push(`Phone: ${c.phone}`);
  if (c.customer?.companyName) lines.push(`Company: ${c.customer.companyName}`);
  if (c.customer?.orderCount != null) lines.push(`Total Orders: ${c.customer.orderCount}`);
  if (c.customer?.internalNote) lines.push(`Internal Note: ${c.customer.internalNote}`);
  return lines.join('\n');
}

async function handleListStatuses() {
  const data = await executeQuery(LIST_STATUSES_QUERY, {});
  const statuses = data.statuses?.nodes || [];
  if (statuses.length === 0) return 'No statuses found.';
  const sorted = [...statuses].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const lines = [`${sorted.length} statuses:`, ''];
  for (const s of sorted) {
    lines.push(`• ${s.name} (ID: ${s.id}) — Color: ${s.color || 'N/A'} | Type: ${s.type || 'N/A'}`);
  }
  return lines.join('\n');
}

async function handleGetOrderStats(args) {
  const { start_date, end_date, status_ids } = args || {};
  if (!start_date || !end_date) throw new Error('start_date and end_date required');

  const variables = { first: 25, inProductionAfter: start_date, inProductionBefore: end_date };
  if (status_ids?.length) variables.statusIds = status_ids;

  const nodes = await paginateQuery(ORDERS_PAGINATED_QUERY, variables, 'orders', 50);
  if (nodes.length === 0) return `No orders found between ${start_date} and ${end_date}.`;

  let totalRevenue = 0, totalPieces = 0;
  const statusBreakdown = {};
  for (const o of nodes) {
    const total = parseFloat(o.total) || 0;
    totalRevenue += total;
    totalPieces += o.totalQuantity || 0;
    const s = o.status?.name || 'Unknown';
    if (!statusBreakdown[s]) statusBreakdown[s] = { count: 0, revenue: 0, pieces: 0 };
    statusBreakdown[s].count++;
    statusBreakdown[s].revenue += total;
    statusBreakdown[s].pieces += o.totalQuantity || 0;
  }

  const lines = [
    `=== Order Stats: ${start_date} to ${end_date} ===`, '',
    `Total Orders:     ${nodes.length}`,
    `Total Revenue:    ${formatCurrency(totalRevenue)}`,
    `Total Pieces:     ${totalPieces}`,
    `Avg Order Value:  ${formatCurrency(totalRevenue / nodes.length)}`,
    `Avg Pieces/Order: ${(totalPieces / nodes.length).toFixed(1)}`,
    '', '--- By Status ---',
  ];
  for (const [name, s] of Object.entries(statusBreakdown).sort((a, b) => b[1].count - a[1].count)) {
    lines.push(`  ${name}: ${s.count} orders | ${formatCurrency(s.revenue)} | ${s.pieces} pcs`);
  }
  return lines.join('\n');
}

async function handleGetProductionSchedule(args) {
  const { exclude_status_ids } = args || {};
  const today = new Date();
  const defaultEnd = new Date(today); defaultEnd.setDate(defaultEnd.getDate() + 14);
  const start_date = args?.start_date || today.toISOString().split('T')[0];
  const end_date = args?.end_date || defaultEnd.toISOString().split('T')[0];

  const variables = { first: 25, inProductionAfter: start_date, inProductionBefore: end_date };
  let nodes = await paginateQuery(ORDERS_PAGINATED_QUERY, variables, 'orders', 20);

  if (exclude_status_ids?.length) {
    const excl = new Set(exclude_status_ids.map(String));
    nodes = nodes.filter(o => !excl.has(String(o.status?.id)));
  }

  if (nodes.length === 0) return `No orders in production between ${start_date} and ${end_date}.`;

  const lines = [`=== Production Schedule: ${start_date} to ${end_date} — ${nodes.length} orders ===`, ''];
  for (const o of nodes) {
    lines.push(`#${o.visualId} ${o.nickname || ''} | ${o.contact?.fullName || 'N/A'} | ${o.status?.name || 'N/A'} | Due: ${formatDate(o.dueAt)} | Qty: ${o.totalQuantity ?? 'N/A'} | ${formatCurrency(o.total)}`);
  }
  return lines.join('\n');
}

async function handleGetAccountInfo() {
  const data = await executeQuery(GET_ACCOUNT_INFO_QUERY, {});
  const a = data.account;
  if (!a) return 'Could not retrieve account info.';
  const lines = [`${a.companyName || 'N/A'}`];
  if (a.companyEmail) lines.push(`Email: ${a.companyEmail}`);
  if (a.phone) lines.push(`Phone: ${a.phone}`);
  if (a.website) lines.push(`Website: ${a.website}`);
  if (a.address) {
    lines.push(`Address: ${[a.address.address1, a.address.city, a.address.state, a.address.zipCode].filter(Boolean).join(', ')}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Mutation helpers
// ---------------------------------------------------------------------------

/** Map friendly size names to Printavo LineItemSize enum values. */
const SIZE_NAME_TO_ENUM = {
  'YXS': 'size_yxs', 'yxs': 'size_yxs',
  'YS': 'size_ys', 'ys': 'size_ys',
  'YM': 'size_ym', 'ym': 'size_ym',
  'YL': 'size_yl', 'yl': 'size_yl',
  'YXL': 'size_yxl', 'yxl': 'size_yxl',
  'XS': 'size_xs', 'xs': 'size_xs',
  'S': 'size_s', 's': 'size_s',
  'M': 'size_m', 'm': 'size_m',
  'L': 'size_l', 'l': 'size_l',
  'XL': 'size_xl', 'xl': 'size_xl',
  '2XL': 'size_2xl', '2xl': 'size_2xl', 'XXL': 'size_2xl', 'xxl': 'size_2xl',
  '3XL': 'size_3xl', '3xl': 'size_3xl', 'XXXL': 'size_3xl',
  '4XL': 'size_4xl', '4xl': 'size_4xl',
  '5XL': 'size_5xl', '5xl': 'size_5xl',
  '6XL': 'size_6xl', '6xl': 'size_6xl',
  'OTHER': 'size_other', 'other': 'size_other', 'Other': 'size_other',
  '6M': 'size_6m', '6m': 'size_6m',
  '12M': 'size_12m', '12m': 'size_12m',
  '18M': 'size_18m', '18m': 'size_18m',
  '24M': 'size_24m', '24m': 'size_24m',
  '2T': 'size_2t', '2t': 'size_2t',
  '3T': 'size_3t', '3t': 'size_3t',
  '4T': 'size_4t', '4t': 'size_4t',
  '5T': 'size_5t', '5t': 'size_5t',
};
const VALID_ENUM_VALUES = new Set(Object.values(SIZE_NAME_TO_ENUM));

function parseSizesToInput(sizes) {
  if (!sizes || typeof sizes !== 'object') return [];
  const result = [];
  for (const [key, count] of Object.entries(sizes)) {
    const intCount = parseInt(count);
    if (isNaN(intCount) || intCount < 0) continue;
    let enumValue = SIZE_NAME_TO_ENUM[key];
    if (!enumValue && VALID_ENUM_VALUES.has(key)) enumValue = key;
    if (!enumValue) {
      throw new Error(`Unknown size: "${key}". Valid: YXS, YS, YM, YL, YXL, XS, S, M, L, XL, 2XL, 3XL, 4XL, 5XL, 6XL, OTHER, 6M, 12M, 18M, 24M, 2T, 3T, 4T, 5T`);
    }
    result.push({ size: enumValue, count: intCount });
  }
  return result;
}

function formatMutationResult(item, action) {
  const lines = [`\u2705 Line item ${action} successfully.`, '', `ID: ${item.id}`];
  if (item.description) lines.push(`Description: ${item.description}`);
  if (item.itemNumber) lines.push(`Item #: ${item.itemNumber}`);
  if (item.color) lines.push(`Color: ${item.color}`);
  if (item.price != null) lines.push(`Price: ${formatCurrency(item.price)}`);
  lines.push(`Total Qty: ${item.items ?? 'N/A'}`);
  lines.push(`Position: ${item.position}`);
  lines.push(`Taxed: ${item.taxed ? 'Yes' : 'No'}`);
  const sizeStr = formatSizes(item.sizes);
  if (sizeStr) lines.push(`Sizes: ${sizeStr}`);
  if (item.lineItemGroup) {
    lines.push(`Group ID: ${item.lineItemGroup.id} (Position: ${item.lineItemGroup.position ?? 'N/A'})`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Mutation handlers
// ---------------------------------------------------------------------------

async function handleAddLineItem(args) {
  const { line_item_group_id, description, item_number, color, price, position, taxed, sizes } = args || {};
  if (!line_item_group_id) throw new Error('`line_item_group_id` is required');
  if (!description) throw new Error('`description` is required');
  if (position == null) throw new Error('`position` is required');

  const input = { description, position: parseInt(position) };
  if (item_number != null) input.itemNumber = item_number;
  if (color != null) input.color = color;
  if (price != null) input.price = parseFloat(price);
  if (taxed != null) input.taxed = taxed;
  if (sizes) input.sizes = parseSizesToInput(sizes);

  const data = await executeQuery(LINE_ITEM_CREATE_MUTATION, { lineItemGroupId: line_item_group_id, input });
  return formatMutationResult(data.lineItemCreate, 'created');
}

async function handleUpdateLineItem(args) {
  const { id, description, item_number, color, price, position, taxed } = args || {};
  if (!id) throw new Error('`id` is required');
  if (position == null) throw new Error('`position` is required');

  const input = { position: parseInt(position) };
  if (description != null) input.description = description;
  if (item_number != null) input.itemNumber = item_number;
  if (color != null) input.color = color;
  if (price != null) input.price = parseFloat(price);
  if (taxed != null) input.taxed = taxed;

  const data = await executeQuery(LINE_ITEM_UPDATE_MUTATION, { id, input });
  return formatMutationResult(data.lineItemUpdate, 'updated');
}

async function handleUpdateLineItemSizes(args) {
  const { id, position, sizes } = args || {};
  if (!id) throw new Error('`id` is required');
  if (position == null) throw new Error('`position` is required');
  if (!sizes || typeof sizes !== 'object' || Object.keys(sizes).length === 0) {
    throw new Error('`sizes` must be a non-empty object');
  }

  const input = { position: parseInt(position), sizes: parseSizesToInput(sizes) };
  const data = await executeQuery(LINE_ITEM_UPDATE_MUTATION, { id, input });
  return formatMutationResult(data.lineItemUpdate, 'sizes updated');
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleToolCall(name, args) {
  switch (name) {
    case 'search_invoices': return handleSearchInvoices(args);
    case 'get_invoice_detail': return handleGetInvoiceDetail(args);
    case 'search_customers': return handleSearchCustomers(args);
    case 'get_customer_detail': return handleGetCustomerDetail(args);
    case 'list_statuses': return handleListStatuses();
    case 'get_order_stats': return handleGetOrderStats(args);
    case 'get_production_schedule': return handleGetProductionSchedule(args);
    case 'get_account_info': return handleGetAccountInfo();
    case 'add_line_item': return handleAddLineItem(args);
    case 'update_line_item': return handleUpdateLineItem(args);
    case 'update_line_item_sizes': return handleUpdateLineItemSizes(args);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

#!/usr/bin/env node
/**
 * Pull all 2025 invoice detail with line items from Printavo API.
 * Run locally: node pull-all-line-items.js
 * Outputs: line_items.csv, invoices_summary.csv, raw_data.json
 */

const fs = require('fs');
const https = require('https');

const EMAIL = process.env.PRINTAVO_EMAIL;
const TOKEN = process.env.PRINTAVO_API_TOKEN;

if (!EMAIL || !TOKEN) {
  console.error('Missing PRINTAVO_EMAIL or PRINTAVO_API_TOKEN env vars');
  process.exit(1);
}

const DETAIL_QUERY = `query($id: ID!) {
  invoice(id: $id) {
    id visualId nickname total subtotal totalUntaxed totalQuantity amountPaid amountOutstanding
    salesTax salesTaxAmount discount discountAmount discountAsPercentage
    createdAt dueAt invoiceAt customerDueAt startAt paidInFull
    productionNote customerNote tags merch
    status { id name } contact { id fullName email } owner { id email }
    deliveryMethod { id name }
    billingAddress { address1 city state zipCode }
    shippingAddress { address1 city state zipCode }
    lineItemGroups { nodes { id position
      imprints { nodes { id name description } }
      lineItems { nodes {
        id description color itemNumber items price position taxed markupPercentage
        category { id name } product { id name } productStatus { id name }
        sizes { size count }
      } }
    } }
    fees { nodes { id description amount taxed } }
  }
}`;

const LIST_QUERY = `query($first: Int, $after: String, $inProductionAfter: ISO8601DateTime, $inProductionBefore: ISO8601DateTime) {
  orders(first: $first, after: $after, inProductionAfter: $inProductionAfter, inProductionBefore: $inProductionBefore, sortOn: VISUAL_ID) {
    nodes { ... on Invoice { id visualId } }
    pageInfo { hasNextPage endCursor }
  }
}`;

function apiCall(query, variables) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const options = {
      hostname: 'www.printavo.com', path: '/api/v2', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'email': EMAIL, 'token': TOKEN, 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.errors) reject(new Error(json.errors[0].message));
          else resolve(json.data);
        } catch (e) { reject(new Error(`Parse error: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function escCsv(val) {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  console.log('Step 1: Getting all 2025 invoice IDs...');
  
  const periods = [
    ['Jan-Feb', '2025-01-01', '2025-02-28'], ['Mar-Apr', '2025-03-01', '2025-04-30'],
    ['May-Jun', '2025-05-01', '2025-06-30'], ['Jul-Aug', '2025-07-01', '2025-08-31'],
    ['Sep', '2025-09-01', '2025-09-30'], ['Oct', '2025-10-01', '2025-10-31'],
    ['Nov', '2025-11-01', '2025-11-30'], ['Dec', '2025-12-01', '2025-12-31'],
  ];

  let allIds = [];
  for (const [name, start, end] of periods) {
    let cursor = null;
    let count = 0;
    while (true) {
      const vars = { first: 25, inProductionAfter: start, inProductionBefore: end };
      if (cursor) vars.after = cursor;
      try {
        const data = await apiCall(LIST_QUERY, vars);
        const nodes = data.orders?.nodes || [];
        const pageInfo = data.orders?.pageInfo || {};
        for (const n of nodes) { if (n?.id) { allIds.push(n.id); count++; } }
        if (pageInfo.hasNextPage && pageInfo.endCursor) { cursor = pageInfo.endCursor; await sleep(550); }
        else break;
      } catch (e) { console.error(`  Error listing ${name}: ${e.message}`); break; }
    }
    console.log(`  ${name}: ${count} invoices`);
  }
  console.log(`Total invoice IDs: ${allIds.length}\n`);

  // Step 2: Pull each invoice detail
  console.log('Step 2: Pulling full detail for each invoice...');
  const allDetails = [];
  const errors = [];
  const startTime = Date.now();

  for (let i = 0; i < allIds.length; i++) {
    try {
      const data = await apiCall(DETAIL_QUERY, { id: allIds[i] });
      if (data.invoice) allDetails.push(data.invoice);
      else errors.push({ id: allIds[i], error: 'null response' });
    } catch (e) {
      errors.push({ id: allIds[i], error: e.message });
      // Retry once after delay
      await sleep(2000);
      try {
        const data = await apiCall(DETAIL_QUERY, { id: allIds[i] });
        if (data.invoice) { allDetails.push(data.invoice); errors.pop(); }
      } catch (e2) { /* already logged */ }
    }

    if ((i + 1) % 50 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = (i + 1) / elapsed * 60;
      const eta = Math.round((allIds.length - i - 1) / (rate / 60));
      console.log(`  ${i + 1}/${allIds.length} (${allDetails.length} ok, ${errors.length} err) — ${Math.round(rate)}/min, ETA ${eta}s`);
    }
    await sleep(550);
  }

  console.log(`\nPulled: ${allDetails.length} invoices (${errors.length} errors) in ${Math.round((Date.now() - startTime) / 1000)}s\n`);

  // Save raw JSON
  fs.writeFileSync('raw_data.json', JSON.stringify(allDetails, null, 2));
  console.log('Saved raw_data.json');

  // Step 3: Build CSVs
  console.log('Step 3: Building CSVs...');

  // LINE ITEMS CSV
  const liHeaders = [
    'invoice_id', 'visual_id', 'nickname', 'invoice_total', 'invoice_qty', 'invoice_paid_full',
    'invoice_created', 'invoice_due', 'invoice_status', 'invoice_tags',
    'customer_name', 'customer_email', 'owner_email',
    'production_note',
    'line_item_group_id', 'group_position', 'imprint_names',
    'line_item_id', 'item_number', 'description', 'color', 'quantity', 'price_each', 'line_total',
    'taxed', 'markup_pct',
    'category_name', 'product_name', 'product_status',
    'size_other', 'size_yxs', 'size_ys', 'size_ym', 'size_yl', 'size_yxl',
    'size_xs', 'size_s', 'size_m', 'size_l', 'size_xl',
    'size_2xl', 'size_3xl', 'size_4xl', 'size_5xl', 'size_6xl'
  ];

  const liRows = [liHeaders.join(',')];
  let totalLineItems = 0;

  for (const inv of allDetails) {
    const tags = (inv.tags || []).join('; ');
    const groups = inv.lineItemGroups?.nodes || [];

    for (const group of groups) {
      const imprints = (group.imprints?.nodes || []).map(imp => imp.name).join('; ');
      const items = group.lineItems?.nodes || [];

      for (const li of items) {
        totalLineItems++;
        const sizeMap = {};
        for (const s of (li.sizes || [])) { sizeMap[s.size?.toLowerCase()] = s.count || 0; }

        const row = [
          inv.id, inv.visualId, inv.nickname, inv.total, inv.totalQuantity, inv.paidInFull,
          inv.createdAt, inv.dueAt, inv.status?.name, tags,
          inv.contact?.fullName, inv.contact?.email, inv.owner?.email,
          inv.productionNote,
          group.id, group.position, imprints,
          li.id, li.itemNumber, li.description, li.color, li.items, li.price,
          (li.items || 0) * (li.price || 0),
          li.taxed, li.markupPercentage,
          li.category?.name, li.product?.name, li.productStatus?.name,
          sizeMap['other'] || 0, sizeMap['yxs'] || 0, sizeMap['ys'] || 0, sizeMap['ym'] || 0,
          sizeMap['yl'] || 0, sizeMap['yxl'] || 0,
          sizeMap['xs'] || 0, sizeMap['s'] || 0, sizeMap['m'] || 0, sizeMap['l'] || 0,
          sizeMap['xl'] || 0,
          sizeMap['2xl'] || sizeMap['xxl'] || 0, sizeMap['3xl'] || 0, sizeMap['4xl'] || 0,
          sizeMap['5xl'] || 0, sizeMap['6xl'] || 0
        ];
        liRows.push(row.map(escCsv).join(','));
      }
    }
  }
  fs.writeFileSync('line_items.csv', liRows.join('\n'));
  console.log(`Saved line_items.csv (${totalLineItems} line items)`);

  // INVOICE SUMMARY CSV
  const invHeaders = [
    'invoice_id', 'visual_id', 'nickname', 'total', 'subtotal', 'total_untaxed',
    'total_quantity', 'amount_paid', 'amount_outstanding',
    'sales_tax', 'discount', 'paid_in_full',
    'created_at', 'due_at', 'invoice_at', 'start_at',
    'status', 'tags', 'customer_name', 'customer_email', 'owner_email',
    'production_note', 'delivery_method', 'merch',
    'line_item_count', 'line_item_group_count', 'fee_count', 'total_fees',
    'ship_city', 'ship_state'
  ];

  const invRows = [invHeaders.join(',')];
  for (const inv of allDetails) {
    const groups = inv.lineItemGroups?.nodes || [];
    let liCount = 0;
    for (const g of groups) liCount += (g.lineItems?.nodes || []).length;
    const fees = inv.fees?.nodes || [];
    const totalFees = fees.reduce((sum, f) => sum + (f.amount || 0), 0);

    const row = [
      inv.id, inv.visualId, inv.nickname, inv.total, inv.subtotal, inv.totalUntaxed,
      inv.totalQuantity, inv.amountPaid, inv.amountOutstanding,
      inv.salesTaxAmount, inv.discountAmount, inv.paidInFull,
      inv.createdAt, inv.dueAt, inv.invoiceAt, inv.startAt,
      inv.status?.name, (inv.tags || []).join('; '), inv.contact?.fullName, inv.contact?.email, inv.owner?.email,
      inv.productionNote, inv.deliveryMethod?.name, inv.merch,
      liCount, groups.length, fees.length, totalFees,
      inv.shippingAddress?.city, inv.shippingAddress?.state
    ];
    invRows.push(row.map(escCsv).join(','));
  }
  fs.writeFileSync('invoices_summary.csv', invRows.join('\n'));
  console.log(`Saved invoices_summary.csv (${allDetails.length} invoices)`);

  // Quick stats
  console.log(`\n=== SUMMARY ===`);
  console.log(`Invoices: ${allDetails.length}`);
  console.log(`Line items: ${totalLineItems}`);
  console.log(`Errors: ${errors.length}`);
  if (errors.length) fs.writeFileSync('pull_errors.json', JSON.stringify(errors, null, 2));
  console.log('\nDone! Upload line_items.csv and invoices_summary.csv to Perplexity for analysis.');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });

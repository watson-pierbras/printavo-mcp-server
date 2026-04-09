#!/usr/bin/env node
/**
 * Pull all 2025 invoice detail with line items from Printavo API.
 * Outputs: line_items.csv, invoices_summary.csv, raw_data.json
 */
const fs = require('fs');
const https = require('https');
const EMAIL = process.env.PRINTAVO_EMAIL;
const TOKEN = process.env.PRINTAVO_API_TOKEN;
if (!EMAIL || !TOKEN) { console.error('Missing env vars'); process.exit(1); }

const QUERY = `query($first: Int, $after: String, $inProductionAfter: ISO8601DateTime, $inProductionBefore: ISO8601DateTime) {
  orders(first: $first, after: $after, inProductionAfter: $inProductionAfter, inProductionBefore: $inProductionBefore, sortOn: VISUAL_ID) {
    nodes {
      ... on Quote {
        id visualId nickname total subtotal totalUntaxed totalQuantity amountPaid amountOutstanding
        salesTax salesTaxAmount discount discountAmount
        createdAt dueAt invoiceAt startAt paidInFull
        productionNote customerNote tags merch
        status { id name } contact { id fullName email } owner { id email }
        deliveryMethod { id name }
        shippingAddress { city state zipCode }
        lineItemGroups { nodes { id position
          imprints { nodes { id details typeOfWork { id name } } }
          lineItems { nodes {
            id description color itemNumber items price position taxed markupPercentage
            category { id name }
            product { id description itemNumber brand color }
            sizes { size count }
          } }
        } }
        fees { nodes { id description amount taxed } }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

function apiCall(query, variables) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const req = https.request({
      hostname: 'www.printavo.com', path: '/api/v2', method: 'POST',
      headers: { 'Content-Type': 'application/json', email: EMAIL, token: TOKEN, 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.errors) reject(new Error(json.errors[0].message));
          else resolve(json.data);
        } catch (e) { reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body); req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
function escCsv(val) {
  if (val == null) return '';
  const s = String(val);
  return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  console.log('Pulling all 2025 invoices with full line item detail...\n');
  const periods = [
    ['Jan', '2025-01-01', '2025-01-31'], ['Feb', '2025-02-01', '2025-02-28'],
    ['Mar', '2025-03-01', '2025-03-31'], ['Apr', '2025-04-01', '2025-04-30'],
    ['May', '2025-05-01', '2025-05-31'], ['Jun', '2025-06-01', '2025-06-30'],
    ['Jul', '2025-07-01', '2025-07-31'], ['Aug', '2025-08-01', '2025-08-31'],
    ['Sep', '2025-09-01', '2025-09-30'], ['Oct', '2025-10-01', '2025-10-31'],
    ['Nov', '2025-11-01', '2025-11-30'], ['Dec', '2025-12-01', '2025-12-31'],
  ];

  const all = [];
  const errors = [];
  const t0 = Date.now();
  let pages = 0;

  for (const [name, start, end] of periods) {
    let cursor = null, count = 0;
    while (true) {
      const vars = { first: 3, inProductionAfter: start, inProductionBefore: end };
      if (cursor) vars.after = cursor;
      let ok = false;
      for (let retry = 0; retry < 3 && !ok; retry++) {
        try {
          const data = await apiCall(QUERY, vars);
          const nodes = data.orders?.nodes || [];
          const pi = data.orders?.pageInfo || {};
          for (const n of nodes) { if (n?.id) { all.push(n); count++; } }
          cursor = pi.hasNextPage ? pi.endCursor : null;
          ok = true; pages++;
        } catch (e) {
          if (retry < 2) await sleep(3000);
          else { errors.push({ period: name, error: e.message }); cursor = null; }
        }
      }
      if (!cursor) break;
      await sleep(600);
      if (pages % 50 === 0) {
        const elapsed = (Date.now() - t0) / 1000;
        console.log(`  ...${all.length} invoices, ${pages} pages, ${Math.round(elapsed)}s`);
      }
    }
    console.log(`${name}: ${count} invoices (total: ${all.length}, ${Math.round((Date.now()-t0)/1000)}s)`);
  }

  console.log(`\nDone: ${all.length} invoices in ${Math.round((Date.now()-t0)/1000)}s (${errors.length} errors)\n`);

  fs.writeFileSync('raw_data.json', JSON.stringify(all, null, 2));
  console.log('Saved raw_data.json');

  // LINE ITEMS CSV
  const hdr = [
    'invoice_id','visual_id','nickname','invoice_total','invoice_qty','invoice_paid_full',
    'invoice_created','invoice_due','invoice_status','invoice_tags',
    'customer_name','customer_email','owner_email','production_note',
    'group_id','group_position','imprint_type_of_work','imprint_details',
    'line_item_id','item_number','description','color','quantity','price_each','line_total',
    'taxed','markup_pct','category_name',
    'product_item_number','product_description','product_brand','product_color',
    'size_other','size_yxs','size_ys','size_ym','size_yl','size_yxl',
    'size_xs','size_s','size_m','size_l','size_xl',
    'size_2xl','size_3xl','size_4xl','size_5xl','size_6xl'
  ];
  const rows = [hdr.join(',')];
  let liTotal = 0;

  for (const inv of all) {
    const tags = (inv.tags || []).join('; ');
    for (const g of (inv.lineItemGroups?.nodes || [])) {
      const imps = (g.imprints?.nodes || []);
      const impWork = imps.map(i => i.typeOfWork?.name || '').filter(Boolean).join('; ');
      const impDetails = imps.map(i => i.details || '').filter(Boolean).join('; ');
      for (const li of (g.lineItems?.nodes || [])) {
        liTotal++;
        const sm = {};
        for (const s of (li.sizes || [])) sm[(s.size||'').toLowerCase()] = s.count || 0;
        const prod = li.product || {};
        rows.push([
          inv.id, inv.visualId, inv.nickname, inv.total, inv.totalQuantity, inv.paidInFull,
          inv.createdAt, inv.dueAt, inv.status?.name, tags,
          inv.contact?.fullName, inv.contact?.email, inv.owner?.email, inv.productionNote,
          g.id, g.position, impWork, impDetails,
          li.id, li.itemNumber, li.description, li.color, li.items, li.price,
          (li.items||0)*(li.price||0), li.taxed, li.markupPercentage, li.category?.name,
          prod.itemNumber, prod.description, prod.brand, prod.color,
          sm['other']||0, sm['yxs']||0, sm['ys']||0, sm['ym']||0, sm['yl']||0, sm['yxl']||0,
          sm['xs']||0, sm['s']||0, sm['m']||0, sm['l']||0, sm['xl']||0,
          sm['2xl']||sm['xxl']||0, sm['3xl']||0, sm['4xl']||0, sm['5xl']||0, sm['6xl']||0
        ].map(escCsv).join(','));
      }
    }
  }
  fs.writeFileSync('line_items.csv', rows.join('\n'));
  console.log(`Saved line_items.csv (${liTotal} line items)`);

  // INVOICE SUMMARY CSV
  const ih = ['invoice_id','visual_id','nickname','total','subtotal','total_untaxed',
    'total_quantity','amount_paid','amount_outstanding','sales_tax_amount','discount_amount',
    'paid_in_full','created_at','due_at','invoice_at','start_at','status','tags',
    'customer_name','customer_email','owner_email','production_note','delivery_method','merch',
    'line_item_count','group_count','fee_count','total_fees','ship_city','ship_state'];
  const ir = [ih.join(',')];
  for (const inv of all) {
    const gs = inv.lineItemGroups?.nodes || [];
    let lic = 0; for (const g of gs) lic += (g.lineItems?.nodes||[]).length;
    const fees = inv.fees?.nodes || [];
    ir.push([
      inv.id, inv.visualId, inv.nickname, inv.total, inv.subtotal, inv.totalUntaxed,
      inv.totalQuantity, inv.amountPaid, inv.amountOutstanding,
      inv.salesTaxAmount, inv.discountAmount, inv.paidInFull,
      inv.createdAt, inv.dueAt, inv.invoiceAt, inv.startAt,
      inv.status?.name, (inv.tags||[]).join('; '), inv.contact?.fullName, inv.contact?.email,
      inv.owner?.email, inv.productionNote, inv.deliveryMethod?.name, inv.merch,
      lic, gs.length, fees.length, fees.reduce((s,f)=>s+(f.amount||0),0),
      inv.shippingAddress?.city, inv.shippingAddress?.state
    ].map(escCsv).join(','));
  }
  fs.writeFileSync('invoices_summary.csv', ir.join('\n'));
  console.log(`Saved invoices_summary.csv (${all.length} invoices)`);

  if (errors.length) {
    fs.writeFileSync('pull_errors.json', JSON.stringify(errors, null, 2));
    console.log(`${errors.length} errors saved to pull_errors.json`);
  }
  console.log(`\n=== COMPLETE: ${all.length} invoices, ${liTotal} line items ===`);
  console.log('Run:');
  console.log('  podman cp printavo-mcp-server:/app/line_items.csv ./line_items.csv');
  console.log('  podman cp printavo-mcp-server:/app/invoices_summary.csv ./invoices_summary.csv');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });

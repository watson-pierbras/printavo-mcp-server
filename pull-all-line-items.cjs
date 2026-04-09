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

// Use a fragment string to avoid duplication
const FIELDS = `
  id visualId nickname total totalQuantity amountPaid
  createdAt dueAt paidInFull productionNote tags
  status { id name } contact { id fullName email } owner { id email }
  lineItemGroups { nodes { id
    lineItems { nodes {
      id description color itemNumber items price
      category { id name }
      product { id description itemNumber brand color }
      sizes { size count }
    } }
  } }
  fees { nodes { id description amount } }
`;

const QUERY = `query($first: Int, $after: String, $inProductionAfter: ISO8601DateTime, $inProductionBefore: ISO8601DateTime) {
  orders(first: $first, after: $after, inProductionAfter: $inProductionAfter, inProductionBefore: $inProductionBefore, sortOn: VISUAL_ID) {
    nodes {
      __typename
      ... on Quote { ${FIELDS} }
      ... on Invoice { ${FIELDS} }
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

  // --- RESUME SUPPORT ---
  // Load previously saved progress if it exists
  const PROGRESS_FILE = 'pull_progress.json';
  let all = [];
  let completedMonths = new Set();
  let errors = [];

  if (fs.existsSync(PROGRESS_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
      all = saved.invoices || [];
      completedMonths = new Set(saved.completedMonths || []);
      errors = saved.errors || [];
      console.log(`Resuming: ${all.length} invoices already pulled from ${completedMonths.size} months (${[...completedMonths].join(', ')})`);
      console.log(`Skipping completed months...\n`);
    } catch (e) {
      console.log('Could not read progress file, starting fresh.\n');
    }
  }

  // Save progress after each completed month
  function saveProgress() {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
      invoices: all,
      completedMonths: [...completedMonths],
      errors,
      savedAt: new Date().toISOString(),
    }));
  }

  const t0 = Date.now();
  let pages = 0;

  for (const [name, start, end] of periods) {
    if (completedMonths.has(name)) {
      console.log(`${name}: SKIPPED (already pulled)`);
      continue;
    }
    let cursor = null, count = 0;
    while (true) {
      const vars = { first: 1, inProductionAfter: start, inProductionBefore: end };
      if (cursor) vars.after = cursor;
      let ok = false;
      for (let retry = 0; retry < 10 && !ok; retry++) {
        try {
          const data = await apiCall(QUERY, vars);
          const nodes = data.orders?.nodes || [];
          const pi = data.orders?.pageInfo || {};
          for (const n of nodes) { if (n?.id) { all.push(n); count++; } }
          cursor = pi.hasNextPage ? pi.endCursor : null;
          ok = true; pages++;
        } catch (e) {
          const isRateLimit = e.message.includes('403') || e.message.includes('429') || e.message.includes('Incapsula') || e.message.includes('rate');
          if (isRateLimit) {
            const waitSec = 30 * (retry + 1); // 30s, 60s, 90s, ... up to 300s
            console.log(`  ⏳ Rate limited (attempt ${retry + 1}/10). Waiting ${waitSec}s...`);
            await sleep(waitSec * 1000);
          } else if (retry < 9) {
            console.log(`  ⚠️ Error (attempt ${retry + 1}/10): ${e.message.slice(0, 100)}. Retrying in 5s...`);
            await sleep(5000);
          } else {
            errors.push({ period: name, cursor, error: e.message });
            console.log(`  ❌ Failed after 10 attempts: ${e.message.slice(0, 100)}. Skipping to next month.`);
            cursor = null;
          }
        }
      }
      if (!cursor) break;
      await sleep(800); // slightly slower to avoid triggering WAF
      if (pages % 50 === 0) {
        const elapsed = (Date.now() - t0) / 1000;
        console.log(`  ...${all.length} invoices, ${pages} pages, ${Math.round(elapsed)}s`);
      }
    }
    completedMonths.add(name);
    saveProgress();
    console.log(`${name}: ${count} invoices (total: ${all.length}, ${Math.round((Date.now()-t0)/1000)}s) [saved]`);
  }

  console.log(`\nDone: ${all.length} invoices in ${Math.round((Date.now()-t0)/1000)}s (${errors.length} errors)\n`);

  fs.writeFileSync('raw_data.json', JSON.stringify(all, null, 2));
  console.log('Saved raw_data.json');

  // LINE ITEMS CSV
  const hdr = [
    'type','invoice_id','visual_id','nickname','invoice_total','invoice_qty','invoice_paid_full',
    'invoice_created','invoice_due','invoice_status','invoice_tags',
    'customer_name','customer_email','owner_email','production_note',
    'group_id',
    'line_item_id','item_number','description','color','quantity','price_each','line_total',
    'category_name',
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
      for (const li of (g.lineItems?.nodes || [])) {
        liTotal++;
        const sm = {};
        for (const s of (li.sizes || [])) sm[(s.size||'').toLowerCase()] = s.count || 0;
        const prod = li.product || {};
        rows.push([
          inv.__typename, inv.id, inv.visualId, inv.nickname, inv.total, inv.totalQuantity, inv.paidInFull,
          inv.createdAt, inv.dueAt, inv.status?.name, tags,
          inv.contact?.fullName, inv.contact?.email, inv.owner?.email, inv.productionNote,
          g.id,
          li.id, li.itemNumber, li.description, li.color, li.items, li.price,
          (li.items||0)*(li.price||0), li.category?.name,
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
  const ih = ['type','invoice_id','visual_id','nickname','total',
    'total_quantity','amount_paid','paid_in_full',
    'created_at','due_at','status','tags',
    'customer_name','customer_email','owner_email','production_note',
    'line_item_count','group_count','fee_count','total_fees'];
  const ir = [ih.join(',')];
  for (const inv of all) {
    const gs = inv.lineItemGroups?.nodes || [];
    let lic = 0; for (const g of gs) lic += (g.lineItems?.nodes||[]).length;
    const fees = inv.fees?.nodes || [];
    ir.push([
      inv.__typename, inv.id, inv.visualId, inv.nickname, inv.total,
      inv.totalQuantity, inv.amountPaid, inv.paidInFull,
      inv.createdAt, inv.dueAt,
      inv.status?.name, (inv.tags||[]).join('; '), inv.contact?.fullName, inv.contact?.email,
      inv.owner?.email, inv.productionNote,
      lic, gs.length, fees.length, fees.reduce((s,f)=>s+(f.amount||0),0)
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

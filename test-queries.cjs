#!/usr/bin/env node
/**
 * Diagnostic: test Printavo queries at increasing complexity
 * to find what works and what breaks.
 */
const https = require('https');
const EMAIL = process.env.PRINTAVO_EMAIL;
const TOKEN = process.env.PRINTAVO_API_TOKEN;

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
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data.slice(0, 500) }); }
      });
    });
    req.on('error', e => reject(e));
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function test(label, query, variables) {
  process.stdout.write(`TEST: ${label}... `);
  try {
    const res = await apiCall(query, variables);
    if (res.body.errors) {
      console.log(`FAIL — ${res.body.errors[0].message}`);
      return false;
    }
    const orders = res.body.data?.orders;
    if (orders) {
      const count = orders.nodes?.length || 0;
      const hasNext = orders.pageInfo?.hasNextPage;
      const sample = orders.nodes?.[0];
      console.log(`OK — ${count} results, hasNext=${hasNext}`);
      if (sample) {
        console.log(`  Sample: #${sample.visualId} "${sample.nickname}" $${sample.total} qty=${sample.totalQuantity}`);
        const groups = sample.lineItemGroups?.nodes;
        if (groups) {
          let liCount = 0;
          for (const g of groups) liCount += (g.lineItems?.nodes || []).length;
          console.log(`  Line item groups: ${groups.length}, Line items: ${liCount}`);
          const firstLi = groups[0]?.lineItems?.nodes?.[0];
          if (firstLi) {
            console.log(`  First LI: "${firstLi.description}" color=${firstLi.color} qty=${firstLi.items} $${firstLi.price} cat=${firstLi.category?.name || 'null'} prod=${firstLi.product?.name || 'null'}`);
            if (firstLi.sizes) {
              const nonzero = firstLi.sizes.filter(s => s.count > 0).map(s => `${s.size}:${s.count}`);
              console.log(`  Sizes: ${nonzero.join(', ') || '(all zero)'}`);
            }
          }
          const firstImprints = groups[0]?.imprints?.nodes;
          if (firstImprints) {
            console.log(`  Imprints: ${JSON.stringify(firstImprints).slice(0, 200)}`);
          }
        }
      }
      return true;
    }
    console.log(`OK — response: ${JSON.stringify(res.body).slice(0, 200)}`);
    return true;
  } catch (e) {
    console.log(`ERROR — ${e.message}`);
    return false;
  }
}

const vars = { first: 1, inProductionAfter: '2025-10-01', inProductionBefore: '2025-10-31' };

async function main() {
  console.log('=== PRINTAVO API DIAGNOSTIC ===\n');
  console.log(`Email: ${EMAIL}`);
  console.log(`Token: ${TOKEN ? TOKEN.slice(0,4) + '...' : 'MISSING'}\n`);

  // Test 1: Minimal query
  await test('Minimal (no line items)', `query($first: Int, $inProductionAfter: ISO8601DateTime, $inProductionBefore: ISO8601DateTime) {
    orders(first: $first, inProductionAfter: $inProductionAfter, inProductionBefore: $inProductionBefore, sortOn: VISUAL_ID) {
      nodes { ... on Invoice { id visualId nickname total totalQuantity tags status { name } contact { fullName } } }
      pageInfo { hasNextPage endCursor }
    }
  }`, vars);
  await sleep(700);

  // Test 2: Add line item groups + line items (no sizes, no category)
  await test('+ Line items (basic)', `query($first: Int, $inProductionAfter: ISO8601DateTime, $inProductionBefore: ISO8601DateTime) {
    orders(first: $first, inProductionAfter: $inProductionAfter, inProductionBefore: $inProductionBefore, sortOn: VISUAL_ID) {
      nodes { ... on Invoice { id visualId nickname total totalQuantity
        lineItemGroups { nodes { id lineItems { nodes { id description color itemNumber items price } } } }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }`, vars);
  await sleep(700);

  // Test 3: Add category and product
  await test('+ Category & Product', `query($first: Int, $inProductionAfter: ISO8601DateTime, $inProductionBefore: ISO8601DateTime) {
    orders(first: $first, inProductionAfter: $inProductionAfter, inProductionBefore: $inProductionBefore, sortOn: VISUAL_ID) {
      nodes { ... on Invoice { id visualId nickname total totalQuantity
        lineItemGroups { nodes { id lineItems { nodes { id description color itemNumber items price category { name } product { name } } } } }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }`, vars);
  await sleep(700);

  // Test 4: Add sizes
  await test('+ Sizes', `query($first: Int, $inProductionAfter: ISO8601DateTime, $inProductionBefore: ISO8601DateTime) {
    orders(first: $first, inProductionAfter: $inProductionAfter, inProductionBefore: $inProductionBefore, sortOn: VISUAL_ID) {
      nodes { ... on Invoice { id visualId nickname total totalQuantity
        lineItemGroups { nodes { id lineItems { nodes { id description color itemNumber items price category { name } product { name } sizes { size count } } } } }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }`, vars);
  await sleep(700);

  // Test 5: Add imprints (just id)
  await test('+ Imprints (id only)', `query($first: Int, $inProductionAfter: ISO8601DateTime, $inProductionBefore: ISO8601DateTime) {
    orders(first: $first, inProductionAfter: $inProductionAfter, inProductionBefore: $inProductionBefore, sortOn: VISUAL_ID) {
      nodes { ... on Invoice { id visualId nickname total totalQuantity
        lineItemGroups { nodes { id imprints { nodes { id } } lineItems { nodes { id description color itemNumber items price category { name } product { name } sizes { size count } } } } }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }`, vars);
  await sleep(700);

  // Test 6: Full query with all invoice fields + line items + sizes (first:3)
  await test('Full query (first:3)', `query($first: Int, $inProductionAfter: ISO8601DateTime, $inProductionBefore: ISO8601DateTime) {
    orders(first: $first, inProductionAfter: $inProductionAfter, inProductionBefore: $inProductionBefore, sortOn: VISUAL_ID) {
      nodes { ... on Invoice {
        id visualId nickname total subtotal totalUntaxed totalQuantity amountPaid amountOutstanding
        createdAt dueAt invoiceAt startAt paidInFull productionNote tags
        status { id name } contact { id fullName email } owner { id email }
        lineItemGroups { nodes { id position
          imprints { nodes { id } }
          lineItems { nodes { id description color itemNumber items price position taxed markupPercentage
            category { id name } product { id name } productStatus { id name }
            sizes { size count }
          } }
        } }
        fees { nodes { id description amount taxed } }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }`, { first: 3, inProductionAfter: '2025-10-01', inProductionBefore: '2025-10-31' });
  await sleep(700);

  // Test 7: Same full query but first:1
  await test('Full query (first:1)', `query($first: Int, $inProductionAfter: ISO8601DateTime, $inProductionBefore: ISO8601DateTime) {
    orders(first: $first, inProductionAfter: $inProductionAfter, inProductionBefore: $inProductionBefore, sortOn: VISUAL_ID) {
      nodes { ... on Invoice {
        id visualId nickname total subtotal totalUntaxed totalQuantity amountPaid amountOutstanding
        createdAt dueAt invoiceAt startAt paidInFull productionNote tags
        status { id name } contact { id fullName email } owner { id email }
        lineItemGroups { nodes { id position
          imprints { nodes { id } }
          lineItems { nodes { id description color itemNumber items price position taxed markupPercentage
            category { id name } product { id name } productStatus { id name }
            sizes { size count }
          } }
        } }
        fees { nodes { id description amount taxed } }
      } }
      pageInfo { hasNextPage endCursor }
    }
  }`, { first: 1, inProductionAfter: '2025-10-01', inProductionBefore: '2025-10-31' });

  console.log('\n=== DONE ===');
}

main().catch(e => console.error('Fatal:', e));

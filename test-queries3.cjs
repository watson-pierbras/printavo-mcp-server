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
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve({raw: data.slice(0,500), status: res.statusCode}); } });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body); req.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function test(label, query) {
  process.stdout.write(`${label}... `);
  try {
    const res = await apiCall(query, { first: 1, inProductionAfter: '2025-10-01', inProductionBefore: '2025-10-31' });
    if (res.errors) { console.log(`FAIL: ${res.errors[0].message}`); return false; }
    const nodes = res.data?.orders?.nodes || [];
    if (nodes.length > 0 && nodes[0]?.id) {
      console.log(`OK (id=${nodes[0].visualId}, $${nodes[0].total}, qty=${nodes[0].totalQuantity})`);
      return true;
    }
    console.log(`OK but empty node: ${JSON.stringify(nodes[0]).slice(0,200)}`);
    return true;
  } catch(e) { console.log(`ERROR: ${e.message}`); return false; }
}

async function main() {
  console.log('Testing Quote fields one by one...\n');
  const v = '$first: Int, $inProductionAfter: ISO8601DateTime, $inProductionBefore: ISO8601DateTime';
  const a = 'first: $first, inProductionAfter: $inProductionAfter, inProductionBefore: $inProductionBefore';

  // Base that works
  await test('1. Base fields', `query(${v}) { orders(${a}) { nodes { ... on Quote { id visualId nickname total totalQuantity } } pageInfo { hasNextPage endCursor } } }`);
  await sleep(600);

  await test('2. + dates', `query(${v}) { orders(${a}) { nodes { ... on Quote { id visualId nickname total totalQuantity createdAt dueAt invoiceAt startAt } } pageInfo { hasNextPage endCursor } } }`);
  await sleep(600);

  await test('3. + payment', `query(${v}) { orders(${a}) { nodes { ... on Quote { id visualId nickname total totalQuantity createdAt dueAt paidInFull amountPaid amountOutstanding } } pageInfo { hasNextPage endCursor } } }`);
  await sleep(600);

  await test('4. + tags/notes', `query(${v}) { orders(${a}) { nodes { ... on Quote { id visualId nickname total totalQuantity createdAt dueAt paidInFull tags productionNote } } pageInfo { hasNextPage endCursor } } }`);
  await sleep(600);

  await test('5. + status', `query(${v}) { orders(${a}) { nodes { ... on Quote { id visualId nickname total totalQuantity tags status { id name } } } pageInfo { hasNextPage endCursor } } }`);
  await sleep(600);

  await test('6. + contact', `query(${v}) { orders(${a}) { nodes { ... on Quote { id visualId nickname total totalQuantity tags status { id name } contact { id fullName email } } } pageInfo { hasNextPage endCursor } } }`);
  await sleep(600);

  await test('7. + owner', `query(${v}) { orders(${a}) { nodes { ... on Quote { id visualId nickname total totalQuantity tags status { id name } contact { id fullName } owner { id email } } } pageInfo { hasNextPage endCursor } } }`);
  await sleep(600);

  await test('8. + lineItemGroups (empty)', `query(${v}) { orders(${a}) { nodes { ... on Quote { id visualId total totalQuantity lineItemGroups { nodes { id } } } } pageInfo { hasNextPage endCursor } } }`);
  await sleep(600);

  await test('9. + lineItems basic', `query(${v}) { orders(${a}) { nodes { ... on Quote { id visualId total totalQuantity lineItemGroups { nodes { id lineItems { nodes { id description items price } } } } } } pageInfo { hasNextPage endCursor } } }`);
  await sleep(600);

  await test('10. + LI color/itemNumber', `query(${v}) { orders(${a}) { nodes { ... on Quote { id visualId total totalQuantity lineItemGroups { nodes { id lineItems { nodes { id description color itemNumber items price } } } } } } pageInfo { hasNextPage endCursor } } }`);
  await sleep(600);

  await test('11. + category', `query(${v}) { orders(${a}) { nodes { ... on Quote { id visualId total totalQuantity lineItemGroups { nodes { id lineItems { nodes { id description items price category { id name } } } } } } } pageInfo { hasNextPage endCursor } } }`);
  await sleep(600);

  await test('12. + product (id only)', `query(${v}) { orders(${a}) { nodes { ... on Quote { id visualId total totalQuantity lineItemGroups { nodes { id lineItems { nodes { id description items price category { id name } product { id } } } } } } } pageInfo { hasNextPage endCursor } } }`);
  await sleep(600);

  await test('13. + product fields', `query(${v}) { orders(${a}) { nodes { ... on Quote { id visualId total totalQuantity lineItemGroups { nodes { id lineItems { nodes { id description items price category { id name } product { id description itemNumber brand color } } } } } } } pageInfo { hasNextPage endCursor } } }`);
  await sleep(600);

  await test('14. + sizes', `query(${v}) { orders(${a}) { nodes { ... on Quote { id visualId total totalQuantity lineItemGroups { nodes { id lineItems { nodes { id description items price sizes { size count } } } } } } } pageInfo { hasNextPage endCursor } } }`);
  await sleep(600);

  await test('15. + imprints (id)', `query(${v}) { orders(${a}) { nodes { ... on Quote { id visualId total totalQuantity lineItemGroups { nodes { id imprints { nodes { id } } lineItems { nodes { id items price } } } } } } pageInfo { hasNextPage endCursor } } }`);
  await sleep(600);

  await test('16. + imprint typeOfWork', `query(${v}) { orders(${a}) { nodes { ... on Quote { id visualId total totalQuantity lineItemGroups { nodes { id imprints { nodes { id typeOfWork { id name } } } lineItems { nodes { id items price } } } } } } pageInfo { hasNextPage endCursor } } }`);
  await sleep(600);

  await test('17. + fees', `query(${v}) { orders(${a}) { nodes { ... on Quote { id visualId total totalQuantity fees { nodes { id description amount } } } } pageInfo { hasNextPage endCursor } } }`);
  await sleep(600);

  await test('18. + deliveryMethod', `query(${v}) { orders(${a}) { nodes { ... on Quote { id visualId total totalQuantity deliveryMethod { id name } } } pageInfo { hasNextPage endCursor } } }`);
  await sleep(600);

  // Now combine all working fields
  await test('19. FULL COMBO (first:1)', `query(${v}) { orders(${a}) { nodes { ... on Quote {
    id visualId nickname total subtotal totalUntaxed totalQuantity amountPaid amountOutstanding
    createdAt dueAt invoiceAt startAt paidInFull productionNote tags
    status { id name } contact { id fullName email } owner { id email }
    deliveryMethod { id name }
    shippingAddress { city state zipCode }
    lineItemGroups { nodes { id position
      imprints { nodes { id typeOfWork { id name } } }
      lineItems { nodes { id description color itemNumber items price position taxed markupPercentage
        category { id name } product { id description itemNumber brand color }
        sizes { size count }
      } }
    } }
    fees { nodes { id description amount taxed } }
  } } pageInfo { hasNextPage endCursor } } }`);

  console.log('\nDONE');
}
main().catch(e => console.error(e));

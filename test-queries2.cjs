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
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve({ raw: data.slice(0,500) }); } });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body); req.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const vars = { first: 1, inProductionAfter: '2025-10-01', inProductionBefore: '2025-10-31' };

  // Test A: Raw node without type fragment — see what __typename is
  console.log('=== TEST A: Raw node with __typename ===');
  let res = await apiCall(`query($first: Int, $inProductionAfter: ISO8601DateTime, $inProductionBefore: ISO8601DateTime) {
    orders(first: $first, inProductionAfter: $inProductionAfter, inProductionBefore: $inProductionBefore) {
      nodes { __typename ... on Invoice { id visualId nickname total totalQuantity } ... on Quote { id visualId nickname total totalQuantity } }
    }
  }`, vars);
  console.log(JSON.stringify(res.data?.orders?.nodes?.[0], null, 2));
  await sleep(700);

  // Test B: Introspect Product type
  console.log('\n=== TEST B: Product type fields ===');
  res = await apiCall(`{ __type(name: "Product") { fields { name type { name kind ofType { name } } } } }`, {});
  const productFields = res.data?.__type?.fields || [];
  for (const f of productFields) {
    const t = f.type.name || f.type.ofType?.name || f.type.kind;
    console.log(`  ${f.name}: ${t}`);
  }
  await sleep(700);

  // Test C: Introspect Category type
  console.log('\n=== TEST C: Category type fields ===');
  res = await apiCall(`{ __type(name: "Category") { fields { name type { name kind ofType { name } } } } }`, {});
  const catFields = res.data?.__type?.fields || [];
  for (const f of catFields) {
    const t = f.type.name || f.type.ofType?.name || f.type.kind;
    console.log(`  ${f.name}: ${t}`);
  }
  await sleep(700);

  // Test D: Introspect Imprint type
  console.log('\n=== TEST D: Imprint type fields ===');
  res = await apiCall(`{ __type(name: "Imprint") { fields { name type { name kind ofType { name } } } } }`, {});
  const impFields = res.data?.__type?.fields || [];
  for (const f of impFields) {
    const t = f.type.name || f.type.ofType?.name || f.type.kind;
    console.log(`  ${f.name}: ${t}`);
  }
  await sleep(700);

  // Test E: Introspect ProductStatus type
  console.log('\n=== TEST E: ProductStatus type fields ===');
  res = await apiCall(`{ __type(name: "ProductStatus") { fields { name type { name kind ofType { name } } } } }`, {});
  const psFields = res.data?.__type?.fields || [];
  for (const f of psFields) {
    const t = f.type.name || f.type.ofType?.name || f.type.kind;
    console.log(`  ${f.name}: ${t}`);
  }
  await sleep(700);

  // Test F: Now try with correct field names from introspection
  console.log('\n=== TEST F: Line items with introspected fields ===');
  // Build query using only id fields for product/category to be safe
  res = await apiCall(`query($first: Int, $inProductionAfter: ISO8601DateTime, $inProductionBefore: ISO8601DateTime) {
    orders(first: $first, inProductionAfter: $inProductionAfter, inProductionBefore: $inProductionBefore) {
      nodes {
        ... on Invoice {
          id visualId nickname total totalQuantity createdAt dueAt paidInFull tags
          status { id name } contact { id fullName } owner { id email }
          lineItemGroups { nodes { id
            lineItems { nodes {
              id description color itemNumber items price
              category { id }
              sizes { size count }
            } }
          } }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`, vars);
  if (res.errors) {
    console.log('FAIL:', res.errors[0].message);
  } else {
    const node = res.data?.orders?.nodes?.[0];
    console.log('OK - Invoice:', JSON.stringify(node, null, 2).slice(0, 1500));
  }

  console.log('\n=== DONE ===');
}

main().catch(e => console.error(e));

/**
 * Printavo GraphQL API client with built-in rate limiting and retry logic.
 * READ-ONLY — no mutations are supported.
 *
 * Rate limit: 10 req / 5s. We target ≤8 req / 5s for safety headroom.
 */

const PRINTAVO_ENDPOINT = 'https://www.printavo.com/api/v2';

// Rate limiter state: sliding window of timestamps
const requestTimestamps = [];
const RATE_WINDOW_MS = 5000;   // 5 seconds
const MAX_REQUESTS_PER_WINDOW = 8; // leave 2 requests of headroom

/**
 * Wait until we can safely make another request without exceeding the rate limit.
 */
async function waitForRateLimit() {
  const now = Date.now();
  // Purge timestamps outside the window
  while (requestTimestamps.length > 0 && requestTimestamps[0] <= now - RATE_WINDOW_MS) {
    requestTimestamps.shift();
  }

  if (requestTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    // Wait until the oldest timestamp expires from the window
    const waitUntil = requestTimestamps[0] + RATE_WINDOW_MS + 10; // +10ms buffer
    const waitMs = waitUntil - Date.now();
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    // Re-purge after waiting
    while (requestTimestamps.length > 0 && requestTimestamps[0] <= Date.now() - RATE_WINDOW_MS) {
      requestTimestamps.shift();
    }
  }

  requestTimestamps.push(Date.now());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a GraphQL query against the Printavo API.
 * Retries on 429 with exponential backoff.
 *
 * @param {string} query - GraphQL query string
 * @param {object} variables - Query variables
 * @param {number} [attempt=1] - Current attempt number (for retry logic)
 * @returns {Promise<object>} - The `data` field from the GraphQL response
 */
export async function executeQuery(query, variables = {}, attempt = 1) {
  const email = process.env.PRINTAVO_EMAIL;
  const token = process.env.PRINTAVO_API_TOKEN;

  if (!email || !token) {
    throw new Error(
      'Printavo credentials not configured. Set PRINTAVO_EMAIL and PRINTAVO_API_TOKEN environment variables.'
    );
  }

  await waitForRateLimit();

  let response;
  try {
    response = await fetch(PRINTAVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'email': email,
        'token': token,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (networkError) {
    throw new Error(`Network error connecting to Printavo API: ${networkError.message}`);
  }

  // Handle rate limiting with exponential backoff
  if (response.status === 429) {
    if (attempt > 4) {
      throw new Error('Printavo API rate limit exceeded after multiple retries. Please try again later.');
    }
    const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
    console.warn(`Rate limited by Printavo API (attempt ${attempt}). Retrying in ${backoffMs}ms...`);
    await sleep(backoffMs);
    return executeQuery(query, variables, attempt + 1);
  }

  // Handle other HTTP errors
  if (!response.ok) {
    let body = '';
    try { body = await response.text(); } catch (_) {}
    throw new Error(`Printavo API HTTP error ${response.status}: ${body.slice(0, 200)}`);
  }

  let json;
  try {
    json = await response.json();
  } catch (parseError) {
    throw new Error(`Failed to parse Printavo API response: ${parseError.message}`);
  }

  // GraphQL errors
  if (json.errors && json.errors.length > 0) {
    const messages = json.errors.map((e) => e.message).join('; ');
    throw new Error(`Printavo GraphQL error: ${messages}`);
  }

  if (!json.data) {
    throw new Error('Printavo API returned an empty response with no data.');
  }

  return json.data;
}

/**
 * Paginate through all results of a query, fetching up to `maxPages` pages.
 * Adds a 500ms delay between pages to respect rate limits.
 *
 * @param {string} query - GraphQL query string (must accept $after cursor)
 * @param {object} baseVariables - Base variables (excluding `after`)
 * @param {string} collectionPath - Dot-separated path to the collection in the response
 *   e.g. "orders" to access data.orders.nodes and data.orders.pageInfo
 * @param {number} [maxPages=50] - Safety limit on number of pages
 * @returns {Promise<Array>} - All nodes collected across all pages
 */
export async function paginateQuery(query, baseVariables, collectionPath, maxPages = 50) {
  const allNodes = [];
  let cursor = null;
  let pageCount = 0;

  while (pageCount < maxPages) {
    const variables = { ...baseVariables, after: cursor };
    const data = await executeQuery(query, variables);

    // Navigate the dot-separated path
    const collection = collectionPath.split('.').reduce((obj, key) => obj?.[key], data);
    if (!collection) {
      throw new Error(`Could not find collection at path "${collectionPath}" in response`);
    }

    const nodes = collection.nodes || [];
    allNodes.push(...nodes);

    pageCount++;

    if (!collection.pageInfo?.hasNextPage) break;
    cursor = collection.pageInfo.endCursor;

    // Delay between pages to respect rate limits
    if (pageCount < maxPages) {
      await sleep(500);
    }
  }

  return allNodes;
}

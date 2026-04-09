# Printavo MCP Server

A **read-only** [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that wraps Printavo's GraphQL API v2. Designed for use as a Perplexity custom remote connector, enabling AI-powered queries against your Printavo print shop data.

> **Read-only by design.** This server makes zero GraphQL mutations. It only reads data from Printavo.

---

## Features

- 8 read-only tools covering invoices, customers, statuses, and analytics
- Streamable HTTP transport (`/mcp`) in stateless mode — works perfectly with Perplexity
- Bearer token authentication on the MCP endpoint
- Built-in Printavo API rate limiting (≤8 req/5s with automatic retry on 429)
- Formatted, human-readable text responses optimized for LLM consumption
- Docker-ready with health checks

---

## Available Tools

| Tool | Description |
|------|-------------|
| `search_invoices` | Search orders by date range, status, payment status, or free-text query |
| `get_invoice_detail` | Full invoice detail with all line items, sizes, and pricing |
| `search_customers` | List/search customers with order history and total spend |
| `get_customer_detail` | Detailed info for a specific customer |
| `list_statuses` | List all order statuses with IDs and colors |
| `get_order_stats` | Aggregate revenue, piece count, and per-status breakdown for a date range |
| `get_production_schedule` | Orders in production for a date range, sorted by due date |
| `get_account_info` | Account name, contact info, address, and all statuses |

---

## Setup

### Prerequisites

- Node.js 18+ (or Docker)
- A Printavo account with API access
- Your Printavo API token (found at **My Account → API** in Printavo)

### 1. Clone and install

```bash
git clone <your-repo>
cd printavo-mcp-server
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
PRINTAVO_EMAIL=you@yourbusiness.com
PRINTAVO_API_TOKEN=your_printavo_api_token
MCP_API_KEY=generate_a_strong_random_secret
PORT=3000
```

**Generating a secure `MCP_API_KEY`:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Start the server

```bash
npm start
# or for development with auto-reload:
npm run dev
```

The server starts on port 3000 by default. Visit `http://localhost:3000` for a health check.

---

## Deployment

### Docker

```bash
# Build image
docker build -t printavo-mcp .

# Run container
docker run -d \
  -p 3000:3000 \
  -e PRINTAVO_EMAIL=you@example.com \
  -e PRINTAVO_API_TOKEN=your_token \
  -e MCP_API_KEY=your_secret \
  --name printavo-mcp \
  printavo-mcp
```

### Railway

1. Push your code to a GitHub repo (make sure `.env` is in `.gitignore` — it is by default)
2. Create a new Railway project → **Deploy from GitHub repo**
3. Add environment variables in Railway's Variables panel:
   - `PRINTAVO_EMAIL`
   - `PRINTAVO_API_TOKEN`
   - `MCP_API_KEY`
4. Railway auto-detects the Dockerfile and deploys
5. Your public URL will be something like `https://printavo-mcp-production.up.railway.app`

### Render

1. Create a new **Web Service** on Render
2. Connect your GitHub repo
3. Set **Environment** to `Docker`
4. Add the three environment variables in the Render dashboard
5. Set the health check path to `/`
6. Deploy — your URL will be `https://printavo-mcp.onrender.com`

> **Note:** Render free-tier services spin down after inactivity. Use a paid plan or Railway for production use to avoid cold starts.

### Fly.io

```bash
fly launch --name printavo-mcp
fly secrets set PRINTAVO_EMAIL=you@example.com PRINTAVO_API_TOKEN=your_token MCP_API_KEY=your_secret
fly deploy
```

---

## Adding to Perplexity as a Custom Connector

1. Go to **Perplexity → Settings → Connectors → Add custom connector**
2. Fill in the form:
   - **Name**: Printavo
   - **URL**: `https://your-deployment-url.com/mcp`
   - **Authentication**: API Key
   - **API Key**: your `MCP_API_KEY` value
3. Save and test — Perplexity will send `Authorization: Bearer <your-key>` on every request

Once connected, you can ask Perplexity questions like:
- *"Show me all unpaid invoices from last month"*
- *"What are my top 10 customers by total spend?"*
- *"Summarize revenue for Q1 2025"*
- *"What orders are due in the next 7 days?"*

---

## API Reference

### MCP Endpoint

```
POST https://your-host/mcp
Authorization: Bearer <MCP_API_KEY>
Content-Type: application/json
Accept: application/json, text/event-stream
```

### Health Check

```
GET https://your-host/
```

Returns JSON with server info, tool list, and status.

---

## Tool Details

### `search_invoices`

Search orders with optional filters.

| Parameter | Type | Description |
|-----------|------|-------------|
| `start_date` | string | ISO date — production start on or after |
| `end_date` | string | ISO date — production due on or before |
| `status_ids` | string[] | Filter by status IDs (use `list_statuses` for IDs) |
| `payment_status` | string | `PAID`, `UNPAID`, or `PARTIAL` |
| `query` | string | Free-text search |
| `sort_by` | string | `VISUAL_ID`, `CREATED_AT`, `DUE_DATE`, `TOTAL` |
| `sort_desc` | boolean | Sort descending (default: true) |
| `limit` | number | 1–100, default 25 |
| `after` | string | Pagination cursor |

### `get_invoice_detail`

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | **Required.** Invoice ID |

### `search_customers`

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Client-side filter by name/company/email |
| `limit` | number | 1–100, default 25 |
| `after` | string | Pagination cursor |

### `get_customer_detail`

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | **Required.** Customer ID |

### `get_order_stats`

| Parameter | Type | Description |
|-----------|------|-------------|
| `start_date` | string | **Required.** ISO date |
| `end_date` | string | **Required.** ISO date |
| `status_ids` | string[] | Optional status filter |

### `get_production_schedule`

| Parameter | Type | Description |
|-----------|------|-------------|
| `start_date` | string | ISO date (default: today) |
| `end_date` | string | ISO date (default: today + 14 days) |
| `exclude_status_ids` | string[] | Status IDs to exclude |

### `list_statuses` and `get_account_info`

No parameters required.

---

## Security

- **Read-only**: Zero GraphQL mutations. Cannot create, update, or delete any Printavo data.
- **Bearer token auth**: Every request to `/mcp` requires `Authorization: Bearer <MCP_API_KEY>`. Requests without a valid key receive HTTP 401.
- **Credentials in environment**: Printavo API credentials never appear in code or responses.
- **Non-root Docker user**: The container runs as a non-root user.
- **Rate limiting**: Built-in client-side rate limiting (≤8 req/5s) prevents API abuse.

---

## Architecture

```
Perplexity → POST /mcp (Bearer auth) → Express
                                          ↓
                               McpServer (stateless)
                                          ↓
                              handleToolCall(name, args)
                                          ↓
                           Printavo GraphQL API (rate-limited)
```

Each MCP request creates a fresh `McpServer` + `StreamableHTTPServerTransport` instance and discards it after the response. This stateless approach is compatible with horizontal scaling and serverless deployments.

---

## License

MIT

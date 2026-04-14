/**
 * Printavo MCP Server — Express + Streamable HTTP transport
 *
 * Architecture: Stateless mode — a new Server + transport is created per request.
 * This is suitable for horizontal scaling and Perplexity's remote connector.
 *
 * Uses the low-level Server API so tool inputSchema can be defined as plain JSON Schema
 * objects (no Zod dependency required).
 *
 * Supports read queries and line item mutations (add, update, update sizes).
 */

import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { toolDefinitions, handleToolCall } from './tools.js';

// ---------------------------------------------------------------------------
// Environment variable validation
// ---------------------------------------------------------------------------

const REQUIRED_ENV = ['PRINTAVO_EMAIL', 'PRINTAVO_API_TOKEN', 'MCP_API_KEY'];

function validateEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`ERROR: Missing required environment variables: ${missing.join(', ')}`);
    console.error('Copy .env.example to .env and fill in your credentials.');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// MCP Server factory
// Stateless mode: create a fresh server for every request to avoid collisions.
// ---------------------------------------------------------------------------

function createMcpServer() {
  const server = new Server(
    { name: 'printavo-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  // Handle tools/list — return all tool definitions
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: toolDefinitions.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: {
          type: 'object',
          properties: t.inputSchema.properties || {},
          ...(t.inputSchema.required ? { required: t.inputSchema.required } : {}),
        },
      })),
    };
  });

  // Handle tools/call — route to the appropriate handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await handleToolCall(name, args || {});
      return {
        content: [{ type: 'text', text: result }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

// CORS — required for browser-based MCP clients and Perplexity
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Accept, mcp-session-id'
  );
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// ---------------------------------------------------------------------------
// Authentication middleware for /mcp
// Validates Bearer token against MCP_API_KEY env var.
// ---------------------------------------------------------------------------

function mcpAuthMiddleware(req, res, next) {
  const apiKey = process.env.MCP_API_KEY;

  // Accept API key from multiple header formats:
  // 1. Authorization: Bearer <key>
  // 2. x-api-key: <key>
  // 3. Authorization: <key> (without Bearer prefix)
  const authHeader = req.headers['authorization'] || '';
  const xApiKey = req.headers['x-api-key'] || '';

  let token = null;
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (xApiKey) {
    token = xApiKey.trim();
  } else if (authHeader) {
    token = authHeader.trim();
  }

  if (!token) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized: Missing API key.' },
      id: null,
    });
    return;
  }

  if (token !== apiKey) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized: Invalid API key.' },
      id: null,
    });
    return;
  }

  next();
}

// ---------------------------------------------------------------------------
// Health check endpoint
// ---------------------------------------------------------------------------

app.get('/', (req, res) => {
  const toolNames = toolDefinitions.map((t) => t.name);
  res.json({
    name: 'Printavo MCP Server',
    version: '1.0.0',
    status: 'ok',
    mode: 'stateless',
    transport: 'streamable-http',
    endpoint: '/mcp',
    tools: toolNames,
    toolCount: toolNames.length,
    description: 'MCP connector for Printavo print shop management. Supports queries and line item mutations.',
  });
});

// ---------------------------------------------------------------------------
// MCP endpoint — POST (tool calls and initialization)
// Stateless: new server + transport per request for complete isolation.
// ---------------------------------------------------------------------------

app.post('/mcp', mcpAuthMiddleware, async (req, res) => {
  let transport;
  let server;

  try {
    server = createMcpServer();
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
    });

    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP request error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

// ---------------------------------------------------------------------------
// MCP endpoint — GET (SSE — not supported in stateless mode)
// ---------------------------------------------------------------------------

app.get('/mcp', mcpAuthMiddleware, (req, res) => {
  // Return 200 with server info for endpoint validation
  res.status(200).json({
    jsonrpc: '2.0',
    result: {
      name: 'printavo-mcp',
      version: '1.0.0',
      status: 'ok',
      message: 'MCP endpoint active. Use POST for tool calls.',
    },
    id: null,
  });
});

// ---------------------------------------------------------------------------
// MCP endpoint — DELETE (session termination — not needed in stateless mode)
// ---------------------------------------------------------------------------

app.delete('/mcp', mcpAuthMiddleware, (req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message:
        'Method Not Allowed: Session management is not supported in stateless mode.',
    },
    id: null,
  });
});

// ---------------------------------------------------------------------------
// 404 catch-all
// ---------------------------------------------------------------------------

app.use((req, res) => {
  res.status(404).json({ error: 'Not found. MCP endpoint is at POST /mcp' });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || '3000', 10);

function start() {
  validateEnv();

  const httpServer = app.listen(PORT, () => {
    console.log(`Printavo MCP Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/`);
    console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
    console.log(`Mode: stateless (new Server + transport per request)`);
    console.log(`Tools: ${toolDefinitions.map((t) => t.name).join(', ')}`);
  });

  // Graceful shutdown
  function shutdown(signal) {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);
    httpServer.close(() => {
      console.log('HTTP server closed.');
      process.exit(0);
    });
    // Force exit after 10s
    setTimeout(() => {
      console.error('Forced shutdown after timeout.');
      process.exit(1);
    }, 10000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();

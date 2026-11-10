import { dirname, join } from 'node:path';
import { AppError } from '../../common/errors';
import { type Env } from '../../config/env';
import { type PayPalGateway } from './paypal-gateway';

export const PAYPAL_MCP = Symbol('PAYPAL_MCP');

export type McpStatus = {
  /** IDLE: configured, but no agent has opened the stdio connection yet. */
  status: 'OK' | 'IDLE' | 'NOT_CONFIGURED' | 'ERROR' | 'DISABLED';
  detail: string;
  tools: string[];
};

type McpClient = {
  listTools(): Promise<{
    tools: Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }>;
  }>;
  callTool(args: { name: string; arguments: Record<string, unknown> }): Promise<{
    isError?: boolean;
    content?: Array<{ type: string; text?: string }>;
  }>;
  close(): Promise<void>;
};

type Connection = {
  client: McpClient;
  tools: Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }>;
  connectedAt: number;
};

/** Tools NeedMesh agents may call at runtime. Overridable with PAYPAL_MCP_ALLOWED_TOOLS. */
const DEFAULT_ALLOWED_TOOLS = ['get_order'];
const RECONNECT_AFTER_MS = 20 * 60_000;

/**
 * Runtime connection to PayPal's official MCP server (`@paypal/mcp`, stdio). NeedMesh uses it for
 * read-only order inspection inside the Recovery and Reconciliation agents: the agent asks PayPal
 * what an order's state *is* instead of trusting its own database. The spawned server receives a
 * short-lived OAuth token, never the client secret. Writes stay on the policy-gated REST rail
 * because the MCP server has no authorization-void tool.
 */
export class PayPalMcpAdapter {
  private connection: Promise<Connection> | null = null;
  private cached: { at: number; value: McpStatus } | null = null;

  constructor(
    private readonly env: Env,
    private readonly gateway: PayPalGateway,
  ) {}

  get allowedTools(): string[] {
    return this.env.PAYPAL_MCP_ALLOWED_TOOLS.length > 0
      ? this.env.PAYPAL_MCP_ALLOWED_TOOLS
      : DEFAULT_ALLOWED_TOOLS;
  }

  /** Never spawns the server: reports configuration and the last known connection result. */
  peek(): McpStatus {
    if (this.cached) return this.cached.value;
    if (!this.env.PAYPAL_MCP_ENABLED)
      return {
        status: 'DISABLED',
        detail: 'PAYPAL_MCP_ENABLED=false. Runtime MCP tool discovery is not active.',
        tools: [],
      };
    if (!this.gateway.configured)
      return {
        status: 'NOT_CONFIGURED',
        detail: 'PayPal credentials are required to start the official PayPal MCP server.',
        tools: [],
      };
    return {
      status: 'IDLE',
      detail:
        'Configured. The official @paypal/mcp server starts when an agent first inspects an order.',
      tools: [],
    };
  }

  async status(): Promise<McpStatus> {
    if (!this.env.PAYPAL_MCP_ENABLED)
      return {
        status: 'DISABLED',
        detail: 'PAYPAL_MCP_ENABLED=false. Runtime MCP tool discovery is not active.',
        tools: [],
      };
    if (!this.gateway.configured)
      return {
        status: 'NOT_CONFIGURED',
        detail: 'PayPal credentials are required to start the official PayPal MCP server.',
        tools: [],
      };
    if (this.cached && Date.now() - this.cached.at < 60_000) return this.cached.value;
    let value: McpStatus;
    try {
      const { tools } = await this.connect();
      const names = tools.map((t) => t.name);
      const usable = names.filter((n) => this.allowedTools.includes(n));
      value = {
        status: 'OK',
        detail: `Connected to @paypal/mcp (${names.length} tools discovered). Agents may call: ${usable.join(', ') || 'none of the allowed tools are exposed'}.`,
        tools: names,
      };
    } catch (error) {
      this.connection = null;
      value = {
        status: 'ERROR',
        detail: error instanceof Error ? error.message : 'MCP connection failed',
        tools: [],
      };
    }
    this.cached = { at: Date.now(), value };
    return value;
  }

  /** Read-only: asks PayPal (through MCP) for an order. Returns null when MCP is not available. */
  async getOrder(orderId: string): Promise<{ tool: string; status: string | null } | null> {
    if (!this.env.PAYPAL_MCP_ENABLED || !this.gateway.configured) return null;
    const tool = 'get_order';
    if (!this.allowedTools.includes(tool))
      throw new AppError(
        'MCP_TOOL_NOT_ALLOWED',
        `${tool} is not in PAYPAL_MCP_ALLOWED_TOOLS.`,
        403,
      );
    const { client, tools } = await this.connect();
    const def = tools.find((t) => t.name === tool);
    if (!def) return null;
    const properties = Object.keys(def.inputSchema?.properties ?? {});
    const idKey = ['id', 'order_id', 'orderId'].find((k) => properties.includes(k)) ?? 'id';
    const result = await client.callTool({ name: tool, arguments: { [idKey]: orderId } });
    if (result.isError) return { tool, status: null };
    const text = result.content?.find((c) => c.type === 'text')?.text ?? '';
    return { tool, status: extractOrderStatus(text) };
  }

  async close() {
    const current = this.connection;
    this.connection = null;
    if (current) await (await current.catch(() => null))?.client.close().catch(() => undefined);
  }

  private async connect(): Promise<Connection> {
    if (this.connection) {
      const existing = await this.connection.catch(() => null);
      if (existing && Date.now() - existing.connectedAt < RECONNECT_AFTER_MS) return existing;
      await this.close();
    }
    this.connection = this.open();
    try {
      return await this.connection;
    } catch (error) {
      this.connection = null;
      throw error;
    }
  }

  private async open(): Promise<Connection> {
    const token = await this.gateway.getAccessToken();
    const [{ Client }, { StdioClientTransport }] = await Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js'),
      import('@modelcontextprotocol/sdk/client/stdio.js'),
    ]);
    const entry = join(dirname(require.resolve('@paypal/mcp/package.json')), 'dist', 'index.js');
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry, '--tools=all'],
      env: {
        PAYPAL_ACCESS_TOKEN: token,
        PAYPAL_ENVIRONMENT: this.env.PAYPAL_ENVIRONMENT === 'live' ? 'PRODUCTION' : 'SANDBOX',
      },
      stderr: 'ignore',
    });
    const client = new Client({ name: 'needmesh-agents', version: '1.0.0' });
    await withTimeout(client.connect(transport), 25_000, 'PayPal MCP did not start in time.');
    const { tools } = await withTimeout(
      client.listTools(),
      15_000,
      'PayPal MCP listTools timed out.',
    );
    return { client: client as unknown as McpClient, tools, connectedAt: Date.now() };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e instanceof Error ? e : new Error(String(e)))),
    );
  });
}

/** MCP returns the order as JSON text; pull the PayPal order status defensively. */
export function extractOrderStatus(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { status?: unknown };
    return typeof parsed.status === 'string' ? parsed.status : null;
  } catch {
    const match = /"status"\s*:\s*"([A-Z_]+)"/.exec(text);
    return match?.[1] ?? null;
  }
}

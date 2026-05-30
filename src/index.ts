#!/usr/bin/env node
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveAuth } from './auth.js';
import type { SkylightClient } from './client.js';
import { registerFrameTools } from './tools/frames.js';
import { registerEventTools } from './tools/events.js';
import { registerListTools } from './tools/lists.js';
import { registerChoreTools } from './tools/chores.js';

async function main() {
  const server = new McpServer({ name: 'skylight-mcp', version: '0.1.0' }); // x-release-please-version

  let client: SkylightClient | undefined;
  let configError: string | undefined;
  const getClient = async (): Promise<SkylightClient> => {
    if (client) return client;
    if (configError) throw new Error(configError);
    try {
      ({ client } = await resolveAuth());
      return client!;
    } catch (e) {
      configError = e instanceof Error ? e.message : String(e);
      throw new Error(configError);
    }
  };

  registerFrameTools(server, getClient);
  registerEventTools(server, getClient);
  registerListTools(server, getClient);
  registerChoreTools(server, getClient);

  await server.connect(new StdioServerTransport());
}

main().catch((e) => { console.error(e); process.exit(1); });

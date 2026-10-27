import fs from 'fs';
import path from 'path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  StdioServerParameters,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';

/** A real SDK client and persistent subprocess, shared by public MCP scenarios. */
export class McpCliClient {
  readonly client = new Client({ name: 'anthracite-tests', version: '1.0.0' });
  readonly transport: StdioClientTransport;
  readonly errors: string[] = [];
  readonly messages: JSONRPCMessage[] = [];
  readonly sentMessages: JSONRPCMessage[] = [];
  stderr = '';

  constructor(
    cwd: string,
    env: NodeJS.ProcessEnv,
    launch: [string, ...string[]] = getTestCliCommand(['mcp'])
  ) {
    const [command, ...args] = launch;
    const environment: Record<string, string> = {};
    for (const [key, value] of Object.entries(env))
      if (value !== undefined) environment[key] = value;
    const parameters: StdioServerParameters = {
      command,
      args,
      cwd,
      env: environment,
      stderr: 'pipe',
    };
    this.transport = new StdioClientTransport(parameters);
    const send = this.transport.send.bind(this.transport);
    this.transport.send = async (message: JSONRPCMessage) => {
      this.sentMessages.push(message);
      await send(message);
    };
    const start = this.transport.start.bind(this.transport);
    this.transport.start = async () => {
      const receive = this.transport.onmessage;
      this.transport.onmessage = (message) => {
        this.messages.push(message);
        receive?.(message);
      };
      await start();
    };
    this.transport.stderr?.on('data', (data: Buffer) => {
      this.stderr += data.toString('utf8');
    });
    this.client.onerror = (error) => this.errors.push(error.message);
  }

  async connect(protocolVersion = '2025-11-25'): Promise<void> {
    // The SDK Client defaults to its newest version; vary only its public wire input.
    const send = this.transport.send.bind(this.transport);
    this.transport.send = async (message: JSONRPCMessage) => {
      await send(
        'method' in message && message.method === 'initialize'
          ? { ...message, params: { ...message.params, protocolVersion } }
          : message
      );
    };
    await this.client.connect(this.transport, { timeout: 10000 });
  }

  async close(): Promise<void> {
    await this.client.close();
    const evidence = process.env.ANTHRACITE_TEST_EVIDENCE_DIR;
    if (evidence) {
      fs.mkdirSync(evidence, { recursive: true });
      fs.writeFileSync(
        path.join(evidence, `mcp-${process.pid}-${Date.now()}.json`),
        JSON.stringify({
          messages: this.messages,
          sentMessages: this.sentMessages,
          errors: this.errors,
          stderr: this.stderr,
        })
      );
    }
  }
}

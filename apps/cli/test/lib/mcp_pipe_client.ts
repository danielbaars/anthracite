import { spawn } from 'child_process';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

import { getTestCliCommand } from '../../src/lib/utils/test_cli_command';

/** SDK framing over owned pipes, with no client transport's fallback signals. */
export class McpPipeClient {
  readonly client = new Client({
    name: 'anthracite-eof-tests',
    version: '1.0.0',
  });
  readonly messages: JSONRPCMessage[] = [];
  readonly sentMessages: JSONRPCMessage[] = [];
  readonly child;
  readonly transport;
  stderr = '';
  hasClosed = false;

  constructor(cwd: string, env: NodeJS.ProcessEnv) {
    const [command, ...args] = getTestCliCommand(['mcp']);
    this.child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Framing is symmetric; this official transport never signals the peer.
    this.transport = new StdioServerTransport(
      this.child.stdout,
      this.child.stdin
    );
    this.transport.onmessage = (message) => this.messages.push(message);
    const send = this.transport.send.bind(this.transport);
    this.transport.send = async (message) => {
      this.sentMessages.push(message);
      await send(message);
    };
    this.child.stderr.on('data', (data: Buffer) => {
      this.stderr += data.toString('utf8');
    });
    this.child.once('close', () => {
      this.hasClosed = true;
      void this.transport.close();
    });
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport, { timeout: 10000 });
  }

  endStdin(): void {
    this.child.stdin.end();
  }
}

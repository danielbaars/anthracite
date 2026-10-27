import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { version } from '../../../package.json';
import { ANTHRACITE_GUIDANCE } from './learn';
import { createCommandExecutor } from './execute';
import { ExecutionOptions } from './execute_child';

export async function serveMcp(options: ExecutionOptions): Promise<void> {
  const executor = createCommandExecutor(options);
  // The lower-level SDK server keeps the tool list static (no listChanged hint).
  const server = new Server(
    { name: 'anthracite', version },
    { capabilities: { tools: {} } }
  );
  server.onerror = (error) => {
    process.stderr.write(`MCP error: ${error.message}\n`);
  };
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: 'run_an_cmd',
        description:
          'Execute this Anthracite build with literal arguments in an explicit directory. May mutate repositories and external services. Follow user/repository instructions and publication approvals.',
        inputSchema: {
          type: 'object',
          properties: {
            args: { type: 'array', items: { type: 'string' }, minItems: 1 },
            cwd: {
              type: 'string',
              description: 'Absolute existing directory.',
            },
            why: {
              type: 'string',
              minLength: 1,
              description: 'Nonempty explanation; never executed.',
            },
          },
          required: ['args', 'cwd', 'why'],
          additionalProperties: false,
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      {
        name: 'learn_an',
        description:
          'Read Anthracite workflow guidance. User and repository instructions and publication approvals remain authoritative.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (request.params.name === 'run_an_cmd') {
      const result = await executor.execute(
        request.params.arguments,
        extra.signal
      );
      return {
        isError: result.status !== 'success',
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    }
    if (request.params.name !== 'learn_an')
      throw new McpError(ErrorCode.InvalidParams, 'Unknown Anthracite tool.');
    if (
      !z
        .object({})
        .strict()
        .safeParse(request.params.arguments ?? {}).success
    )
      return {
        isError: true,
        content: [{ type: 'text', text: 'learn_an accepts no arguments.' }],
      };
    return { content: [{ type: 'text', text: ANTHRACITE_GUIDANCE }] };
  });
  let stopping = false;
  const stop = (): void => {
    void shutdown();
  };
  async function shutdown(): Promise<void> {
    if (stopping) return;
    stopping = true;
    // Stop admission synchronously, before SDK close aborts in-flight handlers.
    const drained = executor.shutdown();
    try {
      await server.close();
    } finally {
      await drained;
      process.stdin.off('end', stop);
      process.stdin.off('error', stop);
      process.stdout.off('error', stop);
      process.stdout.off('close', stop);
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }
  }
  server.onclose = stop;
  process.stdin.once('end', stop);
  process.stdin.on('error', stop);
  // A vanished output pipe must not reach the CLI's immediate uncaught exit.
  process.stdout.on('error', stop);
  process.stdout.on('close', stop);
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await server.connect(new StdioServerTransport());
}

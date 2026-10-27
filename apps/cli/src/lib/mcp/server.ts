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

export async function serveMcp(): Promise<void> {
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
  server.setRequestHandler(CallToolRequestSchema, (request) => {
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
  await server.connect(new StdioServerTransport());
}

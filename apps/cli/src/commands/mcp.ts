import { serveMcp } from '../lib/mcp/server';

export const command = 'mcp';
export const canonical = 'mcp';
export const description = 'Serve local Anthracite tools over MCP stdio.';
export const handler = async (): Promise<void> => {
  await serveMcp();
};

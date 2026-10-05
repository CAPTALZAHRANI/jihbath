// Discovers the tools exposed by Shamela's public MCP service (https://shamela.ws/mcp)
// so the third hadith path is built on its real tool names and inputs, not guesses.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const URL_ = new URL(process.env.SHAMELA_MCP || 'https://shamela.ws/mcp');

async function connect() {
  const client = new Client({ name: 'jihbath', version: '0.1.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(URL_));
    console.log('connected (streamable HTTP)');
  } catch (e) {
    console.log('streamable HTTP failed:', e.message, '→ trying SSE');
    await client.connect(new SSEClientTransport(URL_));
    console.log('connected (SSE)');
  }
  return client;
}

const client = await connect();
const { tools } = await client.listTools();
console.log(`\n${tools.length} tools:\n`);
for (const t of tools) {
  console.log(`■ ${t.name}\n  ${String(t.description || '').replace(/\s+/g, ' ').slice(0, 300)}`);
  console.log(`  input: ${JSON.stringify(t.inputSchema?.properties || {})}`);
  if (t.inputSchema?.required) console.log(`  required: ${t.inputSchema.required.join(', ')}`);
  console.log('');
}
await client.close();

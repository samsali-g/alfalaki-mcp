// Smoke test for the alfalaki-mcp stdio bridge.
//
// Spawns index.js exactly the way an MCP client would, runs the initialize
// handshake, then asks for the tool list. It asserts on the actual JSON-RPC
// replies from the live remote (https://alfalaki.space/mcp by default), so a
// green run means the whole path works end to end: stdio framing, HTTP relay,
// session id round-trip, and SSE-or-JSON parsing.
//
// Needs network access. Run with: npm test   (or: node test/smoke.mjs)

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 20000);

const child = spawn(process.execPath, [BRIDGE], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, MCP_DEBUG: '1' },
});

let stderr = '';
child.stderr.on('data', (d) => {
  stderr += d.toString();
});

// A tiny line-oriented reader: every stdout line should be one JSON-RPC message.
const pending = new Map(); // id -> {resolve, reject}
let stdoutBuf = '';
child.stdout.on('data', (chunk) => {
  stdoutBuf += chunk.toString();
  let nl;
  while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
    const line = stdoutBuf.slice(0, nl).trim();
    stdoutBuf = stdoutBuf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      fail(`stdout line is not JSON: ${line.slice(0, 200)}`);
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`JSON-RPC error for id ${msg.id}: ${msg.error.message}`));
      else resolve(msg.result);
    }
  }
});

let failed = false;
function fail(message) {
  console.error(`SMOKE FAIL: ${message}`);
  failed = true;
  child.kill();
  process.exitCode = 1;
}

const timer = setTimeout(() => fail(`timed out after ${TIMEOUT_MS}ms`), TIMEOUT_MS);

function request(id, method, params) {
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

try {
  const init = await request(1, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'alfalaki-smoke', version: '1.0.0' },
  });
  const serverName = init?.serverInfo?.name;
  if (!serverName) throw new Error(`initialize result has no serverInfo.name: ${JSON.stringify(init).slice(0, 200)}`);
  console.log(`initialize ok: ${serverName} ${init?.serverInfo?.version || ''} (protocol ${init?.protocolVersion || '?'})`);

  notify('notifications/initialized');

  const list = await request(2, 'tools/list', {});
  const tools = list?.tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error(`tools/list returned no tools: ${JSON.stringify(list).slice(0, 200)}`);
  }
  const bad = tools.filter((t) => !t || typeof t.name !== 'string' || !t.name);
  if (bad.length) throw new Error(`${bad.length} tool entries have no name`);
  console.log(`tools/list ok: ${tools.length} tools — ${tools.map((t) => t.name).join(', ')}`);

  clearTimeout(timer);
  console.log('SMOKE PASS');
  child.kill();
  process.exit(0);
} catch (e) {
  clearTimeout(timer);
  fail(e.message);
  if (stderr.trim()) console.error(`--- bridge stderr ---\n${stderr.trim()}`);
}

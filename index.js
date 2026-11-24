#!/usr/bin/env node
// alfalaki-mcp — a stdio bridge to the remote MCP server at alfalaki.space.
//
// WHY THIS EXISTS
//
// alfalaki.space runs a remote MCP server (Streamable HTTP) at
// https://alfalaki.space/mcp exposing its computed-ephemeris tools. Many MCP
// clients still expect a *local stdio* server they can spawn, and the official
// MCP Registry only hosts metadata for a published package — it does not host
// artifacts. This package is the thin, honest adapter: it speaks JSON-RPC over
// stdio on one side and relays to the remote HTTP endpoint on the other. It
// computes nothing itself; every answer comes from the live ephemeris service.
//
// Protocol notes:
//   * stdio transport = newline-delimited JSON-RPC messages, one per line.
//   * The remote may answer with application/json (a single response) or
//     text/event-stream (SSE frames). Both shapes are handled.
//   * If the remote hands out a session id (Mcp-Session-Id), it is echoed on
//     every later request, which is what the Streamable HTTP spec expects.
//   * Notifications (no id) may be answered with 202 and no body — nothing is
//     printed for those, exactly like a well-behaved local server.
//
// Usage:
//   npx alfalaki-mcp            # speaks MCP over stdio
//   MCP_REMOTE=https://... npx alfalaki-mcp   # point at another deployment

import { createInterface } from 'node:readline';

const REMOTE = (process.env.MCP_REMOTE || 'https://alfalaki.space/mcp').replace(/\/$/, '');
const DEBUG = !!process.env.MCP_DEBUG;

let sessionId = null;
let protocolVersion = null;

const debug = (msg) => {
  if (DEBUG) process.stderr.write(`[alfalaki-mcp] ${msg}\n`);
};

/** Write one JSON-RPC message as a single line on stdout. */
function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

/** Parse an SSE body into the JSON payloads it carries. */
function parseSse(text) {
  const out = [];
  for (const block of text.split(/\n\n+/)) {
    const data = block
      .split(/\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('');
    if (!data) continue;
    try {
      out.push(JSON.parse(data));
    } catch {
      debug(`unparseable SSE payload: ${data.slice(0, 200)}`);
    }
  }
  return out;
}

async function relay(message) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  if (protocolVersion) headers['mcp-protocol-version'] = protocolVersion;

  let res;
  try {
    res = await fetch(REMOTE, { method: 'POST', headers, body: JSON.stringify(message) });
  } catch (e) {
    if (message.id !== undefined) {
      emit({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: `remote unreachable: ${e.message}` } });
    }
    return;
  }

  const sid = res.headers.get('mcp-session-id');
  if (sid && sid !== sessionId) {
    sessionId = sid;
    debug(`session established: ${sid}`);
  }
  if (message.method === 'initialize' && message.params?.protocolVersion) {
    protocolVersion = message.params.protocolVersion;
  }

  if (res.status === 202 || res.status === 204) return; // notification accepted

  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  if (!res.ok) {
    if (message.id !== undefined) {
      emit({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: `remote ${res.status}: ${text.slice(0, 300)}` } });
    }
    return;
  }
  const payloads = /event-stream/i.test(ct) ? parseSse(text) : [JSON.parse(text)];
  for (const p of payloads) emit(p);
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    debug(`ignoring unparseable stdin line: ${trimmed.slice(0, 200)}`);
    return;
  }
  // A batch is an array; relay it as-is (the remote answers with an array).
  relay(message).catch((e) => debug(`relay failed: ${e.message}`));
});
rl.on('close', () => process.exit(0));

# alfalaki-mcp

[![mcptry](https://mcptry.com/badge/io.github.samsali-g/alfalaki)](https://mcptry.com/servers/io.github.samsali-g/alfalaki)
[![Glama MCP](https://img.shields.io/badge/Glama-MCP%20Directory-blue)](https://glama.ai/mcp/connectors/io.github.samsali-g/alfalaki)

MCP stdio bridge to **[alfalaki.space](https://alfalaki.space)** — astrology computed from a
real ephemeris rather than recycled horoscope text. The heavy lifting happens on the server
(astronomy-engine + Swiss-style ephemeris data); this package is a thin adapter so any MCP
client that spawns a local stdio server can use it.

## What it exposes

The remote server currently reports these tools (verified against the live endpoint by
`npm test`):

- `alfalaki_list_signs`, `alfalaki_get_sign` — zodiac sign index and per-sign data
- `alfalaki_get_horoscope_url` — the horoscope page for a sign and timeframe
- `alfalaki_get_placement` — planet-in-sign placement pages
- `alfalaki_get_sky_now` — current sky / transit state
- `alfalaki_get_compatibility_url` — compatibility page for a pair of signs
- `alfalaki_get_tarot`, `alfalaki_get_faq` — tarot card and FAQ lookups
- `alfalaki_get_daily_essay` — today's computed sky essay in English and Arabic
- `alfalaki_publisher` — attribution/metadata helper

Call `tools/list` after connecting for the authoritative list and schemas — the server is the
source of truth, this README only mirrors what it announced last time the test ran.

## Configure a client

Claude Desktop (`claude_desktop_config.json`) or any client using `mcpServers`:

```json
{
  "mcpServers": {
    "alfalaki": {
      "command": "npx",
      "args": ["-y", "alfalaki-mcp"]
    }
  }
}
```

VS Code / Cursor style (`mcp.json`):

```json
{
  "servers": {
    "alfalaki": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "alfalaki-mcp"]
    }
  }
}
```

If the client can talk Streamable HTTP directly, the bridge is unnecessary — point it at
`https://alfalaki.space/mcp`.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `MCP_REMOTE` | `https://alfalaki.space/mcp` | Remote endpoint to relay to |
| `MCP_DEBUG` | unset | Log relay/session details to stderr |

## How it works

Newline-delimited JSON-RPC on stdin → one POST per message to the remote endpoint →
the response (a JSON body, or SSE frames if the server streams) is written back as one
JSON-RPC line per message on stdout. `Mcp-Session-Id` and `MCP-Protocol-Version` are echoed
when the server provides them, per the Streamable HTTP transport spec. Notifications that the
server accepts with `202` produce no output — same behaviour as a local server.

Nothing is cached and nothing is computed locally: if alfalaki.space changes a tool, this
bridge reflects it immediately.

## Verify

```bash
npm test          # spawns the bridge, initializes, lists tools, asserts a response
```

The smoke test needs network access (it talks to the live server).

## License

MIT. The astrology data itself is served by alfalaki.space under its own terms
(https://alfalaki.space/terms/).

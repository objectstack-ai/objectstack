---
"@objectstack/hono": patch
---

fix(hono): on a `createHonoApp` host, `GET /api/v1/mcp/skill` answers the raw markdown with one `Content-Type: text/markdown; charset=utf-8` and `Cache-Control: no-store`, as the standalone server does

Clause-②: no

- **What a caller got.** The skill is served as a single string event on the dispatcher's `result` stream channel. The adapter's stream writer framed every event outside a Vercel data stream as `data: <JSON>`, so the body was an SSE frame of a JSON-encoded string (`data: "---\nname: …"`), not markdown. It also set its own `Content-Type` and `Cache-Control` beside the domain's, so the answer carried `text/markdown; charset=utf-8, text/markdown; charset=utf-8` and `no-cache, no-store` (on a socket: two `Content-Type` lines and two `Cache-Control` lines).
- **What it answers now.** A string event is written as given, in every stream mode, and a header the producer sets replaces the adapter's default of the same name, whatever its case. Object events are still one `data:` frame each (one JSON line in a Vercel data stream), and a stream that sets no headers still gets `text/event-stream`, `no-cache` and `keep-alive`.
- **Unchanged:** the AI chat streams, which reach the same writer as pre-encoded Vercel data stream frames or as object parts, and every other route.

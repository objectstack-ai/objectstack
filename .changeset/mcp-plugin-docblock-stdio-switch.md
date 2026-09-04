---
"@objectstack/mcp": patch
---

docs(mcp): correct `MCPServerPlugin`'s docblock to the canonical stdio switch (#14473)

The class docblock still taught the **pre-split** stdio trigger. Step 2 said the
long-lived transport starts "only when `autoStart` is enabled or
`OS_MCP_SERVER_ENABLED` is explicitly `true`", and the Environment Variables
block said explicit `true` "additionally auto-starts the stdio transport".
Neither named `OS_MCP_STDIO_ENABLED` — the canonical switch — anywhere.

About 100 lines below it, the code says the opposite. `resolveMcpStdioAutoStart()`
reads `OS_MCP_STDIO_ENABLED` first and returns it clean; `OS_MCP_SERVER_ENABLED=true`
falls through to a legacy branch flagged `viaDeprecatedAlias`, and `start()` warns
that this trigger is DEPRECATED. So an author following the docblock got a working
transport **plus a deprecation warning at every boot**, with no way from this file
to learn the right spelling.

This is a published surface, not an internal note: `MCPServerPlugin` is exported
from the package entry, `dts` emit is on, and `files` ships `dist` — so the
docblock reaches consumers as `dist/index.d.ts` and renders in editor
IntelliSense. It had already cost something once: the published
`skills/objectstack-ai` MCP section was written from this docblock and inherited
the same error, caught in contract review and fixed in PR #14463.

Now:

- **step 2** — starts "only when `autoStart` is enabled or `OS_MCP_STDIO_ENABLED`
  is truthy";
- **Environment Variables** — `OS_MCP_SERVER_ENABLED` is described as the
  default-on **HTTP** gate only; `OS_MCP_STDIO_ENABLED` is listed as the stdio
  transport's own switch (default OFF); and the legacy trigger is marked
  deprecated **in the runtime warning's own words**, copied verbatim from the
  `ctx.logger.warn` below rather than paraphrased, so the two cannot drift into
  two phrasings of one rule.

Comments only — no behaviour change.

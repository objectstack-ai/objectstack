---
"@objectstack/cli": patch
---

fix(cli): the capability resolver matches provider identities, not name fragments (#7652)

`os serve` auto-adds `mcp` to `requires` and then skips loading a provider when
the app already supplies one. That "already supplied?" check compared each
provider's `nameMatch` fragments against loaded plugin names with
`String.includes()` — and a plugin that CONSUMES a capability is conventionally
named after the capability it consumes. So a consumer reliably satisfied its own
provider's fragment and suppressed it.

The stock showcase hit exactly that. It loads `com.objectstack.connector.mcp`,
the outbound MCP *client* connector; `'mcp'` is a substring of that name, so
`MCPServerPlugin` never loaded and `/api/v1/mcp` and `/api/v1/mcp/skill`
answered 501 "MCP server is not available" under a boot banner advertising the
endpoint.

The fix is the class, not the collision: `Serve.providesCapability` now compares
a plugin's `name` and constructor name to the registry's declared identities by
EQUALITY, and each entry declares the provider's real registered plugin id
(`com.objectstack.mcp`) rather than a fragment of it. No exclusion list, no
lengthened fragment, no load-order luck — a plugin either is the provider or it
is not.

Tightening the comparison could have gone the other way and stopped legitimate
providers being recognised, so the identities were measured against the provider
packages rather than assumed. That measurement turned up that most of the old
name fragments were already dead: `service-cache` never matched
`com.objectstack.service.cache` (dash vs dot), and eighteen of twenty-three
entries were carried entirely by their class name. A drift test now imports every
provider package and asserts the name it registers is one the registry declares,
so a rename cannot quietly return the resolver to double-loading.

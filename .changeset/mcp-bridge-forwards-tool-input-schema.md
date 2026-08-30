---
'@objectstack/mcp': minor
---

Tools bridged from an AI service's `ToolRegistry` now reach MCP clients with the
input schema their definition declares, and the arguments a client sends now
reach the tool.

`MCPServerRuntime.registerToolFromDefinition` passed a name, a description and
three annotation hints to `McpServer.registerTool` and never read
`tool.parameters`. Measured over a real `StdioServerTransport` at `74049254`, a
bridged `query_records` declaring
`{ objectName: string (required), limit: number }` was served to `tools/list` as
`inputSchema: { "type": "object", "properties": {} }` — the SDK's synthesised
empty schema, i.e. a positive claim that the tool takes no arguments — and a
`tools/call` carrying `{ objectName: 'task', limit: 5 }` reached
`toolRegistry.execute` as `input: {}`.

The second half was invisible for the same reason as the first. The handler read
`extra.arguments`, a member `RequestHandlerExtra` does not have in any version of
the SDK this package has depended on, so it was always `undefined`; and
`McpServer.executeToolHandler()` branches on `tool.inputSchema`, invoking a
schema-less tool as `handler(extra)`. Declaring the schema is what makes the SDK
hand the call's arguments to the handler at all, so both halves are one fix.

`AIToolDefinition.parameters` is JSON Schema and `registerTool` accepts only Zod
— a raw JSON Schema object reaches the SDK's `getZodSchemaObject()` and throws
`inputSchema must be a Zod schema or raw shape, received an unrecognized object`
— so the new `toolInputSchema()` converts it with `zod@4`'s own
`fromJSONSchema`, adding no dependency. The SDK converts the result straight back
to JSON Schema for `tools/list`; properties, types, descriptions, `required`,
enums, nested objects and `anyOf`/`oneOf` survive the round trip.

Two consequences worth stating rather than discovering. Declaring an
`inputSchema` is also what turns on `McpServer.validateToolInput()`, which this
SDK offers no way to decline: a call whose arguments do not match the declared
schema is now answered with an `isError` result naming the offending field
instead of being executed with `{}`. And a definition whose `parameters` does not
describe an object — absent, `{}`, or untyped — is bridged with a loose empty
object, which advertises exactly what the SDK synthesised before and constrains
nothing, so a tool that genuinely declares no arguments behaves as it did.

The docblocks were the reason this survived a reading: `bridgeTools` claimed each
tool became "an MCP tool with the same name, description, and JSON Schema
parameters", and the comment on the call claimed the schema was passed "as
annotations metadata" — through an `annotations` object that carries only
`destructiveHint` / `readOnlyHint` / `openWorldHint`, and is typed to accept
nothing else. Both now describe what the code does.

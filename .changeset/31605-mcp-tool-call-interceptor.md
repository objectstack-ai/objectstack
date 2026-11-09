---
'@objectstack/mcp': patch
'@objectstack/runtime': patch
---

feat(mcp): a host can observe and refuse every MCP tool call through one neutral interceptor on the `mcp` service

Clause-②: yes (widening) — `MCPServerRuntime` gains `setToolInterceptor`, `clearToolInterceptor` and `hasToolInterceptor`, `handleHttpRequest` gains an optional `caller`, and `@objectstack/mcp` exports the types `McpToolInterceptor`, `McpToolCallContext`, `McpToolCallPrincipal`, `McpToolCallRefusal`, `McpToolCallResult`, `McpToolTransport`, `McpPrincipalKind`, `McpCallerExecutionContext` and `McpHttpCaller`. With no interceptor installed, every tool call answers exactly as before.
Metadata-protocol: none

- **`@objectstack/mcp`:** `runtime.setToolInterceptor(fn)` installs one interceptor (a single slot, read at each call) around every tool call on both transports: the object, action, file and federation tools, the host-injected authoring family, the bridged AI tools, and any tool a plugin registers on the runtime's server. The interceptor receives a frozen context built on the server side — `door: 'mcp'`, `transport` (`http` or `stdio`), the tool name, a copy of the validated arguments, and the principal (`userId`, `principalKind`, `onBehalfOf`, `performedBy.clientId`, `organizationId`, `environmentId`, and `isSystem` for a system caller) projected from the host's resolved `ExecutionContext`, never from a request header. It allows by calling `next()` (and may return a replacement result), or denies by returning `{ outcome: 'deny', code, message, status }`, which the client receives in the coded-refusal envelope every MCP tool error uses. A throw from the interceptor refuses the call the same way; any other verdict is refused as `500 INTERNAL_ERROR`. The package holds no policy: audit, seat checks and kill switches belong to whichever host installs the interceptor.
- **`@objectstack/mcp`, stdio:** once the plugin has resolved `OS_MCP_STDIO_API_KEY`, the AI tools it bridges from the AI service's tool registry run with that key's user as their execution context (`actor`: id, positions, permissions), resolved per call, so a registry that needs an actor no longer refuses them as unauthenticated, and a key that stops resolving refuses the next call. A runtime with no stdio principal bound calls the registry exactly as before.
- **`@objectstack/runtime`:** the `/mcp` dispatcher passes the request's resolved `ExecutionContext` and the environment it dispatched for to `handleHttpRequest` as `caller`, the input an interceptor's principal is projected from.

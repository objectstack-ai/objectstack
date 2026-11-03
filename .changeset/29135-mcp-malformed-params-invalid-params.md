---
'@objectstack/mcp': patch
---

fix(mcp): a request with malformed params answers JSON-RPC -32602 Invalid params naming the param, not -32603 Internal error with a raw Zod issue list

Clause-②: no
Metadata-protocol: none

An MCP request whose `params` fail the method's request schema (`prompts/get` with no `name`, `tools/call` with `{}`, `prompts/get` with `"name": 42`) used to answer `-32603 Internal error` whose message was the serialised Zod issue array: the client was told the server failed, and an agent that retries on Internal error kept retrying a request that could never succeed. It now answers `-32602 Invalid params` with one sentence per problem, such as `params.name is required` or `params.name must be a string`. The same requests stay refused; only the error class and the message change. Both transports (Streamable HTTP and stdio) build their server through one seam, so the answer is the same on either and for every method, including the ones the SDK installs itself (`initialize`). A tool's own argument check (for example `validate_expression` with an unknown `site`) keeps its answer, and an error raised inside a handler keeps its own code.

---
"@objectstack/spec": patch
---

docs: note that the root README's `claude mcp add` one-liner needs a follow-up sign-in step (#10319)

The "Your app is AI-operable, for free" section's copy-paste command
(`claude mcp add --transport http my-app http://localhost:3000/api/v1/mcp`)
registers the server correctly, but running it alone and then calling a tool
401s — measured live, at head, against a freshly booted `examples/app-crm`:
unauthenticated `initialize` returns
`401 {"code":"UNAUTHENTICATED","message":"Unauthorized: a valid OAuth access
token or API key is required"}`, exactly as the finding this closes reported.
The README gave no hint that a sign-in step follows the command.

The linked docs page, [Connect an MCP
Client](https://objectstack.ai/docs/ai/connect-mcp), already carries the step
in full (interactive OAuth browser login, plus a headless API-key flow for
CI/containers) — confirmed by reading it and by reproducing both paths live:
the same unauthenticated call 401s with a `WWW-Authenticate` header
advertising OAuth metadata, and minting a key via `POST /api/v1/keys` with a
session cookie and sending it back as `x-api-key` returns `200` with a valid
`initialize` response. So the fix is a one-sentence pointer in the README, not
a rewrite of the docs page it already correctly delegates to.

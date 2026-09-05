---
"@objectstack/runtime": patch
---

An environment-scoped URL now reaches a dispatcher domain instead of answering 404.

`HttpDispatcher.dispatch()` reads the scoped-URL prefix in three places — the environment-id hint parser, the OAuth-on-MCP gate, and the scope strip that lets `DomainHandlerRegistry` match the remainder. Only the first had been moved to the ADR-0006 `/environments/` spelling; the other two still matched the retired `/projects/` one. The strip therefore never fired on a real scoped URL, and since the registry matches from the head of the path, every environment-scoped request arriving through the `@objectstack/hono` catch-all — the entry cloud hosts mount, and the only one that hands `dispatch()` a still-scoped path — matched no domain at all:

```
GET /api/v1/environments/<id>/data/task   ->  404 ROUTE_NOT_FOUND   (now: reaches /data)
GET /api/v1/environments/<id>/health      ->  404 ROUTE_NOT_FOUND   (now: 200)
GET /api/v1/data/task          (control)  ->  reaches /data, unchanged
```

The dispatcher-plugin's own scoped mounts were never affected: they pass a pre-stripped subpath (`${prefix}/environments/:environmentId/automation` dispatches the literal `/automation`), which is why the standalone server showed nothing.

The OAuth 2.1 gate moved with it. An access token is honoured only on the MCP surface, and that test runs against the still-scoped path — so `/api/v1/environments/<id>/mcp` would have reached the MCP domain with its token refused had the strip been repaired alone.

**If you still emit the old spelling**: replace `/api/v1/projects/:projectId/...` with `/api/v1/environments/:environmentId/...`, as `content/docs/api/environment-routing.mdx` has instructed since ADR-0006 D2. That prefix is no longer stripped, and it was never a working alias in the first place: nothing parses `/projects/<id>`, so stripping it discarded the only place the request named an environment and served it from the host default instead. ADR-0006 D2 retired `project` on the API surface with no aliases, so the repair is one spelling in all three readings rather than a two-prefix alternation.

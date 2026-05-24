---
'@objectstack/service-ai': patch
---

**Actions-as-tools Phase 2:** the AI tool runtime can now dispatch `type:'api'` and `type:'flow'` actions in addition to `type:'script'`.

- New exported `ApiActionClient` interface and `createFetchApiClient({ baseUrl, headers, fetch })` factory — default fetch-based dispatch resolves relative `target` paths against `baseUrl`, throws on non-2xx with `${method} ${url} → ${status}: ${body}`, and JSON-parses the response.
- New exported `buildApiRequestBody(action, args, record, recordId)` helper — honours `bodyShape.wrap`, `recordIdParam` + `recordIdField` (defaults to `'id'`), and merges `bodyExtra` last so constants win.
- `ActionToolsContext` extended (additive): `automation`, `apiClient`, `apiBaseUrl`, `apiHeaders`.
- `actionSkipReason()` gains an optional second `ctx` parameter that returns precise wiring-availability reasons (`'no automation service available'`, `'no apiClient or apiBaseUrl configured'`). Studio-only types (`url` / `modal` / `form`) and all dangerous variants (`confirmText`, `mode:'delete'`, `variant:'danger'`) remain skipped.
- `AIServicePlugin` options accept `apiActionBaseUrl` (falls back to `OS_AI_ACTION_API_BASE_URL`) and `apiActionHeaders`; the plugin now resolves the `automation` service silently and threads everything into `registerActionsAsTools`.

Net result: every non-destructive declarative action with a target — `script`, `api`, `flow` — is now LLM-callable end-to-end as soon as the corresponding wiring is in place.

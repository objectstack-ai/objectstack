---
'@objectstack/runtime': patch
'@objectstack/metadata-protocol': patch
---

Gate every dispatcher service domain on `handlerReady` instead of on slot occupancy (#4058 step 2).

#4000 made the `/analytics` domain execute ADR-0076 D12's third conclusion ("consumers treat only `handlerReady: true` as a real capability"); every other domain still gated on "is a service registered", so a self-declared stub occupying `automation` / `notification` / `ai` / `file-storage` / `i18n` was called like a real implementation and its fabricated answer went out as a 200. Step 1 (#4082) made the two kinds of dev implementation distinguishable; this is the gate that reads the distinction.

- The `/analytics`, `/automation`, `/notifications`, `/ai`, `/storage` and `/i18n` domains, the route-mount gate, discovery's `routes`/`features`, and the metadata-protocol builder's route advertisement now share one predicate (`isServiceServeable`): a slot whose occupant self-declares `handlerReady: false` is answered exactly as an empty slot is — the domain's existing 404, or the explicit 501 `/storage` and `/i18n` use. One predicate, so what is advertised and what is served cannot disagree.
- `handlerReady`, not `status`, is the test. An implementation that declares `degraded` defaults to `handlerReady: true` and keeps serving — which is why the in-memory `file-storage` and `i18n` implementations are unaffected.
- `discovery.services.*` stays presence-gated: a registered stub still reports `{ enabled: true, status: 'stub', handlerReady: false }` (with no `route`), which says strictly more than collapsing it to `unavailable` would.
- `/ai` improves for the stub case: an occupied-but-unserveable slot used to fall through to a 503 "AI service routes not yet initialized" and lose the `GET /ai/agents` empty-list answer the console polls for on every navigation. Both are restored.

No change for a host whose services are real implementations. If you register your own stub under one of those six slots and relied on the dispatcher calling it, either drop the `handlerReady: false` self-declaration (declare `degraded` if it genuinely serves) or install the real service. Not gated, deliberately: `/data`, `/meta`, `/auth` and the security path — their dev stubs back the dev stack's own core loop, and gating them would 404 the dev stack itself.

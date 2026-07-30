---
'@objectstack/core': patch
'@objectstack/plugin-dev': patch
'@objectstack/runtime': patch
---

Every in-memory fallback and dev stub now self-describes with the standard `__serviceInfo` descriptor, classified by what it actually is (#4058 step 1).

ADR-0076 D12 gave services one way to say "I am not the real thing", but the producers never converged on it:

- The kernel's own fallbacks (`createMemoryCache` / `Queue` / `Job` / `I18n` / `Metadata`) carried `_fallback: true` — a marker **no** consumer recognized, `readServiceSelfInfo` included — so both discovery builders reported them as fully `available`.
- `plugin-dev` marked all of its implementations with the same `_dev: true`, normalized to `status: 'stub', handlerReady: false`. That declared a working in-memory search index exactly as fake as an AI stub returning invented text.

Both now carry `__serviceInfo`, split by a rule that holds across the whole set:

- **`degraded`** — really does the work, with reduced capability: `cache`, `queue`, `job`, `file-storage`, `search`, `i18n`, `metadata`, `workflow`, `realtime`. Its answers are true answers; the `message` names what is missing (no persistence, no scheduling timer, no state-machine validation, …).
- **`stub`** — the answer is fabricated: `ai`, `automation`, `notification`, `data`, `auth`, `security.permissions`, `security.rls`, `security.fieldMasker`. Never to be mistaken for a capability.

`handlerReady: false` is set independently wherever no HTTP handler serves the slot (`cache` / `queue` / `job` / `realtime`, and every `stub`).

Discovery output changes accordingly — a kernel fallback that used to report `status: 'available'` now reports `degraded` with an explanatory message. No routing, gating, or dispatch behavior changes: every dispatcher domain still resolves services exactly as before. Consumers reading `discovery.services.*` get the truth instead of a uniform claim.

For anything that duck-typed the old markers: `svc._fallback` / `svc._dev` → `readServiceSelfInfo(svc)` from `@objectstack/spec/api` (the legacy `_dev` key is still understood by that reader, so third-party stubs carrying it keep working).

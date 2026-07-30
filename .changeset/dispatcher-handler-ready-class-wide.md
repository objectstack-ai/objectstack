---
'@objectstack/plugin-dev': patch
'@objectstack/runtime': patch
'@objectstack/metadata-protocol': patch
---

Gate every dispatcher service domain on `handlerReady`, not on slot occupancy, and give each plugin-dev stub its own honesty class (#4058).

#4000 made the `/analytics` domain execute ADR-0076 D12's third conclusion ("consumers treat only `handlerReady: true` as a real capability") but left the other domains gating on "is a service registered", so a self-declared stub occupying `automation` / `notification` / `ai` / `file-storage` / `i18n` was still called like a real implementation. The blocker to generalizing it was that every plugin-dev stub carried the single `_dev: true` marker, which normalizes to `status: 'stub'` — one label for "invents answers" and for "really does the work, in memory", so no gate could tell the two apart.

- **Each dev stub declares its own class** via the standard `__serviceInfo` marker: `degraded` for the fakes that really do the work (`cache`, `queue`, `job`, `file-storage`, `search`, `i18n`, `realtime`, `workflow`, `metadata`) and `stub` for the ones that fabricate (`data`, `auth`, `security.*`, and the shapeless placeholder used for a slot with no factory). `_dev: true` stays as the plugin-dev provenance tag; `__serviceInfo` decides the class.
- **The dispatcher-owned domains** (`/analytics`, `/automation`, `/notifications`, `/ai`, `/storage`, `/i18n`), the route-mount gate, discovery's `routes`/`features`, and the metadata-protocol builder's route advertisement all read one predicate (`isServiceServeable`): a slot whose occupant self-declares `handlerReady: false` is answered exactly like an empty slot — the domain's existing 404 or 501 — so what is advertised and what is served cannot disagree. A `degraded` implementation defaults to `handlerReady: true` and keeps serving, which is why `/storage` and `/i18n` are unaffected.
- **`discovery.services.*` stays presence-gated**: a registered stub still reports `{ enabled: true, status: 'stub', handlerReady: false }` (with no `route`), which says strictly more than collapsing it to `unavailable` would.
- `/ai` improves for the stub case: an occupied-but-unserveable slot used to fall through to a 503 "routes not yet initialized" and lose the `GET /ai/agents` empty-list answer the console polls for. Both are restored.

FROM → TO for dev setups that relied on a retired stub. `plugin-dev` no longer registers `automation`, `notification` or `ai` (joining `analytics` from #4000) — each one's headline method reported success for work that never happened (`execute()` → `{ success: true }` with no flow run, `send()` → a messageId for a message nobody receives, `chat()` → a placeholder answer). Install the real service instead: `@objectstack/service-automation`, `@objectstack/service-messaging`, or an AI service. Nothing changes for `os serve` / `os dev`, where `messaging` and `analytics` are already in `ALWAYS_ON_CAPABILITIES`. Deliberately unchanged: the `data` / `auth` / `security.*` dev stubs keep their slots (the dev stack's core loop resolves them) — they are now honestly labelled `stub`, but their domains are not gated.

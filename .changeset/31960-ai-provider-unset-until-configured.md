---
'@objectstack/service-settings': patch
---

fix(service-settings)!: Setup → AI shows no provider until one is configured, and no longer offers or saves the Memory echo provider (#31960)

Clause-②: no (narrowing) — three served answers narrow. `PUT /api/settings/ai` (`SettingsService.setMany('ai', …)`) with `provider: 'memory'` answered 200 and now answers `400 SETTINGS_VALIDATION` with the existing `invalid_option` field error at `provider`. `POST /api/settings/ai/test` on the built-in Test connection handler (the one in force when no AI runtime replaces it) with no provider answered 200 `ok: true` and now answers `400 SETTINGS_ACTION_FAILED` saying no provider is configured. `OS_AI_PROVIDER=memory` was in force and is now reported IGNORED, so `ai.provider` resolves from the next layer. `GET /api/settings/ai` on an install with nothing stored serves `values.provider` as `{ value: null, source: 'default' }` instead of `'memory'`, and the served manifest's `provider` select carries no `default` and no `memory` option. A real provider saves, reads and tests exactly as before.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema, export or metadata type changes: ai.provider keeps its declaration and loses one option value and its default. A provider row already stored as memory is not rewritten; it is served as stored, as any stored value outside a narrowed option table is, so there is nothing at rest for a migration to rewrite. -->

**BREAKING** accept-set narrowing at the AI settings doors.

- **Before.** On a host with no AI provider configured, Setup → AI & Embedder showed "Memory (echo — testing only)" as the chosen provider while the AI runtime reported AI as disabled. Saving Memory answered "Settings saved", and chat still answered that AI is not configured.
- **Now.** The provider select is empty until a provider is chosen. Memory is not offered, and saving it is refused.
- FROM `provider: 'memory'` (Setup, `PUT /api/settings/ai`, or `OS_AI_PROVIDER=memory`) TO a real provider (`gateway`, `openai`, `anthropic`, `google`, `deepseek`, `dashscope`, `cloudflare`, `siliconflow` or `openrouter`) with its API key, or no provider at all: the Memory echo adapter never enabled AI on a server.
- FROM reading `ai.provider` as `'memory'` when nothing is configured TO reading `null` (`source: 'default'`).
- **Already saved Memory.** The stored row is kept and served as stored. Other AI settings still save. Choose a real provider, or use "Reset to environment defaults", to replace it.
- The generation-default and conversation-title fields no longer hide when the provider is Memory; they always show.

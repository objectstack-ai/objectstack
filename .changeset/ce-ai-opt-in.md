---
"@objectstack/cli": minor
"@objectstack/spec": minor
---

feat(cli): make the AI service opt-in via a declared dependency; honor `config.tiers`

**AI edition boundary (cli).** The CLI auto-registered the headless `AIServicePlugin`
whenever the `ai` tier was enabled (default) and `@objectstack/service-ai` was
merely *resolvable*. In a workspace/monorepo the package is hoist-resolvable even
when an app does not declare it, so every app got the AI service — discovery
reported `services.ai: available` and the agent runtime served any
metadata-defined agents — including Community-Edition apps that ship no AI.

Now the *declared* dependency is the boundary: AIService auto-registers only when
the host app declares `@objectstack/service-ai` **or** `@objectstack/service-ai-studio`
(Studio attaches its personas via the base service's `ai:ready` hook, so declaring
Studio implies the base). A CE app that declares neither gets no AI service, no
agents, and `services.ai: { enabled: false, status: 'unavailable' }` in discovery
(so the console hides its AI surface). MCP and every other capability are
unaffected. The `app-showcase`/`app-crm` examples now declare `@objectstack/service-ai`.

**`config.tiers` now honored (spec).** `ObjectStackDefinitionSchema` gains a `tiers`
field, so `defineStack` no longer strips it. `config.tiers` (e.g. a list WITHOUT
`ai`) now actually overrides the `--preset` default — previously it was silently
dropped by schema validation, making the `--preset` help text inaccurate. This is
a second, in-place way to disable AI for a deployment without touching dependencies.

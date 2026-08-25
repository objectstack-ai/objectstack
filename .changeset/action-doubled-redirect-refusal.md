---
"@objectstack/spec": minor
"@objectstack/runtime": patch
---

feat(spec,runtime): refuse the doubled post-success navigation channel on a `type: 'script'` action (#11519)

**BREAKING** accept-set narrowing on `ActionSchema`, shipped as `minor` under
the repo's launch-window convention for breaking changes.

Two independent channels could name a post-success destination for one
`type: 'script'` action: the declared `onSuccess` block (`{ navigate, openIn }`,
validated and visible in metadata) and the handler-returned `{ redirectUrl }`
convention (runtime-only). The spec ruled each surface's default in isolation
and said nothing about an action carrying both — so the renderer had to pick,
and the pick lived only in one renderer's implementation (declared `onSuccess`
wins, objectstack-ai/objectui#5933). Maintainer ruling 2026-08-24: refuse the
doubled channel; ⛔ no `precedence` contract field.

The measured static-knowability partition:

- **Authoring-time refine (spec):** "the handler can return `redirectUrl`" is
  runtime-only in general (`target` names an opaque registry entry;
  `HookBodySchema` declares no return contract) — but `opensInNewTab: true` is
  a schema-visible declaration of the handler-redirect channel (its contract is
  "pre-open a tab, then drive it to the handler's returned `redirectUrl`").
  A `type: 'script'` action declaring `onSuccess` beside `opensInNewTab: true`
  is now **rejected at parse time**, with guidance naming both channels and the
  remedy. Previously the pair parsed clean and one declaration was silently
  dead at render.
- **Dispatch-seam diagnostic (runtime):** the runtime-only remainder — a
  handler that actually returns `{ redirectUrl }` while the action declares
  `onSuccess` — now logs a loud `[action-contract]` warning at both dispatch
  surfaces (the REST `/actions` route and the MCP `run_action` bridge), naming
  the action, both channels, the interim winner and the remedy. Observe-only:
  the wire is untouched and the interim renderer precedence stands until the
  author takes the remedy.

Single-channel declarations are untouched and pinned byte-identically: only
`onSuccess`, only `opensInNewTab` (with or without `newTabUrl`), and
`opensInNewTab: false` beside `onSuccess` all parse exactly as before. The
corpus was measured at zero doubled producers (this repo's examples and
platform metadata, objectui metadata, and the cloud SSO handoff producers per
the #11519 measurement), so no shipped metadata is affected.

**Migration.** An action refused by the new refine must pick its one
destination: keep `onSuccess` and drop `opensInNewTab` (and stop returning
`redirectUrl` from the handler), or keep `opensInNewTab` + the handler
redirect and drop `onSuccess`. Which channel is right is an authoring decision
the metadata cannot make for you, and zero such actions exist in any measured
corpus.

<!-- adr-0087: not-required (no-migration-prescription) A validity narrowing over a pair of existing keys: no key is removed, renamed or re-shaped, so there is no tombstone and nothing mechanical for `objectstack migrate meta` to rewrite. The refusal is the channel that reaches an affected author, at the parse site, carrying the remedy; choosing which of the two declared destinations to keep is an authoring decision no migration entry can perform on an upgrader's behalf — and the measured population of affected sources is zero in every corpus. -->

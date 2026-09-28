---
'@objectstack/spec': minor
---

fix(spec): `defineStack` refuses an auto-launched flow whose stack declares `triggers` without `automation` — the pair installs the trigger, `triggers` alone installs nothing (#20332)

Clause-②: no (narrowing)

**BREAKING** — shipped as `minor` under the launch-window convention
(`check-changeset-no-major` refuses `major` until GA; breaking-ness is carried by
this banner and the ADR-0087 disposition below, never by the level).

**What is refused now.** A stack whose `requires` includes `'triggers'` but not
`'automation'`, and which declares a `record_change`, `schedule`,
`time_relative` or `api` flow, used to pass `defineStack` and `os validate`,
boot, and never fire the flow. Every trigger plugin installs its trigger into
the automation service when the kernel is ready, and without that service it
logs `automation service not available — … trigger NOT installed` and installs
nothing. No runtime resolves `triggers` into `automation`. `defineStack` now
refuses that stack with the same `STACK_TRIGGER_CAPABILITY_REQUIRED` code
(`status: 422`), one finding per flow:

```text
flow 'task_fanout' declares a 'record_change' trigger but `requires` does not include 'automation' — 'triggers' installs the 'record_change' trigger into the automation service, and without it no 'record_change' trigger would be registered, so the flow would never auto-launch. Add 'automation' to requires: ['automation', 'triggers'] (@objectstack/service-automation runs the flow; @objectstack/trigger-* only fires it).
```

**The fix is the one the message names:** add `'automation'` to `requires`, so
it reads `requires: ['automation', 'triggers']`. Nothing is renamed or removed.

**Also changed: the message for a stack that declares neither token.** An empty
or absent `requires` with such a flow was told to add `requires: ['triggers']`,
which would now be refused a second time. It is told to add both:

```text
flow 'task_fanout' declares a 'record_change' trigger but `requires` does not include 'automation' or 'triggers' — no 'record_change' trigger would be registered, so the flow would never auto-launch. Add requires: ['automation', 'triggers'] (record_change/schedule/time_relative/api ship in @objectstack/trigger-* and install into @objectstack/service-automation — 'triggers' alone installs nothing).
```

Unchanged: `requires: ['automation']` with such a flow keeps the message it has
always had (add `'triggers'`), word for word. `requires: ['automation',
'triggers']` is accepted, in any order. A stack with no auto-launched flow
(none at all, a `screen` flow, or an `autolaunched` flow started by hand) owes
neither token, and `obsolete` / `invalid` flows are still skipped. The refusal
code, the message header and the `issues` shape are the same, and no export is
added.

In-tree producers measured: `examples/app-showcase` and `examples/app-todo`
already declare both tokens; `examples/app-crm` and the `create-objectstack`
`blank` template declare `automation` without `triggers` and no auto-launched
flow, so they are untouched.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authored is renamed, removed or re-typed: no spec key changes spelling, no export moves and no stored shape changes, so `objectstack migrate meta` has nothing to rewrite. The refusal is a cross-field requirement between `requires` and `flows`, and its own message names the one-token fix. This follows the disposition of the refusal's first arm. The other categories are closed on facts: `@objectstack/spec` publishes (not `unpublished`); no ADR-0087 id covers a capability requirement (not `registered` / `already-registered`); and the change is authoring validation, not a TypeScript declaration (not `runtime-interface-only` / `type-surface-only`). -->

---
"@objectstack/spec": major
---

refactor(spec)!: retire `HookContext.session.roles` — declared, read by two dead branches, never produced (#5050)

`session.roles` on the runtime hook context was ADR-0049's enforce-or-remove
case with **neither end**: it was declared in `data/hook.zod.ts`, read by
exactly two consumers, and produced by nobody. The two readers were
plugin-approvals' admin exemptions — the approval record lock and the delegation
write guard, each opening with `session.roles?.includes('admin')` — and both
were deleted in #4839 (PR #5049) on the maintainer's ruling. The producer side
was empty the whole time: ObjectQL's `buildSession()` builds the session field
by field (`userId`, `organizationId`, `accessToken`, `isSystem`, `actor`, the
skip flags) and has never written `roles`, and nothing else feeds a
HookContext. So every read resolved `undefined`,
and a guard keyed on it was dead code that merely LOOKED like an authorization
decision — plus a second admin dialect competing with the one ADR-0090 D3 /
ADR-0095 D3 sanction.

Cross-repo consumer check ran in both directions before removing anything
(#4895's discipline, after #4865's tombstone was disproven by objectui):
`cloud` has zero `session.roles` while its hook consumers really do read
`hookContext?.session?.userId` (`service-cloud/src/marketplace-visibility-plugin.ts`,
`control-plane-org-scope-plugin.ts`) — a positive control in the same run;
`objectui` has zero, and its `roles` are the `/auth/me` **user** payload, a
different surface that is untouched.

One neighbour is called out rather than folded in, because mistaking it for a
producer would read as refuting the whole finding (#4865's lesson): an **action**
body's `ctx.session` is a different, untyped object built by `runtime`'s
`buildActionSession()`, and it does populate a `roles` key from `ec.positions`.
It never becomes a HookContext and no schema types it, so it is neither evidence
against this retirement nor fixed by it — it is filed and tracked apart.

**Nothing observable changes.** A key nobody wrote and nothing read cannot alter
a single decision — this is the declaration catching up with the runtime, not a
behaviour change.

FROM → TO:

- `HookContext.session.roles` (`@objectstack/spec/data`) → removed. Delete the
  key. To gate a hook on the caller, read `ctx.session.userId` /
  `ctx.session.isSystem`; to judge PRIVILEGE, ask the security service, which
  evaluates capability grants (`permissions`), placements (`positions`) and the
  derived posture off the execution context (ADR-0095 D3) — never a role-name
  string comparison.

The retirement kit: the key is **tombstoned**, not deleted, because
`HookContextSchema` is deliberately not `.strict()` (strictness there would turn
an engine-internal enrichment into a breaking change for anyone parsing a
context they were handed, as `provenance` was in #3712) — a plain delete would
have stripped it in silence, the #3733 / ADR-0104 failure. `retiredKey()` gives
both channels instead: `tsc` types the key `never` at any producer, and a parse
raises the prescription itself. There is **no** ADR-0087 D2 conversion and
nothing for `os migrate meta` to rewrite: a HookContext is built per operation
by the engine and never stored, so no `sys_metadata` row, example or template
can carry the key — the `openApi31` (#4579) / `activationEvents` (#4657) shape,
registered as the `hook-context-session-roles-retired` **semantic** migration at
major 17 so the prescription still reaches `spec-changes.json`, the generated
upgrade guide and the `spec_changes` MCP tool. The four export/def ratchets are
unchanged by design: this narrows a nested key inside a surviving def, which
`api-surface.json`, `authorable-surface.json` (whose walk records top-level keys
per def), `api-surface-signatures.json` and `json-schema.manifest.json` are all
blind to — the enum-narrowing reading of the two, not the whole-def one.

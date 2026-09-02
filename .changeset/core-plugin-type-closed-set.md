---
"@objectstack/core": minor
---

feat(core): `Plugin.type` is the closed set the spec declares — a `PluginType` derived from `CORE_PLUGIN_TYPES` (#13925)

**BREAKING** accept-set narrowing on a published type, shipped as `minor`
under the repo's launch-window convention for breaking changes. `Plugin.type`
(and, through it, `PluginMetadata.type`) was declared `string`, so nothing
type-checked a plugin author against the eight values the platform accepts —
the TSDoc beside it carried the whole enumeration as prose, and prose drifted.
Maintainer ruling 2026-09-01: the Zod enum in `@objectstack/spec`
(`PluginSchema.type`, declared `z.enum(['standard', ...CORE_PLUGIN_TYPES])`)
is the authority and the contract was always a closed set; the `string` in
core was the mismatch, and narrowing it is core aligning to the declared
contract rather than a new restriction. Paid in one stroke — no warning window.

What changes:

- `@objectstack/core` now exports `PluginType`, derived from the spec's own
  constant: `'standard' | (typeof CORE_PLUGIN_TYPES)[number]` — today
  `standard`, `ui`, `driver`, `server`, `app`, `theme`, `agent`, `objectql`.
  It is not re-spelled in core, so the compiler's accept set and the Zod gate's
  cannot drift apart; a runtime parity test pins the two against each other.
- `Plugin.type` is typed `PluginType`. A literal outside the set, or a value
  typed `string`, no longer compiles. Runtime behaviour is unchanged: the Zod
  gate refused such a value before and still does (`invalid_value` at `type`).

**Migration.** A plugin that declares one of the eight members needs no change.
A plugin that assigned a computed or `string`-typed value narrows it at the
producer — declare the literal, or type the variable `PluginType` — rather than
casting at the assignment; a value that was never one of the eight was never a
valid plugin type and was already refused at parse time.

<!-- adr-0087: not-required (no-migration-prescription) A TypeScript narrowing on a published runtime interface, aligning `packages/core` to the accept set `packages/spec` already declared. No metadata key, spec symbol, Zod schema, object definition or stored representation is added, removed or renamed — `CORE_PLUGIN_TYPES` and `PluginSchema.type` are read, not changed — so `objectstack migrate meta` has nothing to rewrite and there is no tombstone to mint. The channel that reaches an affected author is the compiler, at the assignment, which is more precise than a ledger line; which member a formerly `string`-typed value should become is authoring intent no migration entry can decide. The in-repo census under the workspace typecheck is recorded on the PR. -->

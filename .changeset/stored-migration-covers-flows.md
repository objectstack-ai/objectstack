---
"@objectstack/service-automation": minor
"@objectstack/metadata-protocol": minor
"@objectstack/cli": patch
---

feat(automation,migrate): `os migrate meta --stored` now covers flow rows too (#4454)

#4327 gave the stored-metadata conversion chain a finish line for every
metadata type except `flow` — the one type where the most stored dialect
actually lives, since the graduated conversions `flow-node-crud-filter-alias`,
`flow-node-crud-object-alias`, `flow-node-notify-config-aliases` and
`flow-node-script-config-aliases` are all flow-node entries. Flow-node
conversions carry ADR-0078's open-namespace conflict guard, which has to consult
the *live* executor registry to tell a rename from a clobber, and the metadata
layer has no way to obtain one. Flows were reported `skipped` with that reason.
They are now converted.

**One canonicalization policy, two shapes.**
`AutomationEngine.canonicalizeStoredFlow` is the single implementation and
`registerFlow` calls it, so the load seam and the migration can never disagree
about what "canonical" means. It returns `parsed` (for execution — the
`FlowSchema.parse` + #4347 region output, schema defaults materialized) and
`storable` (for persistence).

**`storable` excludes schema defaults, and that is the load-bearing decision.**
Measured rather than assumed: driving a pre-17 flow through all three steps
*removes* nothing — `FlowSchema` is strict since #4001, so an unrecognized key
throws instead of being silently dropped, which means the
`graftNormalizedOperators` precedent (it exists because the *view* parse strips
Studio-only auxiliary keys) does not transfer — and *adds* only defaults:
`version`, `runAs`, per-edge `type` / `isDefault`. Persisting a default the
author never wrote would pin every migrated row to today's value while untouched
rows follow tomorrow's: two populations with different behaviour, which is
exactly the drift this pass exists to remove. So the write-back is the
conversion result plus the `{dialect, source}` envelopes the schema derives for
edge conditions, and nothing else.

One subtlety worth knowing if you extend this: that envelope is a schema
transform, not a conversion, so it emits **no** notice while still changing the
body. Reading notices alone — correct for every other metadata type — would call
such a row canonical and leave it re-deriving on every boot. Both passes are
copy-on-write, so identity is the exact test for flows.

**New: `AutomationServicePluginOptions.armRuntime`** (default `true`, so every
server, dev stack and test host is unaffected). Set `false` and the plugin
brings up the engine and the complete node registry — built-ins plus whatever
`automation:ready` contributes, because a *partial* registry would make the
conflict guard read a live custom node type as unowned and rewrite over it — and
then stops before anything is armed:

| Skipped when `armRuntime: false` | Why it must be |
|---|---|
| flow pull + `kernel:ready` / `metadata:reloaded` re-sync | `registerFlow` calls `activateFlowTrigger` — record triggers and scheduled jobs would go live |
| declarative connector materialization | opens real connections; an MCP provider spawns a child process |
| suspended-run wait-timer re-arm | would resume someone's paused approval mid-migration |

`os migrate meta --stored` boots the plugin in that mode. A migration process
must not become a second server.

A refused rename — the guard firing because the old node-type token is a live
name something else owns in this environment — fails that row loudly, naming the
token and its owner. Never a silent skip, never a clobber. A flow that cannot
canonicalize at all (a strict-schema violation, a malformed control-flow region)
is reported as failed with the parse message rather than persisted as a guess;
such a row cannot register today either, so the report is telling you about a
flow that is already broken at runtime.

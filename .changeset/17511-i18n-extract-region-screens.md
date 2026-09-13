---
'@objectstack/cli': patch
---

`os i18n extract` reaches a `screen` node nested inside an ADR-0031 flow region

`walkScreenFlows` (`packages/cli/src/utils/i18n-extract.ts`) iterated
`flow.nodes` flat, so a `type: 'screen'` node inside a region —
`loop.config.body`, `parallel.config.branches[].nodes`,
`try_catch.config.try` / `.catch`, nesting arbitrarily — was never reached. It
emitted **no** `flows.NAME.screens.NODE_ID.title` / `.fields.*` skeleton entry
and **no** coverage row.

**Why that pairing is the defect and not just a missing translation.** A nested
wizard step is a real screen: the executor pauses on it and the client receives
its `ScreenSpec.nodeId`, so `translateFlow` overlays the bundle onto it and the
key is live. With no entry emitted, a translator was never shown the key AND
`os lint` / `pnpm check:i18n-coverage` had no row to demand — the gap was
invisible to the mechanism built to report gaps. A green i18n gate on a tree
whose nested steps render source-locale text was green because the surface was
unreachable, not because the app was translated.

The node universe now comes from a region-aware descent that reads the one
shared declaration of WHERE a region lives, `FLOW_REGION_SLOTS_BY_TYPE` from
`@objectstack/spec/automation` — the same table `packages/lint`'s
`walkFlowNodes` reads. No local copy of the slot list is introduced: a second
region table in a fourth package is the very shape this defect is an instance
of.

**Depth deliberately does not enter the key.** Entries stay
`flows.NAME.screens.NODE_ID.*` at every depth, because `lookupFlowScreenCopy`
is keyed by node id alone and the bundle schema knows nothing about depth; a
region path segment would offer a key nothing resolves. A node id repeated at
two depths therefore addresses one bundle slot and collapses to a single entry
(first emission wins, outer before inner) — one slot can serve only one string,
and the resolver overlays that string onto both nodes.

Seeding is unchanged and applies at every depth: a screen `title` falls back to
the node `label` (what `ScreenSpec.title` draws), and a field `label` falls back
to its `name` as a *derived* seed, so the skeleton stays usable while the
coverage gate demands no translation of a string nobody authored.

⛔ No authorable key, bundle shape or export moves — an author who wrote a
nested screen now gets scaffolding and a coverage row where both were silently
absent. Existing keys are byte-unchanged.

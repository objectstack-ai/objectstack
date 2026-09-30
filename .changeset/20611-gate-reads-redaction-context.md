---
'@objectstack/lint': minor
'@objectstack/metadata-protocol': minor
---

The runtime metadata publish gate refuses an `api` flow with no per-flow secret, and reads a secret the flow read path withheld as present (#20611).

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable changes spelling or type: `packages/spec` is untouched, and the start node `config` stays the open record it was. What changes is that the runtime metadata write door now refuses one authored shape at publish: an `api`-bound flow whose start node carries no usable `config.secret`. `objectstack migrate meta` could not rewrite that shape even in principle, because the missing value is a shared secret only the author and the sending system can supply. Rows at rest are not judged or rewritten; the automation engine has refused to register such a flow since 17.5.0, and that load path's disposition is recorded in its own published changelog entry. -->

**BREAKING** — an accept-set narrowing on the runtime metadata write door,
shipped as `minor` under the launch-window convention (`check-changeset-no-major`
refuses `major` until GA; breaking-ness is carried by this banner and the ADR-0087
disposition above, not by the level). An `active` save through `/meta` of an
`api`-bound flow whose start node carries no usable `config.secret` (a
`PUT /api/v1/meta/flow/:name`, or the publish of such a draft) used to be stored;
the automation engine then refused to register it (`400` on the `/automation`
doors, a skip with a warning at boot). It is now refused at the save with
`422 INVALID_METADATA`, the issue naming `flow-api-trigger-secret-missing` at the
start node's `config.secret`, and nothing is stored. A draft save is still
accepted; its publish is refused the same way.
**One-line fix:** set a non-blank `config.secret` on the flow's start node — or,
for a flow that is only ever started explicitly, declare `type: 'autolaunched'`
with no `triggerType: 'api'`.

**What does not change: a signed flow's round trip.** Every served flow definition withholds the start node's `config.secret`, so a body saved back after a read arrives without it, and the save restores the stored secret only after every gate has run, so that no gate handles a restored credential. The gate is now told WHERE the save will restore a credential from the stored row: those positions only, never the values. `flow-api-trigger-secret-missing` reads a secret that was withheld and is stored as present, and one that is absent and not stored as missing. So a GET → edit → PUT of a signed flow, and the first save of a code-authored flow whose secret is in the app's source, keep passing and keep their secret. An explicit empty `config.secret` is the author's own value and is refused as blank.

`@objectstack/lint`:

- `validateFlowApiTriggerSecret` now runs on the runtime publish gate too (`surfaces` `['cli', 'runtime-publish']`, `runtimeTypes: ['flow']`). Its `surfaceReason` is gone.
- `AuthoringRuleContext` gains an optional `restoredCredentialPaths`: a `ReadonlySet<string>` of stack-relative positions in the rules' own finding-path spelling (`flows[0].nodes[1].config.secret`). Only the runtime publish gate sets it; `runAuthoringRules` never forwards it, so `os validate`, `os build` and `os lint` judge the author's own values as before.
- `runRuntimeAuthoringRules` accepts an optional `restoredCredentialPaths`: item-relative dotted positions in the `@objectstack/spec/kernel` redactor registry's `redactedKeys` spelling (`nodes.1.config.secret`). The gate re-spells them against the written item's place in its snapshot.
- `validateFlowApiTriggerSecret(stack, options?)` accepts an optional `{ restoredCredentialPaths }`, and treats a listed start-node secret position as present.

`@objectstack/metadata-protocol`: `saveMetaItem` hands the runtime authoring gate the positions its own credential carry-forward will fill, computed from the same stored body. This costs one indexed `sys_metadata` read on an `active` save of a type with a registered redactor (`datasource`, and `flow` where the automation plugin registers one), and nothing for any other type or for a draft save. The carry-forward itself is unchanged and still runs after every gate. The draft→active promotion judges the stored draft row, which already holds what that draft's save carried forward, so it needs no such positions.

---
"@objectstack/spec": major
---

refactor(spec)!: remove the `plugin-runtime.zod` family — the "Dynamic Loading" vocabulary no runtime ever implemented (#4834, ADR-0049)

`DynamicLoadRequestSchema`, `DynamicUnloadRequestSchema`,
`DynamicPluginResultSchema`, `PluginSourceSchema` and
`DynamicPluginOperationSchema` — with every type alias — are **removed from
`@objectstack/spec` and `@objectstack/spec/kernel`**. The module they lived in
is deleted.

Together they declared the platform's "Dynamic Loading" capability: runtime
load / unload / reload of plugins **without restarting the kernel**, resolved
from `npm` / `local` / `url` / `registry` / `git` sources, with Subresource
Integrity hashes, per-plugin sandboxing, `graceful` / `forceful` / `drain`
unload strategies and `cascade` / `warn` / `block` dependent policy. **None of
those operations exists.** A bare-name scan of objectstack, cloud and objectui
(at the commits above) found zero references outside this package's own
declaration, its unit tests and the generated artifacts: no runtime ever
received a `DynamicLoadRequest`, performed a load or an unload, or produced a
`DynamicPluginResult`. Plugins are composed at boot — `defineStack` registers
them and the kernel runs `init` → `start` — and the set is fixed until the
process restarts.

This closes a suspension that has been open, and undocumented outside one
paragraph, since #3896. That change removed this module's discovery/sandbox
config island and wrote down that "the remainder … also has no runtime consumer
today; it is left in place because those are operation contracts, not security
promises, and the enforce-or-remove call on them is a design decision rather
than a correction." That decision lived only in a changeset, carried by no
issue. #4834 is the decision, and the answer is **remove**: `experimental` was
weighed and rejected because it is `.describe()` prose that cannot stop an
`import` — the weakest of ADR-0049's three channels — and because a
request/result vocabulary published into the IDE bundle is precisely what an AI
author (ADR-0033) reads as proof the platform hot-loads plugins, then builds a
request that parses clean and is received by nobody (#3950).

Migration (FROM → TO):

- `import { DynamicLoadRequestSchema, DynamicUnloadRequestSchema,
  DynamicPluginResultSchema, PluginSourceSchema, DynamicPluginOperationSchema }
  from '@objectstack/spec/kernel'` (or from `@objectstack/spec`) →
  **no replacement export.** Every one is `TS2305: Module … has no exported
  member` after upgrade, on every public entry. Same for the type aliases
  `DynamicLoadRequest`, `DynamicUnloadRequest`, `DynamicPluginResult`,
  `PluginSource`, `DynamicPluginOperation`, `DynamicLoadRequestInput`,
  `DynamicUnloadRequestInput`.
- A **`DynamicLoadRequest` / `DynamicUnloadRequest` value** you built → delete
  it, along with whatever was going to send it. There was never a recipient;
  the code that constructed one was already a no-op with extra steps. To get a
  plugin into a running system, put it in the stack (`defineStack`) and restart.
- A **`DynamicPluginResult`** you typed a handler against → delete the handler.
  Nothing ever produced one.
- **`activationEvents` inside a `DynamicLoadRequest`** — the key #4657
  tombstoned one release-candidate earlier — now has a *stronger* answer than
  that tombstone gave. #4657 told you: delete this key from your
  `DynamicLoadRequest`. **The correct instruction is now: delete the entire
  `DynamicLoadRequest`.** The shape that carried the key is gone, so its
  `retiredKey()` prescription is gone with it — legitimately, because "this
  request shape does not exist" is strictly stronger than "this one key of it
  does not exist". If you are upgrading from v16 and wrote `activationEvents`
  in *either* form (v16 strings `['onMetadataType:flow']`, or the v17-rc
  structured `[{ type, pattern }]` from #4653), you do not need to migrate the
  key at all — the value it sat in has no shape and no recipient.
  **The studio half of #4657 is unaffected**: `StudioPluginManifest`
  (`defineStudioPlugin`) is a live authoring surface and still rejects
  `activationEvents` with its own prescription. Delete the key there.
- Runtime plugin loading is a **new capability**, not a restoration: if it is
  ever built it returns via the enforce route of ADR-0049 through a new ADR —
  loader first, vocabulary second. The shapes it needs are unlikely to be these
  ones, which is itself a reason not to keep them as a design constraint on
  work that has not started.

Self-check (#4535 §5):

1. **TS2305 / TS2339 — what exactly breaks?** TS2305 on twelve names, at two
   entry points (`@objectstack/spec` root and `@objectstack/spec/kernel`) — the
   five `*Schema` consts and the seven type aliases listed above. No TS2339:
   nothing removed was a *property* of a surviving shape, because the removed
   defs were embedded in no parent schema. `PluginSource` was reachable only as
   `DynamicLoadRequest.source` and `DynamicPluginOperation` only as
   `DynamicPluginResult.operation`, both of which go in the same change.
2. **Metadata migration — is there any?** No, and none is possible. All five
   are root request/result payload shapes: no metadata-type root reaches them
   (`gen:schema`'s reachability BFS says so — see the gate output below), no
   `sys_metadata` row can carry one, and no `.stack.ts` / `objectstack.config.ts`
   authoring surface embeds one. There is therefore no source for an ADR-0087
   **D2** conversion to rewrite, and `os migrate meta` would have nothing to
   match. Registered instead as an ADR-0087 **D3** semantic migration,
   `plugin-runtime-family-retired`, which is where a removal with no rewritable
   source belongs — the same disposition as #4616, #4767 and #4783. The
   pre-existing D3 entry `plugin-activation-events-retired` (#4657) is
   **corrected, not deleted**: its studio half is still live and its historical
   record must keep replaying, so its kernel half now records this supersession
   rather than continuing to promise a tombstone that no longer exists.
3. **Shape change — what kind?** Pure removal of five whole defs; zero
   additions, zero narrowings, zero renames. Runtime behaviour is unchanged in
   the strongest sense available: not "equivalent", but *identical*, because no
   code path anywhere consumed any of it.

The retirement kit: whole-def removal (#4650 route 3 — the defs stop being
emitted, adjudicated by the `json-schema.manifest.json` ratchet (#2978) and
`check:api-surface`, not by the per-key tombstone ratchet, which reported all 23
`authorable-surface.json` deletions as carrying their own proof); no
`retiredKey()` tombstones, deliberately — nothing parses these schemas any more,
and a prescription nobody can receive is noise (the precedent this same module
set in #3896); ADR-0087 D3 semantic migration + the corrected #4657 entry;
baselines (`json-schema.manifest.json` −5 defs, `authorable-surface.json` −23
lines, `api-surface.json` −12 names, `spec-changes.json`,
`docs/protocol-upgrade-guide.md`, `content/docs/references/kernel/`) regenerated
from the rebuilt source rather than hand-edited; `PLUGIN_STANDARDS.md` §5.3 and
its capability table now say **Not built** instead of ✅; compiler-API export pin
(`plugin-runtime-retirement.test.ts` — zero holders for all twelve names across
every entry in the `package.json` exports map, with three anti-vacuity guards),
sabotage-verified.

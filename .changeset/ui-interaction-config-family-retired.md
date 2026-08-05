---
"@objectstack/spec": major
---

refactor(spec)!: retire the five `ui/` interaction config modules — a documented vocabulary with no carrier key anywhere (#4988)

`@objectstack/spec/ui` exported five interaction-configuration modules —
`touch.zod.ts`, `dnd.zod.ts`, `keyboard.zod.ts`, `animation.zod.ts` and
`offline.zod.ts` — carrying **22 `z.object` sites, 32 emitted defs and 64
exported names**. All five are removed, and their generated reference pages with
them.

Nothing in the protocol ever carried them. There was no `touch:` / `dnd:` /
`keyboard:` / `animation:` / `offline:` key on any schema, so no metadata
document could reach these shapes and nothing ever parsed one.

Three measurements, each re-run on `origin/main` immediately before the removal,
each with its controls passing in the same run:

1. **Static** — no module under `packages/spec/src` imported any of the five
   except the `ui/index.ts` barrel, so no schema declared a carrier key.
2. **Graph** — a BFS over the in-memory Zod graph from all 24 metadata-type
   roots plus `defineStack`'s `ObjectStackSchema` (25 roots, 4742 nodes) reached
   **none** of the 21 named object shapes, while `PageSchema`, `WebhookSchema`
   and `StateMachineSchema` all resolved `direct`, and injecting a synthetic
   carrier flipped all 21 to `direct`. So "unreachable" was a fact about the
   graph, not a broken walker.
3. **Call sites** — zero `.parse()` / `.safeParse()` in objectstack, objectui or
   cloud outside these modules' own unit tests. objectui holds type re-exports
   and parity ratchets, never validators, and says so (#2561).

**The defect was on the documentation side, and that is what made it urgent.**
`authorable-surface.json` listed **109 keys** under these defs and
`content/docs/references/ui/{touch,dnd,keyboard,animation,offline}.mdx` rendered
them as authoring tables. An AI author reading `dnd.mdx` and writing a `dnd:`
block onto a page component was rejected by `PageComponentSchema` for an
unrecognized key — the published docs and the schema disagreeing about what the
platform does (Prime Directive #10). This was never a strictness question:
`.strict()` is a property of a parse, and there was no parse.

Business ruling (2026-08-04): these five categories are **renderer built-in
behavior** — touch targets, drag-and-drop, focus and shortcuts, motion are
decided by the component library, not authored per page. Offline is a platform
capability whose vocabulary belongs on the sync engine that owns the queue, the
conflict policy and the cache, and that engine does not exist. Whichever of them
earns real product pull returns **with** its own vocabulary and its executor.

FROM → TO:

| removed | what to do instead |
|---|---|
| `TouchTargetConfig` / `GestureConfig` / `TouchInteraction` / `SwipeGestureConfig` / `PinchGestureConfig` / `LongPressGestureConfig` / `GestureType` / `SwipeDirection` | nothing to author — touch targets and gesture handling are the component library's behaviour |
| `DndConfig` / `DragItem` / `DropZone` / `DragConstraint` / `DragHandle` / `DropEffect` | nothing to author — drag-and-drop is renderer behaviour |
| `KeyboardNavigationConfig` / `KeyboardShortcut` / `FocusManagement` / `FocusTrapConfig` | nothing to author — focus order and shortcuts are renderer behaviour |
| `ComponentAnimation` / `MotionConfig` / `PageTransition` / `TransitionConfig` / `TransitionPreset` / `EasingFunction` / `AnimationTrigger` | nothing to author. (For theme-level CSS variables see `theme.customVars`; the theme `animation` block was separately retired at #5021) |
| `OfflineConfig` / `OfflineCacheConfig` / `SyncConfig` / `OfflineStrategy` / `ConflictResolution` / `PersistStorage` / `EvictionPolicy` | nothing to author — offline sync is unimplemented; its vocabulary arrives with the sync engine |

**No metadata document needs editing.** A stack that parsed before parses
byte-for-byte the same after: none of these blocks was writable in the first
place. The break is a TypeScript one — every removed name is `TS2305` on
`@objectstack/spec` and `@objectstack/spec/ui` after upgrade.

One name is worth checking explicitly: the bare **`ConflictResolution`**. #4738
renamed the connector-side enum to `ConnectorConflictResolution` *because*
`ui/offline.zod.ts` owned the bare name; that owner is now gone, so the bare name
is published by **nobody**. The #4738 rename stands — freeing a word is not a
reason to spend a second breaking change renaming back — and no domain re-adopts
it. If you consumed it as a type for your own offline code, declare that union
locally; it is your client's policy, not the platform's.
`@objectstack/spec/integration`'s `ConnectorConflictResolution` (connector sync)
and `@objectstack/spec/api`'s `ConflictResolutionStrategy` (route merge policy)
are different concepts and are untouched.

⚠️ `ui/animation.zod.ts` (`ComponentAnimation` / `MotionConfig` /
`PageTransition` / `AnimationTrigger`) is a **different surface** from the theme
`animation` block retired by #5021 — different file, different defs, different
manifest entries. That one had a carrier key and got a `retiredKey()` tombstone;
this one had none and gets deletion.

The retirement kit:

- **No `retiredKey()` tombstone, deliberately** — route 3 of the retirement
  playbook ("nothing parses it → neither"), as used by #4834 / PR #4878 (kernel
  plugin-runtime family) and #4938 / PR #5293 (`HttpServerConfig`). A tombstone
  is a message to whoever writes the key; with no carrier key there is no shape
  for one to sit on and no author who could ever receive it.
- **No ADR-0087 D2 conversion**, for the same reason: measured **zero** authored
  instances in `examples/**` and `apps/**` — necessarily zero, since the keys
  were unwritable — so there is no source for the chain to rewrite. The
  registered record is the **D3 `SemanticMigration`**
  `ui-interaction-config-family-retired`, with the protocol-17 step's rationale
  extended.
- **Whole-file deletion was checked per file, not assumed.** Each of the five
  was verified to have no surviving export with a live consumer (the #4938
  lesson: retire the shapes, keep the file when a sibling is alive). All 64
  names were in-family and unreachable, so all five files go.
- Baselines updated deliberately: `json-schema.manifest.json` (−32, the #2978
  ratchet fires first and demands each deletion), `authorable-surface.json`
  (−109, adjudicated by the #4650 gate's path 3 "def no longer emitted by this
  build"), `api-surface.json` (−64). Reference docs, `references/ui/meta.json`
  and the strictness-ledger counts regenerated.
- **Pins are bidirectional.** `ui/interaction-config-retirement.test.ts` asserts
  absence across every public entry by resolved symbol identity *and* the
  survival of the neighbours a too-wide sweep would take — first among them
  `ResponsiveConfigSchema`, batch 13's sixth file, which measured **reachable**
  (`page.components[].responsive`) and was tightened rather than retired.

No runtime behaviour changes. That impossibility is the reason for the removal.

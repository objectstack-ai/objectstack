# @object-ui/mobile

## 18.1.0

### Patch Changes

- Updated dependencies [8556295]
- Updated dependencies [cd14d8e]
- Updated dependencies [f1a4b08]
- Updated dependencies [1d178e0]
- Updated dependencies [6fb31dc]
  - @object-ui/types@18.1.0

## 18.0.0

### Major Changes

- 6f3299f: objectui moves to major 18, following `@objectstack/*` from 17 to 18 (objectui#12334). objectui's major is not a count of its own breaking changes: it tracks the major of the `@objectstack/spec` its packages depend on, so that the same major means compatible across the two projects. These packages already declare `@objectstack/*` on the 18 line (objectui#12030), so every package in the fixed release group crosses to 18 together. It is the one `major` that rule admits: objectui's own breaking changes ship as `minor`, described in their entries.
  
  The 18 line is released from Changesets pre mode on the `next` tag (`.changeset/pre.json`), as `@objectstack/*` 18 is: these releases are `18.0.0-next.N` on the npm `next` dist-tag, and they do not move `latest`. The first `18.0.0` on `latest` comes when `@objectstack` 18 is generally available and this repository leaves pre mode.
  
  What a consumer must do to take it is in the `@objectstack/*` 18 entry of this release (objectui#12030): move its own `@objectstack/*` packages to the 18 line at the same time.

### Patch Changes

- Updated dependencies [18d7b48]
- Updated dependencies [172acc3]
- Updated dependencies [f0496bd]
- Updated dependencies [c4c506b]
- Updated dependencies [9db9ff3]
- Updated dependencies [b10c68e]
- Updated dependencies [bdc9049]
- Updated dependencies [2e818d0]
- Updated dependencies [8b14aec]
- Updated dependencies [2abec3a]
- Updated dependencies [9dfaca6]
- Updated dependencies [96fcf30]
- Updated dependencies [89cc738]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [4c0de52]
- Updated dependencies [a80fef7]
- Updated dependencies [f34e877]
- Updated dependencies [aaba865]
- Updated dependencies [45d5853]
- Updated dependencies [2312bd9]
- Updated dependencies [c5406c2]
- Updated dependencies [2a48bd4]
- Updated dependencies [c7b30bd]
- Updated dependencies [69bca0a]
- Updated dependencies [c0c2f79]
- Updated dependencies [0665c3b]
- Updated dependencies [d2500d8]
- Updated dependencies [b231607]
- Updated dependencies [466a219]
- Updated dependencies [6fb281d]
- Updated dependencies [c08c933]
- Updated dependencies [c4dd707]
- Updated dependencies [923504f]
- Updated dependencies [10aba37]
- Updated dependencies [5d3f437]
- Updated dependencies [7af0ab3]
- Updated dependencies [fd4872f]
- Updated dependencies [f0532d8]
- Updated dependencies [3092aca]
- Updated dependencies [82e5f53]
- Updated dependencies [d81e460]
- Updated dependencies [8106db1]
- Updated dependencies [093d55b]
- Updated dependencies [a8051d6]
- Updated dependencies [524136e]
- Updated dependencies [6f3299f]
- Updated dependencies [f2b17c6]
- Updated dependencies [52d6194]
- Updated dependencies [23bf859]
- Updated dependencies [1c72d77]
- Updated dependencies [2b4d3f1]
- Updated dependencies [d75f212]
- Updated dependencies [ff9df88]
- Updated dependencies [a2225f9]
- Updated dependencies [21f9577]
- Updated dependencies [3eb3ec1]
- Updated dependencies [619e3f7]
- Updated dependencies [f62b6ff]
- Updated dependencies [d66d7e8]
- Updated dependencies [15d8ca6]
- Updated dependencies [378896d]
- Updated dependencies [4839f5c]
- Updated dependencies [c999d4c]
- Updated dependencies [26323c4]
- Updated dependencies [c219165]
- Updated dependencies [30083da]
- Updated dependencies [8aa8e3e]
- Updated dependencies [a928aaa]
- Updated dependencies [1b94d50]
- Updated dependencies [fb85637]
- Updated dependencies [df71568]
- Updated dependencies [cbac9d7]
- Updated dependencies [daeb77f]
- Updated dependencies [eb4552e]
- Updated dependencies [55e90fd]
- Updated dependencies [9b75509]
- Updated dependencies [b13ea3c]
- Updated dependencies [d7e9e9a]
- Updated dependencies [cf62edf]
- Updated dependencies [0253416]
- Updated dependencies [5d77c09]
- Updated dependencies [3fd8625]
- Updated dependencies [1473757]
- Updated dependencies [d73d987]
- Updated dependencies [12ff256]
- Updated dependencies [26b0bd2]
- Updated dependencies [d328698]
- Updated dependencies [b4e0787]
- Updated dependencies [088e0f7]
- Updated dependencies [b403bb3]
  - @object-ui/types@18.0.0

## 17.7.0

### Minor Changes

- 2d7304d: Retire the `MobileOverrides` type and its `mobileOverrides` mount point (objectui#4919,
  maintainer ruling 2026-08-19, ADR-0049 enforce-or-remove).
  
  `MobileOverrides` published a six-key mobile override surface — `layout`, `columns`,
  `useBottomSheet`, `fullScreen`, `touchTarget` and a three-value `navigation` vocabulary
  (`'bottom-tabs' | 'hamburger' | 'drawer'`) — from `@object-ui/types` and, re-exported,
  from `@object-ui/mobile`. Nothing read any of it. Measured on current `main`: the type had
  exactly four mentions repo-wide — its own declaration, the single
  `MobileComponentConfig.mobileOverrides` mount point, and the two barrel re-exports — and
  the lower-case property name (the spelling a renderer would actually read) appeared only
  in that declaration. No renderer, hook or adapter resolved it, and a sweep of the example
  apps and the `objectstack` sibling checkout found zero authors. The three `navigation`
  values were three spellings of the same no-op.
  
  The declared surface is removed rather than narrowed. The #3985 lineage's rule is "narrow
  to the implemented values"; here the implemented set is empty, so that rule terminates in
  deletion — a config that type-checks, builds and silently does nothing is the
  declare-without-enforce shape the platform doctrine forbids.
  
  Removal rather than a `?: never` tombstone follows this package's own retire-vs-remove
  discriminator, in its amended form (`5f8190c8c`). That rule is cited here and not
  restated: it is stated once, and a second copy carried in a release note could only drift
  out of agreement with it. Measured against it the route is removal: there is no replacement
  key to steer to, no documentation ever described the surface, and there is no successor
  spelling. That is the same zero-pull, no-successor shape as the retired
  `AccordionItem.icon` (objectui#4652) and `ToggleGroupItem.icon` (objectui#4632), both of
  which were removed outright rather than tombstoned.
  
  **Breaking for TypeScript authors of `MobileOverrides` / `mobileOverrides` only** (marked
  `minor` per this repo's version-alignment rule, which reserves `major` for following
  `@objectstack` across a major — see AGENTS.md's 版本号策略, and the identical
  classification used for `AccordionItem.icon`). Runtime behaviour is unchanged: an authored
  `mobileOverrides` did nothing before and does nothing now. What changes is that the
  contract no longer claims otherwise, so the mistake surfaces at authoring time — importing
  the type is now a "has no exported member" error, and authoring the key on a
  `MobileComponentConfig` object literal is an excess-property error, instead of a silent
  no-op that type-checks and builds.
  
  If real mobile-override renderer work is ever wanted it re-enters deliberately, as designed
  product surface on its own card, with the renderer landing in the same change as the
  declaration — not by resurrecting this declaration.
- 90665e0: **Removes a published export.** Retire the `MobileComponentConfig` type
  (objectui#5942, ADR-0049 enforce-or-remove). The name is deleted from
  `@object-ui/types` and from `@object-ui/mobile`, which re-exported it — after
  this release `import type { MobileComponentConfig }` from either package is a
  compile error, not a deprecation warning.
  
  `MobileComponentConfig` published a four-key "mobile component schema
  extension" — `responsive`, `gestures`, `pullToRefresh` and `infiniteScroll` —
  and nothing read it. Re-measured on current `main` before anything was deleted:
  the type had exactly four code mentions repo-wide — its own declaration, one
  doc-comment cross-reference, and the two barrel re-exports. It had **no mount
  point at all**: no type mounted it as a property, nothing extended it, and no
  renderer, hook or adapter annotated, cast to or imported it. A sweep of the
  example apps and the `objectstack` sibling checkout found zero authors. Every
  read-shape probe returned zero against a control lit in the same run.
  
  That makes it stricter than the usual case: not merely a surface whose values
  were unimplemented, but a container with no path by which any authored value
  could reach a renderer. objectui#4919 removed its last member
  (`mobileOverrides`), which is what left the container itself inert.
  
  Removed outright rather than kept as a `?: never` tombstone, on this package's
  own retire-vs-remove discriminator, in its amended form (`5f8190c8c`).
  That rule is cited here and not restated: it is stated once, and a second copy
  carried in a release note could only drift out of agreement with it. Measured
  against it the route is removal — the whole interface goes, so there is no
  surviving object to hang a `never` key on, and no documentation ever described
  it (`skills/objectui/guides/mobile.md` teaches the hooks, never this type). Same
  zero-pull, no-successor shape as `MobileOverrides` (objectui#4919) and
  `AccordionItem.icon` / `ToggleGroupItem.icon`.
  
  ## Upgrading
  
  **No behaviour changes and there is nothing to migrate at runtime.** An object
  authored against this type did nothing before and does nothing now; what
  changes is that the contract no longer claims otherwise, so the mistake
  surfaces at authoring time instead of silently type-checking.
  
  - **You imported the type only** (the only thing that was possible — nothing
    accepted it as a value): delete the import. If you kept a local config object
    annotated with it, drop the annotation; the object was never passed anywhere
    that read it.
  - **You actually wanted the behaviour:** it exists, and it is not being
    retired. It lives in `@object-ui/mobile` as React hooks, which is where the
    working code always was — `useResponsive` / `ResponsiveContainer` for
    `responsive`, `useGesture` for `gestures`, `usePullToRefresh` for
    `pullToRefresh`. `infiniteScroll` has no hook; it was never implemented in
    any form. See `skills/objectui/guides/mobile.md`.
  - **You want a declarative mobile config surface:** that re-enters deliberately
    as designed product surface on its own card, with the renderer that reads it
    landing in the same change as the declaration — not by restoring this
    declaration.
  
  **Do not follow the compiler's suggestion.** TypeScript reports the removal from
  `@object-ui/types` as TS2724 and appends `Did you mean 'ComponentConfig'?`. That
  is a lexical near-match, not a migration target: `ComponentConfig` is the
  renderer **registration** record (`{ type: string; component: T }`, extending
  `ComponentMeta`) and has nothing to do with mobile configuration. The import
  from `@object-ui/mobile` gets a plain TS2305 with no suggestion at all.
  
  Marked `minor`, not `major`, per this repo's version-alignment rule, which
  reserves `major` for following `@objectstack` across a major (AGENTS.md
  版本号策略) — the same classification objectui#4919's identically breaking type
  removal used. **Breaking for TypeScript consumers of the name only.**
  
  Follow-up, deliberately not widened into this change: `MobileResponsiveConfig`
  and `GestureConfig` were consumed only by this container and are now
  zero-consumer published types themselves. Filed as objectui#7519 for triage.
- 51eb515: **Removes two published exports.** Retire the `MobileResponsiveConfig` and
  `GestureConfig` types (objectui#7519, ADR-0049 enforce-or-remove). Both names
  are deleted from `@object-ui/types` and from `@object-ui/mobile`, which
  re-exported them — after this release `import type { MobileResponsiveConfig }`
  or `import type { GestureConfig }` from either package is a compile error, not a
  deprecation warning.
  
  Each had exactly one consumer: the `responsive` and `gestures` members of
  `MobileComponentConfig`, which objectui#5942 retired. Re-measured on current
  `main` before anything was deleted, each was a declaration plus the two barrel
  re-exports and nothing else — no type mounted either, nothing extended,
  annotated, cast to or imported them outside the barrels, and the example apps
  and the `objectstack` sibling checkout had zero authors. A value written against
  either could not reach a renderer or a handler by any path. That is the same
  declared-surface-with-no-consumption-path shape as `MobileComponentConfig`
  itself and `MobileOverrides` (objectui#4919) before it, one level down.
  
  Removed outright rather than kept as `?: never` tombstones, measured against
  this package's retire-vs-remove discriminator, in its amended form
  (`5f8190c8c`). That rule is cited here and not restated: it is stated once, and
  a second copy carried in a release note could only drift out of agreement with
  it. The per-prong measurement it asks for is kept as the record. Prong 1:
  neither has a replacement key — the behaviour they named lives in hooks, and
  `SpecGestureConfig` is a different contract, not a successor. Prong 2: the only
  release-note lines naming either are the objectstack#4115 rename-ledger rows
  and, for `GestureConfig`, the objectui#3363 reclaim note; none taught a
  renderer or dispatcher reading them, and no member carried a published
  `@default` (contrast `triggerIcon`, tombstoned by objectui#7654 on exactly that
  evidence). Structurally there is also no silent-strip hazard for a tombstone to
  guard: whole interfaces go, nothing ever parsed them, and the mobile module has
  never had a `zod/` twin to host a `retirementTombstone()`. The compiler was the
  only channel these names ever had, and the refusal now lives there.
  
  ## Upgrading
  
  **No behaviour changes and there is nothing to migrate at runtime.** An object
  authored against either type did nothing before and does nothing now; what
  changes is that the contract no longer claims otherwise, so the mistake surfaces
  at authoring time instead of silently type-checking.
  
  - **You imported a type only** (the only thing that was possible — nothing
    accepted either as a value): delete the import. If you kept a local object
    annotated with it, drop the annotation; it was never passed anywhere that read
    it.
  - **You wanted per-breakpoint layout:** it exists and is not being retired —
    `useResponsive` / `ResponsiveContainer` / `useBreakpoint` in
    `@object-ui/mobile`. `ResponsiveValue` and `BreakpointName` stay exported from
    both packages.
  - **You wanted to bind a gesture to a handler:** `useGesture` in
    `@object-ui/mobile` takes `{ type: GestureType, onGesture, threshold?,
    longPressDuration?, enabled? }`. `GestureType` and `GestureContext` stay
    exported from both packages.
  - **You want a declarative mobile config surface:** that re-enters deliberately
    as designed product surface on its own card, with the renderer that reads it
    landing in the same change as the declaration — not by restoring these
    declarations.
  
  **Do not follow the compiler's suggestion for `GestureConfig`.** Measured against
  the built declarations: `import type { GestureConfig }` from either package now
  fails as TS2724 with `Did you mean 'SpecGestureConfig'?`. That is a lexical
  near-match, not a migration target. `SpecGestureConfig` is the retired
  `@objectstack/spec` `ui/touch` **tuning** record (`{ type, label, enabled,
  swipe, pinch, longPress }`) that `useSpecGesture` reads; it has no `action`
  member and does not bind a gesture to anything. `MobileResponsiveConfig` fails
  as a plain TS2305 with no suggestion from either package.
  
  Marked `minor`, not `major`, per this repo's version-alignment rule (AGENTS.md
  版本号策略), which reserves `major` for following `@objectstack` across a major —
  the same classification objectui#5942 and objectui#4919 used for identically
  breaking type removals. **Breaking for TypeScript consumers of the two names
  only.** The in-repo consumer count is zero; consumers outside this repository
  that import either name from either package are not visible from here, which is
  why this entry is graded on the published-surface change and not on that count.
- e62c44e: Re-home the breakpoint layout vocabulary and delete the two dead responsive
  implementations (objectui#7580, maintainer ruling 2026-09-04, option A).
  
  **Breaking, deliberately, in one direction only.** `@objectstack/spec` retired its whole
  `ui/responsive` vocabulary in objectstack#11027 — `ResponsiveConfigSchema`,
  `BreakpointName`, `BreakpointColumnMapSchema` and `BreakpointOrderMapSchema` — on the
  stated ground that the four types "had no other authorable carrier". That ground is
  measurably false on the renderer side: `responsive-grid` is a REGISTERED SDUI component
  whose authorable `columns` input is typed by `BreakpointColumnMap` and applied by
  `resolveColumnClasses` on the render path, and `BreakpointName` types four live readers in
  `@object-ui/mobile`. The tombstone's own return condition — the vocabulary "returns if and
  when a renderer implements it" — is already met here, so the two types a renderer reads
  are re-homed rather than retired.
  
  What survives, under the same names and the same members:
  
  - `BreakpointName` (`xs`…`2xl`) is now declared in `@object-ui/types` (`mobile.ts`) instead
    of re-exported from the spec. **No consumer change**: same name, same six members, same
    export sites on `@object-ui/types` and `@object-ui/mobile`. Only its provenance moved.
  - `BreakpointColumnMap` is now declared in `@object-ui/layout` (`ResponsiveGrid.tsx`),
    verbatim from the retired `$strict` schema: six optional column counts, no index
    signature. `responsive-grid`'s `columns` input and its resolver are unchanged.
  
  What is removed:
  
  - `BreakpointOrderMap` (`@object-ui/layout`) — retired with the key, not re-homed. It had
    no read point in the package; it was published only because the retired
    `ResponsiveConfigSchema` paired it with the column map, so an author configuring `order`
    needed the type. With the schema gone there is no order vocabulary for it to be the type
    of, and re-declaring it would be the declare-without-enforce shape ADR-0049 removes.
  - `useResponsiveConfig` (`@object-ui/mobile`), with its `SpecResponsiveConfig` and
    `ResolvedResponsiveState` exports, and `ResponsiveProtocol` (`@object-ui/core`), with
    `resolveResponsiveConfig` / `getVisibilityClasses` / `getColumnClasses` /
    `getOrderClasses` / `shouldHideAtBreakpoint`. Both read the retired
    `ResponsiveConfigSchema` and both were measured at zero callers (objectui#4773).
  - `SpecResponsiveConfig` / `SpecBreakpointName` (`@object-ui/types`) — dead re-exports once
    the two implementations above went, dropped rather than re-declared locally, the same
    disposition the retired i18n names in that file already carry.
  
  No behaviour is retired. The live per-breakpoint readers — `useBreakpoint`,
  `ResponsiveContainer`, `BREAKPOINTS` / `BREAKPOINT_ORDER` / `getCurrentBreakpoint`, and
  `responsive-grid` itself — are untouched.
  
  **Sequencing.** objectui's next `@objectstack/spec` pin bump must carry `Blocked-by:`
  objectui#7580: the retirement is merged upstream and unreleased, so this must land first.
  
  ⚠️ **Dated note, 2026-10-02 — the `responsive-grid` registration is retired — objectui#11441.**
  Later in this same release the maintainer's ruling on objectui#11441 (letter B) unregistered `responsive-grid` (and
  `layout:responsive-grid`). That ruling updates item 2 of this change's ruling: the vocabulary half stands, so
  `BreakpointName` and `BreakpointColumnMap` stay declared here, and `ResponsiveGrid` stays a React export whose
  `columns` prop `BreakpointColumnMap` types. The authorable breakpoint grid is the `grid` node with a breakpoint
  `columns` object, which `BreakpointName` keys. The rest of this entry is kept as the reading of this change.
- 1cfdff8: `useSpecGesture` fires a swipe on MEMBERSHIP of the declared direction set
  (objectui#7974, maintainer ruling of decision batch #70).
  
  `SwipeGestureConfig.direction` is declared `SpecSwipeDirection[]` — a set — and the
  hook now honours the whole of it: it recognizes the any-direction move past the
  threshold and fires only when the DETECTED direction is a member of the declared
  set. It used to read `direction[0]` and fuse that one element into a
  direction-specific recognizer, so every element after the first was declared and
  then never honoured.
  
  **Breaking in two narrow ways, deliberately.**
  
  - A declared set with more than one direction now fires for all of its members.
    `direction: ['left', 'up']` used to fire on a left swipe only.
  - An EMPTY or absent `swipe` sub-object now fires for nothing. It used to fall
    back to a left-swipe recognizer, so a config that declared no direction at all
    silently recognized one.
  
  **The lenient cast is gone, and nothing replaces it (AGENTS.md #0.1).** The hook
  also read a SCALAR `direction` through an `as string` cast, which the declared
  array type rejects — a second, undeclared contract that let the shipped
  `@example` (which passed `direction: 'left'`) appear to work when hand-tested.
  That example now passes `direction: ['left']`, and no runtime path accepts a
  scalar. A tree-wide scan of `packages/`, `apps/` and `examples/` for scalar call
  sites — run with a firing control that planted one and found it — reported zero,
  so no caller has to change for this.
- 0ee6e31: `useSpecGesture`'s `onGesture` fallback payload reports the DECLARED spec
  gesture at every arm, not the recognizer's own name (objectui#9691).
  
  The hook builds each fallback payload by spreading the recognizer's runtime
  context next to a declared `type`. That context carries a `type` of its own —
  the direction-fused recognizer vocabulary — so the three arms that wrote `type`
  BEFORE the spread (`pinch`, `pan`/`drag`, `rotate`) had their declared value
  overwritten by the recognizer's. `type` now goes last at all three, which is
  what the `swipe` arm already did.
  
  **Breaking in exactly one way, and it is worth stating narrowly.** A config that
  declares `type: 'drag'` and supplies no `onPan` now receives `type: 'drag'` in
  its `onGesture` payload; it used to receive `'pan'`, the recognizer's name for
  the same move. That is the one row where the two vocabularies disagree, so it is
  the one row where anything observable changes.
  
  The other repaired arms are LATENT, and the declaration would be dishonest if it
  claimed otherwise: `pinch`, `rotate` and a declared `pan` name their recognizer
  identically, so the overwrite replaced each value with itself and no payload
  moves today. They are repaired because the two sides are different vocabularies
  that happen to agree — a rename on either one turns them into the `drag` case
  silently — not because anything is observably wrong at them now.

### Patch Changes

- 6ce001a: fix(mobile): `usePullToRefresh` arms on a host that mounts after the first render, and one pull has one owner (objectui#10105)
  
  The hook returns an object ref, so it cannot see when a consumer attaches it.
  It used to bind its touch listeners in an effect keyed only on its handlers and
  `enabled`, which read `ref.current` once. A view whose first render is a
  loading screen has no host at that moment. When the host appeared, none of the
  effect's keys had changed, so it never ran again and the pull gesture did
  nothing, with no error. The listeners now follow the element the ref points at
  after each commit: they bind when it appears, move when it is replaced, and are
  released when it goes away or the consumer unmounts.
  
  Measured on this branch, on the internal-fetch path (the view fetches its own
  rows): the gesture was dead on `ObjectCalendar`, `ObjectGrid` and
  `ObjectTimeline` and now arms and refetches. `ListView` renders its host on the
  first render and was not affected.
  
  Nested pull hosts now have one owner. `ListView` has its own pull host, and
  so does the view it renders inside itself. A touch on the inner view bubbles
  to `ListView`, so both used to respond to one pull. Before this change, the
  calendar and timeline views inside `ListView` drew two "Pull to refresh"
  strips for one pull, and arming the grid would have made its view do the
  same. The gesture now belongs to the OUTERMOST armed pull host: an inner host
  lets a pull go when an armed pull host is its ancestor in the DOM. So one pull
  inside `ListView` draws one indicator, `ListView`'s, and runs one refetch,
  which reloads the rows `ListView` hands the inner view. A view with no pull
  host above it keeps its own pull. While it is armed, the hook marks its
  element with a `data-pull-to-refresh-host` attribute; that attribute is how one
  hook instance sees another, including across two copies of this package.
  
  Product-visible:
  
  - Nothing changes in what renders while loading.
  - A pull inside `ListView` (calendar, grid or timeline view) shows one
    indicator (calendar and timeline used to show two; the grid view keeps its
    one), and still triggers one refetch.
  - The pull gesture now works on those views when they fetch their own rows.
  
  The exported signature and return type of `usePullToRefresh` are unchanged.
- Updated dependencies [b46c58f]
- Updated dependencies [6f96fca]
- Updated dependencies [5f00ff4]
- Updated dependencies [c9e073a]
- Updated dependencies [7b395d8]
- Updated dependencies [0879812]
- Updated dependencies [2dd4d3f]
- Updated dependencies [e3ea4f9]
- Updated dependencies [8b1f066]
- Updated dependencies [af243c1]
- Updated dependencies [f3f4e4c]
- Updated dependencies [a05c350]
- Updated dependencies [8c10f4f]
- Updated dependencies [90dac98]
- Updated dependencies [6096f20]
- Updated dependencies [ea02938]
- Updated dependencies [a14fb23]
- Updated dependencies [ae98f1d]
- Updated dependencies [f98eddf]
- Updated dependencies [ce6bd99]
- Updated dependencies [a5b08c9]
- Updated dependencies [9b28151]
- Updated dependencies [1a5003f]
- Updated dependencies [d22b37b]
- Updated dependencies [1daf477]
- Updated dependencies [fb13e85]
- Updated dependencies [c2d8659]
- Updated dependencies [e0f8202]
- Updated dependencies [c3a26cc]
- Updated dependencies [a66e58e]
- Updated dependencies [d89492c]
- Updated dependencies [9327397]
- Updated dependencies [17cc3a3]
- Updated dependencies [9c78ebe]
- Updated dependencies [12809a5]
- Updated dependencies [f9c06ef]
- Updated dependencies [5ad3b88]
- Updated dependencies [f9d772b]
- Updated dependencies [97b6c21]
- Updated dependencies [29b45f6]
- Updated dependencies [b956e69]
- Updated dependencies [fec3b1a]
- Updated dependencies [b8e0941]
- Updated dependencies [0c50f18]
- Updated dependencies [1dae95a]
- Updated dependencies [e32dae1]
- Updated dependencies [4aebea0]
- Updated dependencies [f976774]
- Updated dependencies [25cb364]
- Updated dependencies [c6678b1]
- Updated dependencies [0638322]
- Updated dependencies [e3782d2]
- Updated dependencies [db0beb2]
- Updated dependencies [997ce38]
- Updated dependencies [ae0b9d3]
- Updated dependencies [3b469c8]
- Updated dependencies [6650259]
- Updated dependencies [4f8b7f8]
- Updated dependencies [f6ae5e2]
- Updated dependencies [7343376]
- Updated dependencies [b2683a2]
- Updated dependencies [dded788]
- Updated dependencies [b45d463]
- Updated dependencies [54a7830]
- Updated dependencies [f3135a4]
- Updated dependencies [b5696d3]
- Updated dependencies [3f9d926]
- Updated dependencies [e978ed5]
- Updated dependencies [6a7f24e]
- Updated dependencies [b3c96d6]
- Updated dependencies [8d0ca91]
- Updated dependencies [c30c8dd]
- Updated dependencies [24d3e65]
- Updated dependencies [95a7c8d]
- Updated dependencies [cc4e476]
- Updated dependencies [92970c4]
- Updated dependencies [d570eaa]
- Updated dependencies [42687ba]
- Updated dependencies [24a0f14]
- Updated dependencies [797a30f]
- Updated dependencies [b4075c0]
- Updated dependencies [9b85600]
- Updated dependencies [99878d8]
- Updated dependencies [3c13675]
- Updated dependencies [0eb9f36]
- Updated dependencies [ae582b7]
- Updated dependencies [db11afd]
- Updated dependencies [154075a]
- Updated dependencies [582edef]
- Updated dependencies [19f484f]
- Updated dependencies [0a78a20]
- Updated dependencies [615346d]
- Updated dependencies [75dcc81]
- Updated dependencies [55a12a8]
- Updated dependencies [edfcf5a]
- Updated dependencies [0a3e540]
- Updated dependencies [f61dab1]
- Updated dependencies [b0a05dd]
- Updated dependencies [dd5ff19]
- Updated dependencies [81f8498]
- Updated dependencies [c27b575]
- Updated dependencies [0e6e76b]
- Updated dependencies [cd5b19a]
- Updated dependencies [17dc167]
- Updated dependencies [20d23be]
- Updated dependencies [20d23be]
- Updated dependencies [e6bc087]
- Updated dependencies [a7557a7]
- Updated dependencies [7d074ba]
- Updated dependencies [6158e4c]
- Updated dependencies [6158e4c]
- Updated dependencies [52aad5c]
- Updated dependencies [58da8ae]
- Updated dependencies [138ad45]
- Updated dependencies [5262f7d]
- Updated dependencies [6aa029b]
- Updated dependencies [770cc5b]
- Updated dependencies [1a88ce2]
- Updated dependencies [a1a44d6]
- Updated dependencies [e0a9c67]
- Updated dependencies [5638529]
- Updated dependencies [c476be0]
- Updated dependencies [c82ff39]
- Updated dependencies [6c3da53]
- Updated dependencies [31987bd]
- Updated dependencies [3c3ce15]
- Updated dependencies [e100589]
- Updated dependencies [304f611]
- Updated dependencies [e46ee77]
- Updated dependencies [6e9c8d2]
- Updated dependencies [9547063]
- Updated dependencies [3f6efd6]
- Updated dependencies [c4ab6d0]
- Updated dependencies [0e9058b]
- Updated dependencies [5988b6b]
- Updated dependencies [00ccdf7]
- Updated dependencies [9d9ed54]
- Updated dependencies [ca3de72]
- Updated dependencies [83e3f83]
- Updated dependencies [401611b]
- Updated dependencies [2c0ddf2]
- Updated dependencies [4abc0aa]
- Updated dependencies [2b188fa]
- Updated dependencies [f68e0a0]
- Updated dependencies [aea682a]
- Updated dependencies [fcdc8ec]
- Updated dependencies [2d576e4]
- Updated dependencies [8366acc]
- Updated dependencies [95e58a3]
- Updated dependencies [9d7419b]
- Updated dependencies [fc7db05]
- Updated dependencies [9ed8d0f]
- Updated dependencies [c73cdb5]
- Updated dependencies [6f5719e]
- Updated dependencies [06a8af5]
- Updated dependencies [6a91586]
- Updated dependencies [a04d7c6]
- Updated dependencies [f3c2bb0]
- Updated dependencies [460575f]
- Updated dependencies [d88e20f]
- Updated dependencies [2d7304d]
- Updated dependencies [636b236]
- Updated dependencies [d6d8fb9]
- Updated dependencies [64d624d]
- Updated dependencies [95bad12]
- Updated dependencies [d2fb6ef]
- Updated dependencies [fda49e5]
- Updated dependencies [fc62bb4]
- Updated dependencies [41df893]
- Updated dependencies [0cba1b7]
- Updated dependencies [00f3eb5]
- Updated dependencies [1ec291c]
- Updated dependencies [453dbaa]
- Updated dependencies [69a2163]
- Updated dependencies [24e027e]
- Updated dependencies [2c3cd1b]
- Updated dependencies [90665e0]
- Updated dependencies [7e19d03]
- Updated dependencies [1e946c9]
- Updated dependencies [864154e]
- Updated dependencies [b023625]
- Updated dependencies [75bd83d]
- Updated dependencies [40c479a]
- Updated dependencies [971d387]
- Updated dependencies [ee851c3]
- Updated dependencies [6414dfd]
- Updated dependencies [a8d5c71]
- Updated dependencies [905b21f]
- Updated dependencies [88e9109]
- Updated dependencies [2c45966]
- Updated dependencies [db3a600]
- Updated dependencies [3a3db76]
- Updated dependencies [0d723a3]
- Updated dependencies [0c95d3d]
- Updated dependencies [3e4fa2c]
- Updated dependencies [b5b928a]
- Updated dependencies [52a43de]
- Updated dependencies [195052f]
- Updated dependencies [e4559d1]
- Updated dependencies [2c71482]
- Updated dependencies [5ef9c4f]
- Updated dependencies [46f0bb4]
- Updated dependencies [6f81384]
- Updated dependencies [8f1d995]
- Updated dependencies [dddb942]
- Updated dependencies [29754cf]
- Updated dependencies [b84dc18]
- Updated dependencies [ac8abb0]
- Updated dependencies [9d86e1d]
- Updated dependencies [3a5817f]
- Updated dependencies [99a3c2d]
- Updated dependencies [c8ea8af]
- Updated dependencies [3190414]
- Updated dependencies [4e480f5]
- Updated dependencies [38a123c]
- Updated dependencies [d7acad6]
- Updated dependencies [45a9aeb]
- Updated dependencies [713db46]
- Updated dependencies [bf3a03c]
- Updated dependencies [cb55718]
- Updated dependencies [29cb85b]
- Updated dependencies [3e028c8]
- Updated dependencies [ce503e5]
- Updated dependencies [f20dcf0]
- Updated dependencies [4ca30d0]
- Updated dependencies [7a5da14]
- Updated dependencies [2c1c967]
- Updated dependencies [d6ceb8d]
- Updated dependencies [2acd8e1]
- Updated dependencies [adb2a86]
- Updated dependencies [3561bd2]
- Updated dependencies [bf97b98]
- Updated dependencies [b0d308d]
- Updated dependencies [40f34b4]
- Updated dependencies [8063bcb]
- Updated dependencies [b74a859]
- Updated dependencies [d4493fd]
- Updated dependencies [240b80f]
- Updated dependencies [77cb489]
- Updated dependencies [bfaa158]
- Updated dependencies [777e5c6]
- Updated dependencies [0c386dd]
- Updated dependencies [9e37d9b]
- Updated dependencies [5ad86dd]
- Updated dependencies [16a725f]
- Updated dependencies [4dfdcc3]
- Updated dependencies [446d93d]
- Updated dependencies [ecd9cb2]
- Updated dependencies [98d4108]
- Updated dependencies [0e3b3be]
- Updated dependencies [a29ae2d]
- Updated dependencies [4388f71]
- Updated dependencies [0b1ac58]
- Updated dependencies [c93b4d5]
- Updated dependencies [c1fe272]
- Updated dependencies [8ad218d]
- Updated dependencies [3e41187]
- Updated dependencies [5f78953]
- Updated dependencies [639114c]
- Updated dependencies [1f31d3a]
- Updated dependencies [351eb31]
- Updated dependencies [20c04b2]
- Updated dependencies [b652514]
- Updated dependencies [adbda1b]
- Updated dependencies [e2b3826]
- Updated dependencies [2e32ed4]
- Updated dependencies [1bee5d0]
- Updated dependencies [858cd72]
- Updated dependencies [554f2b6]
- Updated dependencies [669d71b]
- Updated dependencies [ed27d7c]
- Updated dependencies [52c8cf7]
- Updated dependencies [2ceb43a]
- Updated dependencies [7cdd2b9]
- Updated dependencies [52c8cf7]
- Updated dependencies [caa0cd3]
- Updated dependencies [25c7d58]
- Updated dependencies [c6198c2]
- Updated dependencies [51eb515]
- Updated dependencies [c354ce5]
- Updated dependencies [8fe8e5c]
- Updated dependencies [feac439]
- Updated dependencies [efbd566]
- Updated dependencies [9587fc9]
- Updated dependencies [e62c44e]
- Updated dependencies [5d0876c]
- Updated dependencies [544ecba]
- Updated dependencies [bc640ec]
- Updated dependencies [3e377c9]
- Updated dependencies [a3eb5d0]
- Updated dependencies [4ce14f1]
- Updated dependencies [2af1fa7]
- Updated dependencies [a137d0c]
- Updated dependencies [caf477f]
- Updated dependencies [f6375da]
- Updated dependencies [967e5d8]
- Updated dependencies [a4611b3]
- Updated dependencies [20316ba]
- Updated dependencies [d3499b3]
- Updated dependencies [309c75e]
- Updated dependencies [c9f9bae]
- Updated dependencies [18897a4]
- Updated dependencies [8b7ea39]
- Updated dependencies [dcbf0b2]
- Updated dependencies [1422a92]
- Updated dependencies [d05fe17]
- Updated dependencies [a480f79]
- Updated dependencies [f08d1a8]
- Updated dependencies [64a252d]
- Updated dependencies [786bc91]
- Updated dependencies [75fca96]
- Updated dependencies [7ca6ddd]
- Updated dependencies [f1cd290]
- Updated dependencies [5a41ce7]
- Updated dependencies [8d50bc2]
- Updated dependencies [604476d]
- Updated dependencies [335abea]
- Updated dependencies [0f5cadf]
- Updated dependencies [4f9f1ee]
- Updated dependencies [66e8b2a]
- Updated dependencies [aa083cd]
- Updated dependencies [12b5992]
- Updated dependencies [b93e245]
- Updated dependencies [c842594]
- Updated dependencies [290de37]
- Updated dependencies [8c8da45]
- Updated dependencies [8cd8eb5]
- Updated dependencies [cf1d29e]
- Updated dependencies [af9e957]
- Updated dependencies [c974edf]
- Updated dependencies [ad852b6]
- Updated dependencies [ee4d19f]
- Updated dependencies [496d31d]
- Updated dependencies [9a853f2]
- Updated dependencies [cb847fd]
- Updated dependencies [ee70287]
- Updated dependencies [3e98e13]
- Updated dependencies [4eaa835]
- Updated dependencies [b1777ae]
- Updated dependencies [24845c4]
- Updated dependencies [6f864cf]
- Updated dependencies [24d1edd]
- Updated dependencies [645087c]
- Updated dependencies [33f4a19]
- Updated dependencies [5323168]
- Updated dependencies [841dd2b]
- Updated dependencies [3014fc0]
- Updated dependencies [dacb402]
- Updated dependencies [474797d]
- Updated dependencies [704e695]
- Updated dependencies [a407bd6]
- Updated dependencies [3a43a15]
- Updated dependencies [421544b]
- Updated dependencies [fb01022]
- Updated dependencies [e9d9212]
- Updated dependencies [ecfb693]
- Updated dependencies [81a51db]
- Updated dependencies [67749c7]
- Updated dependencies [507b61b]
- Updated dependencies [512c84b]
- Updated dependencies [d4733f2]
- Updated dependencies [8b532cb]
- Updated dependencies [c42554e]
- Updated dependencies [555b4ec]
- Updated dependencies [1ccfc23]
- Updated dependencies [542718f]
- Updated dependencies [7f27bc5]
- Updated dependencies [f95b140]
- Updated dependencies [541ce4e]
- Updated dependencies [6479086]
- Updated dependencies [d79f525]
- Updated dependencies [f1190b0]
- Updated dependencies [6a4680b]
- Updated dependencies [c3a4273]
- Updated dependencies [093af32]
- Updated dependencies [1bd1be7]
- Updated dependencies [d234fa9]
- Updated dependencies [adf5812]
- Updated dependencies [5058336]
- Updated dependencies [2f6b2bf]
- Updated dependencies [2028b31]
- Updated dependencies [63601ab]
- Updated dependencies [8693b85]
- Updated dependencies [58b7b3d]
- Updated dependencies [681d3f1]
- Updated dependencies [f3bc481]
- Updated dependencies [93fc0e7]
- Updated dependencies [a4b723f]
- Updated dependencies [2b10ca0]
- Updated dependencies [7db4a81]
- Updated dependencies [526fc11]
- Updated dependencies [6732df4]
- Updated dependencies [fe9e0d0]
- Updated dependencies [63fb72c]
- Updated dependencies [279e48e]
- Updated dependencies [8700d6d]
- Updated dependencies [8db2a0f]
- Updated dependencies [30443fb]
- Updated dependencies [96919a4]
- Updated dependencies [2e471dc]
- Updated dependencies [be50942]
- Updated dependencies [775e079]
- Updated dependencies [7e8b3c0]
- Updated dependencies [53374dc]
- Updated dependencies [f6fb83f]
- Updated dependencies [2049b03]
- Updated dependencies [7cbc724]
- Updated dependencies [fb91ac9]
- Updated dependencies [8524372]
- Updated dependencies [7cbefa5]
- Updated dependencies [72d6587]
- Updated dependencies [a272a4f]
- Updated dependencies [55f39ee]
- Updated dependencies [0970a0e]
- Updated dependencies [e427e9c]
- Updated dependencies [bbc9dc3]
- Updated dependencies [02f1813]
- Updated dependencies [ac716ff]
- Updated dependencies [f0f3cd5]
- Updated dependencies [20f3e65]
- Updated dependencies [bbba098]
- Updated dependencies [87af769]
- Updated dependencies [3be720e]
- Updated dependencies [c3df43a]
- Updated dependencies [d16d0e9]
- Updated dependencies [bbe57fd]
- Updated dependencies [272a530]
- Updated dependencies [1779e8d]
- Updated dependencies [4128188]
- Updated dependencies [b253c4e]
- Updated dependencies [78a9c67]
- Updated dependencies [4a7ef0d]
- Updated dependencies [dea17b4]
- Updated dependencies [89bb77a]
- Updated dependencies [06611e4]
- Updated dependencies [dc3893d]
- Updated dependencies [1bbaa16]
- Updated dependencies [6ee259a]
- Updated dependencies [e708426]
- Updated dependencies [3b6d53b]
- Updated dependencies [a8198de]
- Updated dependencies [a78cd37]
- Updated dependencies [5ea623e]
- Updated dependencies [ca5d671]
- Updated dependencies [32bf2d6]
- Updated dependencies [af4fb29]
- Updated dependencies [9a97800]
- Updated dependencies [6bca0e4]
- Updated dependencies [2fcefb9]
- Updated dependencies [b55a346]
- Updated dependencies [065bba7]
- Updated dependencies [100547e]
- Updated dependencies [6d1c155]
- Updated dependencies [d7573b3]
- Updated dependencies [0e05aac]
- Updated dependencies [18a8e7d]
- Updated dependencies [e7957ab]
- Updated dependencies [f7e34ca]
- Updated dependencies [f9e4f91]
- Updated dependencies [6ef48b1]
- Updated dependencies [fa429cf]
- Updated dependencies [ed8df3e]
- Updated dependencies [8b446f5]
- Updated dependencies [7357447]
- Updated dependencies [199d31b]
- Updated dependencies [3e01cb5]
- Updated dependencies [4e8622b]
- Updated dependencies [dffd752]
- Updated dependencies [105f3c5]
- Updated dependencies [3ccd9e8]
- Updated dependencies [689b979]
- Updated dependencies [e546222]
- Updated dependencies [fd13f52]
- Updated dependencies [fb336df]
- Updated dependencies [0fce2ef]
- Updated dependencies [0e2ddd4]
- Updated dependencies [b7479ab]
- Updated dependencies [b2ea297]
- Updated dependencies [5b5a5c3]
- Updated dependencies [14582b8]
- Updated dependencies [51e144e]
- Updated dependencies [a691c0b]
- Updated dependencies [515f171]
- Updated dependencies [258d264]
- Updated dependencies [93127bd]
- Updated dependencies [51f3d8d]
- Updated dependencies [78cbdb5]
- Updated dependencies [b7543a9]
- Updated dependencies [ca39427]
- Updated dependencies [c9327c9]
- Updated dependencies [920165d]
- Updated dependencies [968dc1e]
- Updated dependencies [3c73d99]
- Updated dependencies [1170ed1]
- Updated dependencies [4d73b07]
  - @object-ui/types@17.7.0

## 17.6.0

### Patch Changes

- 5458414: Publish relative import specifiers with explicit `.js` extensions so these six packages load under plain Node ESM.
  
  Node's ESM resolver does not extension-search relative specifiers and `tsc` never rewrites them, so an extensionless `./Foo` in the source shipped as an extensionless `./Foo` in `dist` and importing the package entry outside a bundler failed with `ERR_MODULE_NOT_FOUND`. Bundled consumers were unaffected. Unbundled consumers — plain Node ESM, an SSR host importing the package directly, anyone running the published tarball without a build step — can now import these entries, and so can the downstream `@object-ui/plugin-*` packages that evaluate through `mobile`, `permissions` and `providers`.
- Updated dependencies [88085e3]
- Updated dependencies [279fb13]
- Updated dependencies [1184192]
- Updated dependencies [a2a9747]
- Updated dependencies [af5e292]
- Updated dependencies [7f96b10]
- Updated dependencies [f1d4748]
- Updated dependencies [578e025]
- Updated dependencies [598c89a]
- Updated dependencies [b8b9af4]
- Updated dependencies [97abb24]
- Updated dependencies [deb157a]
- Updated dependencies [d2ce342]
- Updated dependencies [9695da7]
- Updated dependencies [58b8346]
- Updated dependencies [3cf4de0]
- Updated dependencies [c9dc811]
- Updated dependencies [a0b9e91]
- Updated dependencies [99bd015]
  - @object-ui/types@17.6.0

## 17.5.0

### Patch Changes

- c911544: `SpecResponsiveConfig` is now the spec's responsive config rather than a hand copy that said it was

  `useResponsiveConfig.ts` declared its own interface over the four responsive keys — `breakpoint`, `hiddenOn`, `columns`, `order` — renamed off the schema's own symbol (`ResponsiveConfig` → `SpecResponsiveConfig`) and introduced by a comment that said it mirrored `ResponsiveConfigSchema`. There was no import, no `z.infer`, and no other compile-time tie: the sentence was the entire connection.

  It agreed with the schema key-for-key on the day it was measured, and that is the reason this is worth a line rather than the reason it is not. The agreement was maintained by nobody and checked by nothing, while the comment told every later reader the copy was canonical — so a key added or retired upstream would have moved the two apart in silence, with the comment still vouching for the copy. `ViewNavigationConfig` read exactly like this until it had drifted on `mode`.

  The type is now re-exported from `@object-ui/types`, which publishes it imported straight from `@objectstack/spec/ui`. That package is already this one's only runtime dependency, so the binding costs no new dependency edge, and `@object-ui/core`'s `ResponsiveProtocol` already reaches the same type the same way.

  Nothing consumers see changes: the published name is the same, and the type it resolves to is invariant-equal to the interface that was there before — the entry `.d.ts` is byte-identical. What changes is where the four keys come from. They are now whatever the schema declares, so the next schema release reaches this package's authors as a type error instead of as silent disagreement.

  A new parity test pins the chain to `@objectstack/spec/ui` directly, because the one link the re-export cannot see is `@object-ui/types` re-growing a hand copy of its own.

- Updated dependencies [f650253]
- Updated dependencies [3d9769a]
- Updated dependencies [92876f0]
- Updated dependencies [d9d3463]
- Updated dependencies [2a40f69]
- Updated dependencies [bec3e14]
- Updated dependencies [1f9b905]
- Updated dependencies [abb0f81]
- Updated dependencies [38ab505]
- Updated dependencies [7e4f0e5]
- Updated dependencies [c1d939f]
- Updated dependencies [bb68488]
- Updated dependencies [ab04728]
  - @object-ui/types@17.5.0

## 17.4.0

### Minor Changes

- 48132f7: Track the `@objectstack` family at `17.0.0-rc.5` (objectui#3560).

  The pin moves from `^17.0.0-rc.2` to `^17.0.0-rc.5` across all 37 declarations in
  30 `package.json` files, and the sibling `@objectstack/*` packages (`client` /
  `formula` / `lint`) move with it — they pin `@objectstack/spec` **exactly**, so
  leaving them behind would keep a second copy of the spec in the tree and have
  `@objectstack/lint` validating against schemas that still accept the keys rc.3–rc.5
  retire. `pnpm-lock.yaml` now resolves one copy of each of the six family packages
  (`spec` / `client` / `core` / `formula` / `lint` / `sdui-parser`), all at rc.5.

  Bumping the pin and repairing the fallout cannot be split: the pin alone reddens
  CI, and the code alone targets a shape that is not in effect yet.

  ## A live bug this upgrade fixes

  **`ObjectStackDataSource.delete()` never emitted its mutation event, and resolved
  `undefined` instead of a boolean.** `@objectstack/client`'s `DeleteDataResult`
  declared a key called `deleted` — a key no schema has ever declared and no server
  path has ever returned on `DELETE /data/:object/:id`. So `result.deleted`
  compiled and read `undefined` at runtime: the guard never fired, a successful
  delete notified no subscriber, and every consumer's cache stayed stale.
  objectstack#5638 corrected the interface to the schema's `success`; following the
  rename is what restores both behaviours. Nothing in this repo had to change shape
  for it — the code was already asking the right question of the wrong key.

  ## Breaking, in FROM → TO form

  - **The five `@objectstack/spec/ui` interaction-config modules are gone** —
    touch / dnd / keyboard / animation / offline, 32 defs and 64 exports
    (objectstack#4988, PR objectstack#5321). None of them had an authoring door: no
    metadata document could ever carry one of these blocks, so a stack that parsed
    before the retirement parses byte-for-byte the same after it. `@object-ui/types`
    drops the 32 `export type` re-exports. The vocabulary each one's only real
    consumer needs is now declared by that consumer, which is the remedy the spec's
    own retirement ledger prescribes ("declare that union locally — it is your
    client's policy, not the platform's"):

    - `@object-ui/react`'s `useOffline` owns `OfflineStrategy`, `ConflictResolution`,
      `PersistStorageType`, `EvictionPolicyType`, `OfflineConfig`,
      `OfflineCacheConfig`, `OfflineSyncConfig`;
    - `@object-ui/core`'s `DndProtocol` / `KeyboardProtocol` own `DndConfig`,
      `DragItem`, `DropZone`, `DragConstraint`, `DragHandle`, `DropEffect`,
      `KeyboardNavigationConfig`, `KeyboardShortcut`, `FocusManagement`,
      `FocusTrapConfig`;
    - `@object-ui/types`' `mobile` module owns `SpecGestureConfig`,
      `SwipeGestureConfig`, `PinchGestureConfig`, `LongPressGestureConfig`,
      `TouchTargetConfig`, `TouchInteraction` (plus a new `SPEC_GESTURE_TYPES`
      runtime tuple), so `@object-ui/mobile`'s import paths are unchanged.

    Every shape is moved verbatim — same keys, same members, same optionality — so
    no hook or bridge changes behaviour. Consumers importing these names from
    `@object-ui/types` must import them from the owning package instead. Note the
    spec's _surviving_ `ConnectorConflictResolution` (`/integration`, connector sync)
    and `ConflictResolutionStrategy` (`/api`, route merge policy) are **different
    concepts** — do not re-point at them.

  - **`@object-ui/types` no longer re-exports `NotificationAction` or `EmbedConfig`**
    (objectstack#5015, PR objectstack#5300). Both were published `ui` vocabulary with
    no authoring door; no notification action was ever parsed from metadata and no
    iframe route ever read an embed config. The presentation enums
    (`NotificationType` / `NotificationSeverity` / `NotificationPosition`) and
    `SharingConfig` **survive** and are untouched — public form sharing still gates
    the anonymous endpoints on `allowAnonymous` + `publicLink`.
    `@object-ui/core`'s `SharingProtocol` keeps `resolveEmbedConfig` /
    `generateEmbedCode` against a locally declared `EmbedConfig`, so its surface is
    unchanged.
  - **`ThemeEngine` stops emitting nine retired CSS variable groups**
    (objectstack#5021 option 2, PR objectstack#5289). `theme.animation`,
    `theme.zIndex` and five typography groups (`fontSize` / `fontWeight` /
    `lineHeight` / `letterSpacing`, plus `fontFamily.heading` / `fontFamily.mono`)
    are tombstones the schema now rejects by name, so `--duration-*`, `--timing-*`,
    `--z-*`, `--font-size-*`, `--font-weight-*`, `--line-height-*`,
    `--letter-spacing-*`, `--font-heading` and `--font-mono` had become structurally
    dead code — no author could produce the input that reached them.
    `generateAnimationVars` and `generateZIndexVars` are removed from
    `@object-ui/core`, and `@object-ui/types` drops `Animation` / `ZIndex` /
    `AnimationSchema` / `ZIndexSchema`. **`theme.customVars` is the declared — and
    since #5021 the only — door**: each entry is emitted verbatim as
    `--<key>: <value>`, so a `--z-modal` or a `--duration-fast` goes there now.
    LIVE emission is untouched byte for byte: `colors`, `borderRadius`, `shadows`,
    `typography.fontFamily.base` (→ `--font-sans`) and `customVars`.
  - **`@object-ui/types`' `HttpMethodSchema` now binds the spec's
    `HttpMethodSubsetSchema`, and `HttpMethod` binds `HttpMethodSubset`**
    (objectstack#5832, PR objectstack#5976 — objectui#3499). The spec renamed its
    5-value UI subset because `schemaNameFromExportKey` strips the `Schema` suffix,
    so the 5-value and 7-value enums both published as `shared/HttpMethod` and the
    later write won — the emitted JSON Schema and reference page described only one
    of them. **The runtime domain is unchanged and this repo's exported names are
    unchanged**; this follows the rename without touching cross-package semantics.
    Deliberately NOT re-pointed at the spec's bare `HttpMethod`: that is the 7-value
    enum, and widening to it would let `method: 'HEAD'` compile and then throw in
    `HttpRequestSchema.parse()`.
  - **`dashboard.widgets[].actionUrl` / `actionType` / `actionIcon` / `aria` are
    refused, not stripped** (objectstack#5010, ADR-0049 enforce-or-remove). A
    dashboard widget has no action button and never had one — every action the
    dashboard dispatches comes from `header.actions[]` — and no renderer ever applied
    the widget `aria`, so it promised accessibility compliance it did not deliver.
    A stale dashboard now gets a named error telling it where the affordance moved,
    instead of silently losing it. Run `os migrate meta --from 16` to rewrite.

- e6fdbdc: Reclaim the natural names `GestureType` and `GestureConfig` (objectui#3363).

  `@objectstack/spec` 17.0.0-rc.3 deleted the whole `ui/touch` module
  (objectstack#4988, PR objectstack#5321), vacating three names objectui had
  renamed **away from** in objectstack#4115 purely to avoid a collision. Two of
  those workarounds have now outlived their reason and are undone.

  ## Breaking, in FROM → TO form

  - `TouchGestureType` → **`GestureType`** — objectui's direction-fused recogniser
    vocabulary (`tap`, `swipe-left`, `swipe-up`, …).
  - `TouchGestureConfig` → **`GestureConfig`** — the flat gesture→`action` handler
    binding.

  Both are exported from `@object-ui/types` and re-exported by `@object-ui/mobile`.
  Nothing about either shape changed: same members, same optionality. Consumers
  import the new name; there is no other edit.

  **The old names are gone, not deprecated.** This follows the precedent set by the
  objectstack#4115 rename batch that introduced them, whose own migration note reads:
  "an alias would preserve exactly the ambiguity being removed". A deprecated alias
  would be worse here than in the general case, because the ambiguity these renames
  exist to prevent is between two same-named types — leaving `TouchGestureType`
  alive next to `GestureType` restores the two-spellings-one-concept problem while
  claiming to retire it.

  The retired spec vocabulary that used to hold these names still lives in
  `@object-ui/types`' `mobile` module under its deliberate `Spec…` prefix
  (`SpecGestureType`, `SpecGestureConfig`, `SwipeGestureConfig`, …), and that prefix
  is untouched — it is now the only thing distinguishing the two contracts, so
  `useSpecGesture` still maps one onto the other exactly as before.

  ## `PWAOfflineConfig` is deliberately NOT reclaimed

  The spec vacated `OfflineConfig` in the same retirement, but the spec was never
  its only claimant: that rename was a **cross-package arbitration between two
  objectui packages**, and `@object-ui/react` won it. `useOffline`'s config is the
  offline data/sync model key for key, so it holds the bare `OfflineConfig`, while
  this package's service-worker route cache stays `PWAOfflineConfig`
  (objectui#3156 / objectui#3159).

  Before objectui#3560 that name reached `@object-ui/react` from the spec, so the
  spec-side tripwire covered it by accident. Since the retirement it is declared
  locally in `packages/react/src/hooks/useOffline.ts`, which means the spec's
  vacancy no longer says anything about whether the name is free — it is not.
  Reclaiming it would put two different `OfflineConfig` shapes on the public
  surface of two packages that are routinely imported together, which is the exact
  ambiguity objectstack#4115 renamed it away from.

  `page-nav-misc-spec-parity.test.ts` now pins that reason directly instead of
  leaving it as prose: it asserts `@object-ui/react` still declares
  `OfflineConfig`, and its failure message tells the next reader that the reclaim
  has become available if it ever stops.

### Patch Changes

- Updated dependencies [d229dfa]
- Updated dependencies [c2fd122]
- Updated dependencies [48132f7]
- Updated dependencies [7e5bb5d]
- Updated dependencies [e6fdbdc]
- Updated dependencies [7e2b7e9]
- Updated dependencies [c1e1e6b]
  - @object-ui/types@17.4.0

## 17.3.0

### Patch Changes

- Updated dependencies [d915c47]
- Updated dependencies [9e9e9a9]
- Updated dependencies [23018cc]
- Updated dependencies [f44d872]
- Updated dependencies [f833d3a]
- Updated dependencies [d22ae31]
  - @object-ui/types@17.3.0

## 17.2.0

### Minor Changes

- 726b89c: `@object-ui/types` stops declaring sixteen symbols under names `@objectstack/spec` owns (objectui#3156, objectstack#4115).

  Seven are now **derived** from the spec, nine are **renamed** to the local
  dialect they always were. Both halves remove the same hazard: a local
  declaration under a spec export's name reads as the spec's own definition to
  the next reader, so a copy that is merely _correct today_ is a planted premise
  tomorrow.

  **Derived** — the spec now supplies the keys, by reference:

  | symbol                   | derivation                                                                        |
  | :----------------------- | :-------------------------------------------------------------------------------- |
  | `ActionParam`            | `z.input<typeof ActionParamSchema>`, `type` widened to the local legacy spellings |
  | `CreateExportJobRequest` | `Omit<CreateExportJobInput, 'object'>` (`object` is the method argument)          |
  | `CreateExportJobResult`  | re-export from `@objectstack/spec/contracts`                                      |
  | `ImportRowResult`        | re-export from `@objectstack/spec/api`                                            |
  | `NavigationArea`         | spec keys, with `navigation` / `visible` pinned locally                           |
  | `NavigationAreaSchema`   | `specFieldsExcept(NavigationAreaSchema.shape, …)`                                 |
  | `Theme`                  | re-export of the spec's `ThemeInput` (the authoring shape)                        |
  | `ExportJobFormat`        | re-export of the spec's `ExportFormat`                                            |

  Four of these close real gaps rather than tidy names. `ActionParam` never
  declared `reference` — the key `resolveActionParams()` actually reads for an
  inline lookup target — nor `defaultFromRow`, which the metadata designer's own
  inspector writes; it also narrowed `visible` to a bare string although the
  resolver has always accepted the `{ dialect, source }` envelope too.
  `CreateExportJobResult.createdAt` and `ImportRowResult.action` were optional
  here and required by the server, leaving every consumer a branch that could
  never run. And `NavigationArea`'s `id` now carries the spec's own length rule
  instead of accepting any string.

  **Renamed** — same word, different concept:

  | was                | now                      | why                                                                                                                            |
  | :----------------- | :----------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
  | `FileMetadata`     | `UploadedFileMetadata`   | field-VALUE payload (`url`, `original_name`), not the storage file record                                                      |
  | `GestureType`      | `TouchGestureType`       | direction-fused (`swipe-left`), not the spec's type+direction pair                                                             |
  | `GestureConfig`    | `TouchGestureConfig`     | gesture→`action` binding, not per-gesture tuning                                                                               |
  | `OfflineConfig`    | `PWAOfflineConfig`       | service-worker route caching, not the offline data/sync model                                                                  |
  | `PageRegion`       | `PageNodeRegion`         | region of the renderer page NODE, holding `SchemaNode`s                                                                        |
  | `PageRegionSchema` | `PageNodeRegionSchema`   | zod twin of the above                                                                                                          |
  | `ResponsiveConfig` | `MobileResponsiveConfig` | mobile box config, not the spec's SDUI grid contract                                                                           |
  | `WidgetManifest`   | `RuntimeWidgetManifest`  | SDUI component manifest, not the field-widget plugin manifest                                                                  |
  | `WidgetSource`     | `RuntimeWidgetSource`    | `module`/`inline`/`registry` loader union — and its `inline` carries a resolved component where the spec's carries source code |

  **Migration**: the old names are gone, not deprecated — an alias would preserve
  exactly the ambiguity being removed. Import the new name; nothing about the
  shapes changed. `@object-ui/types` already re-exports the spec's own
  `SpecResponsiveConfig`, and `@object-ui/react`'s `useOffline` config remains the
  spec-shaped `OfflineConfig`, so both concepts stay reachable under
  distinguishable names.

  Each rename carries a bidirectional tripwire
  (`packages/types/src/__tests__/page-nav-misc-spec-parity.test.ts`): it fails if
  the spec ever claims the new name, and also if the spec retires the old one —
  at which point the natural name can be taken back rather than the workaround
  outliving its reason.

### Patch Changes

- Updated dependencies [4ae0ac4]
- Updated dependencies [696e3c1]
- Updated dependencies [4bf612c]
- Updated dependencies [cb82705]
- Updated dependencies [f572849]
- Updated dependencies [444457c]
- Updated dependencies [022e4c3]
- Updated dependencies [009e25d]
- Updated dependencies [726b89c]
  - @object-ui/types@17.2.0

## 17.1.0

### Patch Changes

- Updated dependencies [9e7349e]
- Updated dependencies [8864971]
- Updated dependencies [b41f401]
- Updated dependencies [19e9fa0]
- Updated dependencies [38ca8be]
- Updated dependencies [4952edf]
- Updated dependencies [7f0252e]
- Updated dependencies [7639a61]
- Updated dependencies [94e63ef]
- Updated dependencies [c4db402]
- Updated dependencies [5319bf1]
- Updated dependencies [49e5671]
- Updated dependencies [b5b97e2]
- Updated dependencies [f59f2c1]
- Updated dependencies [4874117]
- Updated dependencies [ce08d55]
- Updated dependencies [2374a49]
- Updated dependencies [ea7f477]
- Updated dependencies [7f23cd0]
- Updated dependencies [24e0e0a]
- Updated dependencies [3a6cf24]
- Updated dependencies [aa35561]
- Updated dependencies [03bd53b]
- Updated dependencies [3c1f321]
- Updated dependencies [a045a32]
- Updated dependencies [912496d]
- Updated dependencies [9867281]
  - @object-ui/types@17.1.0

## 17.0.0

### Patch Changes

- Updated dependencies [1767124]
- Updated dependencies [8ecf5a6]
- Updated dependencies [dfd3705]
- Updated dependencies [6dee2cb]
- Updated dependencies [c7cff19]
- Updated dependencies [cd09a7b]
- Updated dependencies [f1abf0e]
- Updated dependencies [f05b84e]
- Updated dependencies [662bdf9]
- Updated dependencies [059a052]
- Updated dependencies [53642d4]
- Updated dependencies [8aae006]
- Updated dependencies [d147a13]
  - @object-ui/types@17.0.0

## 16.1.0

### Patch Changes

- Updated dependencies [7cf4051]
- Updated dependencies [94d4876]
- Updated dependencies [2b17339]
- Updated dependencies [31b77d4]
- Updated dependencies [6d4fbe6]
- Updated dependencies [62b9ab5]
- Updated dependencies [29c6040]
- Updated dependencies [faebac3]
- Updated dependencies [199fa83]
  - @object-ui/types@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [210806a]
- Updated dependencies [b4ef588]
- Updated dependencies [5534535]
- Updated dependencies [9b8f978]
  - @object-ui/types@16.0.0

## 15.0.0

### Patch Changes

- @object-ui/types@15.0.0

## 14.1.0

### Patch Changes

- Updated dependencies [2ded18c]
- Updated dependencies [e628d1f]
- Updated dependencies [887062c]
- Updated dependencies [9e2d58f]
- Updated dependencies [d5b1bc0]
- Updated dependencies [f0f10f5]
  - @object-ui/types@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [86c69c3]
- Updated dependencies [6a74160]
  - @object-ui/types@14.0.0

## 13.2.0

### Patch Changes

- @object-ui/types@13.2.0

## 13.1.0

### Patch Changes

- @object-ui/types@13.1.0

## 13.0.0

### Patch Changes

- Updated dependencies [619097e]
  - @object-ui/types@13.0.0

## 12.1.0

### Patch Changes

- Updated dependencies [c31874d]
  - @object-ui/types@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [226fde9]
- Updated dependencies [e4de456]
  - @object-ui/types@12.0.0

## 11.5.0

### Patch Changes

- Updated dependencies [9255686]
- Updated dependencies [1072701]
  - @object-ui/types@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [8bf6295]
- Updated dependencies [1948c5b]
- Updated dependencies [c38d107]
  - @object-ui/types@11.4.0

## 11.3.0

### Patch Changes

- @object-ui/types@11.3.0

## 11.2.0

### Patch Changes

- @object-ui/types@11.2.0

## 11.1.0

### Patch Changes

- @object-ui/types@11.1.0

## 7.3.0

### Patch Changes

- @object-ui/types@7.3.0

## 7.2.0

### Patch Changes

- Updated dependencies [d23db5c]
  - @object-ui/types@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [677f7ed]
- Updated dependencies [a71be60]
- Updated dependencies [cb03bc3]
  - @object-ui/types@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [ddbe4a2]
- Updated dependencies [9049bbe]
- Updated dependencies [cb2fdb1]
- Updated dependencies [6cfa330]
- Updated dependencies [ad8ade6]
- Updated dependencies [3870c20]
- Updated dependencies [b88c560]
- Updated dependencies [d16566f]
- Updated dependencies [300d755]
- Updated dependencies [4eb9cb6]
- Updated dependencies [858ad94]
  - @object-ui/types@7.0.0

## 6.2.3

### Patch Changes

- @object-ui/types@6.2.3

## 6.2.2

### Patch Changes

- @object-ui/types@6.2.2

## 6.2.1

### Patch Changes

- @object-ui/types@6.2.1

## 6.2.0

### Patch Changes

- @object-ui/types@6.2.0

## 6.1.0

### Patch Changes

- Updated dependencies [991b62d]
  - @object-ui/types@6.1.0

## 6.0.4

### Patch Changes

- @object-ui/types@6.0.4

## 6.0.3

### Patch Changes

- @object-ui/types@6.0.3

## 6.0.2

### Patch Changes

- @object-ui/types@6.0.2

## 6.0.1

### Patch Changes

- @object-ui/types@6.0.1

## 6.0.0

### Patch Changes

- @object-ui/types@6.0.0

## 5.4.2

### Patch Changes

- @object-ui/types@5.4.2

## 5.4.1

### Patch Changes

- @object-ui/types@5.4.1

## 5.4.0

### Patch Changes

- Updated dependencies [3a8c754]
  - @object-ui/types@5.4.0

## 5.3.2

### Patch Changes

- @object-ui/types@5.3.2

## 5.3.1

### Patch Changes

- @object-ui/types@5.3.1

## 5.3.0

### Patch Changes

- @object-ui/types@5.3.0

## 5.2.1

### Patch Changes

- @object-ui/types@5.2.1

## 5.2.0

### Patch Changes

- Updated dependencies [de0c5e6]
- Updated dependencies [9997cae]
- Updated dependencies [70b5570]
  - @object-ui/types@5.2.0

## 5.1.1

### Patch Changes

- @object-ui/types@5.1.1

## 5.1.0

### Patch Changes

- Updated dependencies [cf30cc2]
- Updated dependencies [5b80cfd]
  - @object-ui/types@5.1.0

## 5.0.2

### Patch Changes

- @object-ui/types@5.0.2

## 5.0.1

### Patch Changes

- @object-ui/types@5.0.1

## 5.0.0

### Patch Changes

- Updated dependencies [7213027]
  - @object-ui/types@5.0.0

## 4.8.0

### Patch Changes

- @object-ui/types@4.8.0

## 4.7.0

### Patch Changes

- @object-ui/types@4.7.0

## 4.6.0

### Patch Changes

- @object-ui/types@4.6.0

## 4.5.0

### Patch Changes

- Updated dependencies [ab5e281]
  - @object-ui/types@4.5.0

## 4.4.0

### Patch Changes

- @object-ui/types@4.4.0

## 4.3.1

### Patch Changes

- @object-ui/types@4.3.1

## 4.3.0

### Patch Changes

- @object-ui/types@4.3.0

## 4.2.1

### Patch Changes

- @object-ui/types@4.2.1

## 4.2.0

### Patch Changes

- @object-ui/types@4.2.0

## 4.1.0

### Patch Changes

- @object-ui/types@4.1.0

## 4.0.12

### Patch Changes

- @object-ui/types@4.0.12

## 4.0.11

### Patch Changes

- @object-ui/types@4.0.11

## 4.0.10

### Patch Changes

- @object-ui/types@4.0.10

## 4.0.9

### Patch Changes

- @object-ui/types@4.0.9

## 4.0.8

### Patch Changes

- @object-ui/types@4.0.8

## 4.0.7

### Patch Changes

- @object-ui/types@4.0.7

## 4.0.6

### Patch Changes

- @object-ui/types@4.0.6

## 4.0.5

### Patch Changes

- @object-ui/types@4.0.5

## 4.0.4

### Patch Changes

- @object-ui/types@4.0.4

## 4.0.3

### Patch Changes

- 4be43e2: **Page-mode record forms (`editMode: 'page'`).** New per-object metadata flag that opts a record's create/edit form into a dedicated full-screen route (`/apps/:appName/:objectName/new`, `/apps/:appName/:objectName/record/:recordId/edit`). Two new declarative actions `navigate_create` and `navigate_edit` open these routes from JSON action buttons. Default modal behavior is preserved for objects that do not set `editMode`.

  **`@object-ui/plugin-list` & `@object-ui/plugin-detail`: `ComponentRegistry` singleton fix.** Both plugins' Vite configs now mark all `@object-ui/*` packages as external so each plugin no longer bundles its own private copy of `@object-ui/core`. Cross-plugin component lookups now resolve correctly from the same singleton registry. `plugin-list` dist shrank from multi-MB to 67 kB (gzip 16 kB); `plugin-detail` to 124 kB (gzip 28 kB).

  **`@object-ui/app-shell` `CreateViewDialog` churn fix.** `existingSet` is now memoised on the joined string key of `existingLabels` rather than the raw array reference, preventing the name-suggest `useEffect` from re-firing on every parent render.

  **CI fixes.** `ReportViewer` conditional-formatting test now accepts both `rgb(...)` and hex color representations. `ObjectView` i18n mocks rewritten to mirror the real hook shapes (`useObjectTranslation`, `useObjectLabel`).

- Updated dependencies [4be43e2]
  - @object-ui/types@4.0.3

## 4.0.1

### Patch Changes

- @object-ui/types@4.0.1

## 4.0.0

### Patch Changes

- Updated dependencies
  - @object-ui/types@4.0.0

## 3.4.0

### Patch Changes

- a2d7023: End-user feature batch — forms, designer history, import/export, and PWA offline sync.

  **Forms (`@object-ui/fields`, `@object-ui/providers`)**

  - `FileField`: native `<input capture="environment">` camera capture for mobile devices, plus a uploading-progress indicator driven by `UploadProvider`.
  - `ImageField`: per-image inline crop/rotate via the lazy-loaded `ImageCropperDialog` (canvas-based, zero new deps).
  - New `UploadProvider` in `@object-ui/providers` with pluggable adapters for S3 and Azure Blob (plus the default object-URL adapter for local previews). XHR-based with progress, abort, and retry.
  - `LookupField`: `lookup.dependsOn: string | string[]` to chain dependent lookups (e.g. State depends on Country); the trigger is gated until parent values are present and the OData `$filter` is built automatically.

  **Container-aware widget widths (`@object-ui/components`)**

  - New `useResizeObserver(ref)` hook exposing `{ width, height }` of any element. SSR-safe; reads the initial size via `getBoundingClientRect`.
  - `plugin-gantt` and `plugin-kanban` now react to their container size instead of `window.innerWidth`, so they behave correctly inside split panels and dashboards.

  **Designer history (`@object-ui/plugin-designer`)**

  - `useUndoRedo` (and therefore `useDesignerHistory`) gains `persistKey` + `storage` options to round-trip the undo/redo stack through `sessionStorage`, plus a `clearPersisted()` cleanup helper. Drafts now survive accidental tab refreshes.
  - New `<HistoryPanel>` component renders the timeline visually with one-click jump-to-checkpoint via the new `jumpTo(index)` API.

  **Import wizard (`@object-ui/plugin-grid`)**

  - Saved column-mapping templates: name, save, re-apply, and delete via a new template bar in the mapping step. Persisted under `objectui:import-templates:${objectName}` (override via `templateStorageKey` / `templateStorage`).
  - Inline validation correction: cells with errors in the preview step are now editable; corrections feed straight into the import without requiring a re-upload, with green-bar status indicators for fixed rows.

  **PWA offline sync (`@object-ui/mobile`)**

  - New `MemoryOfflineQueue` / `IndexedDbOfflineQueue` (`createOfflineQueue()` picks the best backend) backed by IndexedDB.
  - `createOfflineDataSource(inner, { queue })` wraps any DataSource so mutations issued while offline (or that fail with a network-style error) are queued and replayed in order on reconnect. Includes `replay()`, `drop()`, `clear()`, `pending()`, an `onChange` notifier, and an opt-in `resolveConflict` hook for stale-write conflicts.
  - New `useOfflineSync(source)` hook exposes `{ isOnline, pending, isReplaying, replay, drop, clear }` and auto-replays on the browser's `online` event.
  - `getServiceWorkerSource(opts)` emits a customisable Service Worker that pre-caches the app shell, applies network-first to API requests, and broadcasts `REPLAY_QUEUE` to clients on Background Sync. `requestBackgroundSync(tag)` registers a one-shot sync from the page.

- Updated dependencies [f1ca238]
- Updated dependencies [de881ef]
  - @object-ui/types@3.4.0

## 3.3.2

### Patch Changes

- @object-ui/types@3.3.2

## 3.3.1

### Patch Changes

- @object-ui/types@3.3.1

## 3.3.0

### Patch Changes

- @object-ui/types@3.3.0

## 3.2.0

### Patch Changes

- @object-ui/types@3.2.0

## 3.1.5

### Patch Changes

- @object-ui/types@3.1.5

## 3.1.4

### Patch Changes

- @object-ui/types@3.1.4

## 3.1.3

### Patch Changes

- @object-ui/types@3.1.3

## 3.1.2

### Patch Changes

- @object-ui/types@3.1.2

## 3.1.1

### Patch Changes

- Updated dependencies
  - @object-ui/types@3.1.1

## 3.0.3

### Patch Changes

- @object-ui/types@3.0.3

## 3.0.2

### Patch Changes

- @object-ui/types@3.0.2

## 3.0.1

### Patch Changes

- @object-ui/types@3.0.1

## 3.0.0

### Minor Changes

- 87979c3: Upgrade to @objectstack v3.0.0 and console bundle optimization
  - Upgraded all @objectstack/\* packages from ^2.0.7 to ^3.0.0
  - Breaking change migrations: Hub → Cloud namespace, definePlugin removed, PaginatedResult.value → .records, PaginatedResult.count → .total, client.meta.getObject() → client.meta.getItem()
  - Console bundle optimization: split monolithic 3.7 MB chunk into 17 granular cacheable chunks (95% main entry reduction)
  - Added gzip + brotli pre-compression via vite-plugin-compression2
  - Lazy MSW loading for build:server (~150 KB gzip saved)
  - Added bundle analysis with rollup-plugin-visualizer

### Patch Changes

- Updated dependencies [87979c3]
  - @object-ui/types@3.0.0

## 2.0.0

### Major Changes

- b859617: Release v1.0.0 — unify all package versions to 1.0.0

### Patch Changes

- Updated dependencies [b859617]
  - @object-ui/types@2.0.0

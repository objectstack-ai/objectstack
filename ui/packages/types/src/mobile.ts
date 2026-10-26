/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Mobile Optimization Types
 * 
 * Type definitions for mobile-responsive components, PWA support,
 * and touch gesture handling.
 * 
 * @module mobile
 * @packageDocumentation
 */

// ============================================================================
// RETIRE-VS-REMOVE DISCRIMINATOR — cited in this file, never restated
// (objectui#9684)
// ============================================================================
//
// Four retirement notes below argue a route: `MobileResponsiveConfig`,
// `MobileOverrides`, `GestureConfig` and `MobileComponentConfig`. Each keeps
// its own per-retirement argument — WHICH prong holds here and why, which no
// shared statement can carry — and CITES the rule itself instead of writing
// it out. The statement they cite is the `ChatbotSchema` JSDoc in
// `complex.ts`, in its amended form, `5f8190c8c` (objectui#5941 /
// #7526 are the precedent changesets it is quoted from).
//
// ⛔ That is the statement this file cites; it is NOT the only one in the
// package. `complex.ts` states the rule at four sites — `ChatbotSchema` among
// three peers (`KanbanColumn.color`, `displayMode`, `triggerIcon`) — and
// whether those four become citations too is the open decision on
// objectui#9684. ⇒ ⛔ do not read this block as saying the rule is stated once
// here, and ⛔ do not amend `ChatbotSchema` alone: the pin named below fails
// when the four stop agreeing, but only for the clauses it can name.
//
// ⭐ Why cite at all: a rule written out in full at N sites is amended at N
// sites by hand, and the drift is SILENT — the sites do not reference each
// other, so nothing goes red when one is missed. Measured on this branch's
// base: eight statements of the rule across the two files, two of them still
// without the precondition the amendment added, and both of those two in this
// file. Neither was named by the finding that measured the drift
// (objectui#9684), whose probe enumerated the population by literal phrase.
//
// ⚠️ The trade a citation costs a reader is not the same on both faces, which
// is why `complex.ts` still states the rule and this file no longer does:
// these notes are `//` comments and `complex.ts` states the rule in JSDoc on
// exported members, and declaration emit carries JSDoc into the published
// `.d.ts` while it drops a `//` comment — measured on objectui#9684, including
// a `//` comment placed directly above an exported declaration, so the
// dividing line is JSDoc-vs-line-comment and ⛔ not module-scope-vs-attached.
// So a citation is free for a consumer reading the published declarations here
// and would cost one a jump there. The structural half of that contrast is
// re-derived by `__tests__/tombstone-discriminator-agreement-9684.test.ts`;
// the reading of the emitted `.d.ts` behind it is recorded on objectui#9684
// and is ⛔ NOT re-derived by anything, so re-run it rather than trusting it.
//
// The agreement itself is pinned by that same test. It fails when a note in
// this package states the rule without carrying the precondition in the rule's
// OWN phrasing (⛔ not merely having the words "no carrier" somewhere in the
// block — that wording let an un-amended statement through, measured); when
// ANY comment in this package outside `complex.ts` states the rule at all,
// prongs written out or not — this file has no special standing there, a
// `//` riding on a code line is in the population too, and two ABUTTING
// comments are two blocks rather than one, so a drifted copy glued to a
// compliant neighbour cannot borrow its precondition; when a citation's
// target has moved; when `complex.ts` states the rule at any number of sites
// other than the recorded four; and when a clause appears at one of those four
// and not at its peers.
//
// ⚠️ The first two of those widenings are the fourth in-seat review's: with
// the old `mobile.ts`-only scope, a fully amended statement prepended to
// `data-display.ts` passed — a fifth statement, off the roster, free to drift
// at the next amendment with nothing red, which is the mechanism this card is
// about reopened one file over. With the old comment-only-lines population, a
// statement appended to an `export interface` line passed for the same reason.
// The third is the fifth review's: a blank line was the only thing that ended
// a comment run, so an un-amended note wedged between the `ChatbotSchema`
// JSDoc's closing delimiter and the declaration — or stacked directly above
// that JSDoc — read as ONE block with it, inherited its precondition and its
// roster slot, and passed. A human read five statements where the test counted
// four. Control that says the test was not merely blind: the same note with a
// blank line between reds 4.
//
// ⚠️ For the clauses that test names, in the spellings it names: a third prong
// is caught written `prong 3`, `third prong`, `(3)`, or as `or` followed by
// `3`, `iii`, `third` or `thirdly`. The `or` in that last item is an ANCHOR —
// `3`, `iii`, `third` and `thirdly` are caught ONLY directly behind `or`, with
// nothing in between but commas, whitespace and opening parentheses, ANY
// NUMBER of them in ANY ORDER. So `, or ( 3 ) …`, `, or ,3 …`, `, or, (iii) …`
// and `, or (( 3 )) …` are each CAUGHT, while `, and (iii) …`,
// `, or else (iii) …`, `; and, third, …` and `, or: (iii) …` are each SILENT.
// The other three spellings carry no anchor: `prong 3`, `third prong` and a
// parenthesised `(3)` are caught however the clause is joined, `, and (3) …`
// included. Silent as well: a clause that numbers nothing, and a whole
// statement worded past every marker.
// ⛔ Read that list from the test, ⛔ never a summary of it — this sentence
// FOUR times described a boundary one step off the real one, and each time a
// reader amending the rule in the uncaught style would have believed the other
// three sites were held. ⭐ The fourth time is why "in any order" is written
// out: the sentence named the three permitted characters as a SET while the
// pattern required them in one SEQUENCE, so `, or ( 3 ) …` and `, or ,3 …`
// broke no published sentence and were silent anyway. That one was closed by
// widening the PATTERN to the set, ⛔ not by describing the sequence.

// ============================================================================
// Responsive Configuration
// ============================================================================

/**
 * Breakpoint names — the Tailwind-style `xs`…`2xl` layout vocabulary, owned by
 * this package since objectui#7580 (maintainer ruling 2026-09-04, option A).
 *
 * ## Answering objectstack#4115 rather than deleting it
 *
 * This was bound to `@objectstack/spec/ui` instead of re-declared, under the
 * reason objectstack#4115 recorded here verbatim: "a local union under a spec
 * export's name is read by the next reader as the spec's own definition, so a
 * copy that is correct today is a planted premise tomorrow." That reason was
 * correct, and it is now SPENT — not overruled.
 *
 * objectstack#11027 retired the whole `ui/responsive` vocabulary upstream
 * (`ResponsiveConfigSchema`, `BreakpointName`, `BreakpointColumnMapSchema`,
 * `BreakpointOrderMapSchema`), leaving a tombstone and the protocol-18
 * conversion in `RETIRED_DEFS_BY_MAJOR[18]`. So there is no spec definition
 * left for a reader to mistake this one for: this is not a copy that may drift
 * from an original, it is the only declaration of the name that will exist.
 * A planted premise needs something to be wrong ABOUT.
 *
 * ## Why re-homed and not retired with the key
 *
 * The retirement's stated ground — that these types "had no other authorable
 * carrier" — is a claim about the whole surface, and it is measurably false on
 * this side. This union is the key set of `GridSchema.columns` (`./layout.ts`),
 * so the `grid` node's breakpoint `columns` object is an authorable carrier
 * that `@object-ui/components`' grid renderer applies on the render path.
 * (Until objectui#11441 this paragraph named `responsive-grid`, whose
 * `columns` input the sibling `BreakpointColumnMap` in `@object-ui/layout`
 * types. The maintainer's ruling `5950208338` retired that registration, kept
 * the vocabulary, and named `grid` the one authorable breakpoint grid.)
 * This union types four live readers here: `breakpoints.ts`
 * (`BREAKPOINTS`, `BREAKPOINT_ORDER`, `getCurrentBreakpoint`),
 * `useBreakpoint.ts`, `ResponsiveContainer.tsx`, and {@link ResponsiveValue}
 * below. The tombstone's own return condition — the vocabulary "returns if and
 * when a renderer implements it" — is already met over here.
 *
 * ⚠️ Members are the retired enum's, verbatim, and must stay so: the six
 * `xs`…`2xl` keys that `BreakpointColumnMap` is keyed by.
 * `__tests__/spec-derived-unions.test.ts` pins the width, so narrowing this
 * union fails to compile rather than silently dropping a breakpoint.
 *
 * ⏳ Interim, and it self-expires: the pin is still `@objectstack/spec` 17.2.0,
 * which PRE-dates the retirement and so still exports this name. The collision
 * is therefore real today and carries a reasoned entry in
 * `scripts/check-spec-symbol-derivation.mjs`. That entry cannot outlive the
 * interval — the guard's ratchet 3 fails an ALLOW entry that excuses nothing —
 * so the pin bump is forced to delete it and pin the vacancy instead, exactly
 * as objectui#5716's theme localization was on the 17.2.0 refresh.
 */
export type BreakpointName = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

/** Responsive value - different values for different breakpoints */
export type ResponsiveValue<T> = T | Partial<Record<BreakpointName, T>>;

// RETIRED (objectui#7519, ADR-0049 enforce-or-remove): `MobileResponsiveConfig`
// — the mobile renderer's box config (`columns` as a bare number or per
// breakpoint, `gap`, `padding`, `stackOnMobile` / `stackBreakpoint`, `hidden` /
// `showOnly`) — is gone, not narrowed. Its only consumer was the `responsive`
// member of `MobileComponentConfig`, retired below by objectui#5942 (PR
// objectui#7526); once that container went, the type was a declaration plus
// two barrel re-exports and nothing else. Re-measured before removal: no type
// mounted it, nothing extended, annotated, cast to or imported it outside the
// two barrels, and the example apps and the `objectstack` sibling checkout had
// zero authors. A value written against it could not reach a renderer by any
// path.
//
// Removed outright rather than tombstoned, measured against this package's
// retire-vs-remove discriminator — cited, not restated (see this file's
// `RETIRE-VS-REMOVE DISCRIMINATOR` preamble; the rule is stated on
// `ChatbotSchema` in `complex.ts`, in its amended form (`5f8190c8c`),
// from the precedent changesets objectui#5941 / #7526).
// `MobileResponsiveConfig` is a whole exported type name, so it has no
// carrier to host a `?: never` member at all and the surviving-carrier
// precondition settles the route on its own; the per-prong measurement that
// follows was taken anyway and is kept as the record.
// Prong 1: none — its distinctive keys (`stackOnMobile`, `showOnly`,
// `stackBreakpoint`) have zero readers outside this declaration, and no
// mounted type has carried a `responsive` member since objectui#5942.
// Prong 2: the only CHANGELOG lines naming it are the objectstack#4115
// rename-ledger row (`ResponsiveConfig` -> `MobileResponsiveConfig`, "mobile
// box config"), replicated per package; no line taught a renderer reading it
// and no member carried a published `@default`. Whether a rename-ledger row
// counts as "taught as working" is recorded on objectui#7519 rather than
// decided here. Structurally there is no silent-strip hazard for prong 2 to
// guard: the whole interface goes, nothing ever parsed it, and there is no Zod
// mirror to host a `retirementTombstone()` — this module has never had a
// `zod/` twin — so the refusal is the compiler's own (TS2305 at the import),
// already loud.
//
// History kept because it explains the name: this was renamed off the spec's
// `ResponsiveConfig` in objectstack#4115 — the spec's is the SDUI grid contract
// (`{ breakpoint, hiddenOn, columns, order }`), a different vocabulary. The
// `__tests__/page-nav-misc-spec-parity.test.ts` rows that pinned the rename
// retired with the type: a name this package no longer exports cannot collide
// with anything, so a pin on it would guard nothing. The absence itself is
// pinned in `__tests__/mobile-residue-retired-7519.test.ts`.
//
// No BEHAVIOUR is retired here. Per-breakpoint layout lives in
// `@object-ui/mobile` as `useResponsive` / `ResponsiveContainer` /
// `useBreakpoint`, and `ResponsiveValue` above stays — `breakpoints.ts` and
// `useResponsive.ts` read it.
//
// Reopen condition: a declarative mobile box-layout surface re-enters as
// designed product surface on its own card, with the renderer that READS it
// landing in the same change as the declaration.

// RETIRED (objectui#4919, maintainer ruling 2026-08-19, ADR-0049
// enforce-or-remove): the mobile component-override surface and its mount
// point on `MobileComponentConfig` are gone, not narrowed. Every member was
// declaration-only — nothing in this repo, the example apps, or the
// `objectstack` sibling checkout ever read the property, so all six keys
// behaved identically (they did nothing), and the navigation vocabulary's
// three values were three spellings of the same no-op. Removal rather than a
// `?: never` tombstone follows this package's retire-vs-remove discriminator
// — cited, not restated (see this file's `RETIRE-VS-REMOVE DISCRIMINATOR`
// preamble; the rule is stated on `ChatbotSchema` in `complex.ts`, in its
// amended form, `5f8190c8c`).
//
// Neither branch reaches this retirement. The surviving-carrier precondition
// settles it first: an exported type name that goes whole has no carrier to
// host a `?: never` member at all. And where a member did have one, prong 1
// fails — the named live replacements it points at elsewhere in this package
// (`crud.ts` `confirm` → `confirmText`; `data-display.ts` `hoverable` /
// `striped` → `data-table`) have no analogue here, the same zero-pull /
// no-successor shape as the retired `AccordionItem.icon` /
// `ToggleGroupItem.icon`, which were likewise removed outright rather than
// tombstoned — and prong 2 has nothing to guard: this module has never had a
// `zod/` twin, so there is no mirror that could accept an undeclared key and
// strip it silently, which is the hazard prong 2 guards where a mirror does
// exist. ⛔ The route itself is settled (objectui#4919); this note states the
// rule it followed and does not reopen it.
//
// Reopen condition, recorded on objectui#4919: real mobile-override renderer
// work re-enters as designed product surface on its own card, with the
// renderer landing in the same change as the declaration. Re-adding the
// declaration alone is the declare-without-enforce shape this removal exists
// to close.

// ============================================================================
// PWA Support
// ============================================================================

/** PWA configuration */
export interface PWAConfig {
  /** Enable PWA support */
  enabled: boolean;
  /** App name */
  name: string;
  /** Short name for home screen */
  shortName: string;
  /** App description */
  description?: string;
  /** Theme color */
  themeColor?: string;
  /** Background color */
  backgroundColor?: string;
  /** Display mode */
  display?: 'standalone' | 'fullscreen' | 'minimal-ui' | 'browser';
  /** App icons */
  icons?: PWAIcon[];
  /** Start URL */
  startUrl?: string;
  /** Scope */
  scope?: string;
  /** Orientation */
  orientation?: 'any' | 'portrait' | 'landscape';
}

/** PWA icon definition */
export interface PWAIcon {
  /** Icon URL */
  src: string;
  /** Icon sizes (e.g., '192x192') */
  sizes: string;
  /** MIME type */
  type?: string;
  /** Purpose */
  purpose?: 'any' | 'maskable' | 'monochrome';
}

/** Offline caching strategy */
export type FetchCacheStrategy = 'cache-first' | 'network-first' | 'stale-while-revalidate' | 'network-only' | 'cache-only';

/**
 * Offline configuration for the **PWA service worker** — which routes are
 * cached, with which fetch strategy.
 *
 * Renamed off the spec's `OfflineConfig` name (objectstack#4115): the spec's is
 * the application-level offline DATA model — `{ enabled, strategy, cache: {
 * persistStorage, evictionPolicy, ttl }, sync: { conflictResolution,
 * retryInterval, batchSize }, offlineIndicator, queueMaxSize }` — i.e. the
 * mutation queue and its storage backend. This one sits a layer below, next to
 * {@link PWAConfig} and {@link PWAIcon}: a list of URL patterns
 * ({@link OfflineRoute}) paired with {@link FetchCacheStrategy}, the
 * service-worker fetch ordering. Its `defaultStrategy`/`syncStrategy` are
 * kebab-case; the spec's are snake_case — two vocabularies, one name.
 *
 * The spec's shape is modelled in objectui by `@object-ui/react`'s
 * `useOffline` config, which keeps the spec's name (and its ledger entry,
 * objectui#3159) precisely because it IS that concept.
 *
 * **The prefix is NOT reclaimable, unlike its two gesture siblings**
 * (objectui#3363). `@objectstack/spec` did vacate `OfflineConfig` when
 * `ui/offline` was deleted (objectstack#4988, PR objectstack#5321) — but the
 * spec was never the only claimant. This rename was a CROSS-PACKAGE
 * arbitration between two objectui packages, and `@object-ui/react` won it:
 * `useOffline`'s config is the offline DATA model key for key, so it holds
 * `OfflineConfig`. Since objectui#3560 that name is declared locally in
 * `packages/react/src/hooks/useOffline.ts` rather than re-exported from the
 * spec, so the retirement did not free it — it only changed who owns it.
 * Taking it back here would put two different `OfflineConfig` shapes on the
 * public surface of two packages that are routinely imported together, which
 * is the exact ambiguity objectstack#4115 renamed this away from.
 *
 * Tripwire: `__tests__/page-nav-misc-spec-parity.test.ts` (both the spec side
 * and the `@object-ui/react` owner, so neither reason can expire unnoticed).
 */
export interface PWAOfflineConfig {
  /** Enable offline support */
  enabled: boolean;
  /** Default caching strategy */
  defaultStrategy: FetchCacheStrategy;
  /** Routes with specific caching strategies */
  routes?: OfflineRoute[];
  /** Maximum cache size in bytes */
  maxCacheSize?: number;
  /** Cache expiration in seconds */
  cacheExpiration?: number;
  /** Objects to cache for offline access */
  offlineObjects?: string[];
  /** Sync strategy when back online */
  syncStrategy?: 'immediate' | 'background' | 'manual';
  /** Conflict resolution strategy */
  conflictResolution?: 'server-wins' | 'client-wins' | 'manual';
}

/** Offline route configuration */
export interface OfflineRoute {
  /** URL pattern (glob or regex) */
  pattern: string;
  /** Caching strategy for this route */
  strategy: FetchCacheStrategy;
  /** Cache name */
  cacheName?: string;
  /** Cache expiration override */
  expiration?: number;
}

// ============================================================================
// Touch Gestures
// ============================================================================

/**
 * Touch gesture types — objectui's **direction-fused** gesture vocabulary.
 *
 * Held the prefixed name `TouchGestureType` from objectstack#4115 until
 * objectui#3363: `@objectstack/spec` owned `GestureType`, and the two unions
 * agree on only three members (the spec modelled gesture and direction
 * separately — `swipe | pinch | long_press | double_tap | drag | rotate | pan`,
 * with direction inside its tuning record's `swipe.direction`, the shape now
 * owned here as {@link SpecGestureConfig} — while objectui
 * folds direction into the name: `swipe-left`, `swipe-up`, …). Neither was a
 * subset of the other; objectui has `tap`, the spec had `drag`.
 *
 * `@objectstack/spec` 17.0.0-rc.3 deleted the whole `ui/touch` module
 * (objectstack#4988, PR objectstack#5321), vacating the name, so the natural
 * name is reclaimed here rather than letting the workaround outlive its reason
 * (objectui#3169). The retired spec vocabulary still lives in this file, under
 * the deliberately prefixed {@link SpecGestureType} — that prefix is what now
 * carries the distinction the `Touch` prefix used to.
 *
 * Tripwire: `__tests__/page-nav-misc-spec-parity.test.ts` — it fails if the
 * spec ever claims `GestureType` back.
 */
export type GestureType ='tap' | 'double-tap' | 'long-press' | 'swipe-left' | 'swipe-right' | 'swipe-up' | 'swipe-down' | 'pinch' | 'rotate' | 'pan';

// RETIRED (objectui#7519, ADR-0049 enforce-or-remove): `GestureConfig` — the
// flat handler binding `{ type: GestureType, action, threshold?, duration?,
// preventDefault?, enabled? }` — is gone, not narrowed. Its only consumer was
// the `gestures` member of `MobileComponentConfig`, retired below by
// objectui#5942 (PR objectui#7526); once that container went, the type was a
// declaration plus two barrel re-exports and nothing else. Re-measured before
// removal: `useGesture` reads `GestureType` and `GestureContext`, never this
// record, and nothing in this repo, the example apps or the `objectstack`
// sibling checkout annotated, cast to or imported it outside the two barrels.
// A binding written against it could not reach a handler by any path —
// `action` was a string nothing dispatched.
//
// Removed outright rather than tombstoned, measured against the discriminator
// the precedent changesets state (objectui#5941, #7526), in its amended
// form (`5f8190c8c`) — cited, not restated (see this file's
// `RETIRE-VS-REMOVE DISCRIMINATOR` preamble; the rule is stated on
// `ChatbotSchema` in `complex.ts`). `GestureConfig` is a whole exported type
// name, so it has no carrier to host a `?: never` member at all and the
// surviving-carrier precondition settles the route on its own; the per-prong
// measurement that follows was taken anyway and is kept as the record.
// Prong 1: none — no
// dispatcher reads a gesture `action` (zero hits), and the only `gestures` key
// on any type is `TouchInteraction.gestures: SpecGestureConfig[]`, a different
// contract with no reader of its own. Prong 2: the CHANGELOG lines naming it
// are the objectstack#4115 rename-ledger row (`GestureConfig` ->
// `TouchGestureConfig`) and the objectui#3363 reclaim note ("the flat
// gesture->`action` handler binding ... nothing about either shape changed");
// no line taught a dispatcher reading it, no `@example`, and no member carried
// a published `@default`. Whether a reclaim note counts as "taught as working"
// is recorded on objectui#7519 rather than decided here. Structurally there is
// no silent-strip hazard for prong 2 to guard: the whole interface goes,
// nothing ever parsed it (`skills/objectui/guides/mobile.md` teaches
// `useGesture`), and there is no Zod mirror to host a `retirementTombstone()`
// — this module has never had a `zod/` twin — so the refusal is the compiler's
// own (TS2724 at the import), already loud. The absence is pinned in
// `__tests__/mobile-residue-retired-7519.test.ts`.
//
// ⚠️ `SpecGestureConfig` below is NOT a successor. It is the retired
// `@objectstack/spec` `ui/touch` TUNING record (`{ type, label, enabled, swipe,
// pinch, longPress }`) that `useSpecGesture` reads, and it has no `action`
// member; a compiler "Did you mean" near-match on that name is lexical, not a
// migration target. What this type named — binding a gesture to a handler —
// lives in `@object-ui/mobile`'s `useGesture` options (`type` + `onGesture`).
//
// History kept because it explains the name: this held the prefixed name
// `TouchGestureConfig` from objectstack#4115 until objectui#3363 reclaimed the
// natural name once the spec vacated it (objectstack#4988). The
// `__tests__/page-nav-misc-spec-parity.test.ts` row that pinned the reclaim
// retired with the type: a name this package no longer exports cannot collide
// with anything, so a pin on it would guard nothing. `GestureType` keeps its
// row — it is live, read by `useGesture` and `useSpecGesture`.
//
// Reopen condition: a declarative gesture-binding surface re-enters as designed
// product surface on its own card, with the dispatcher that READS `action`
// landing in the same change as the declaration.

/** Touch gesture context */
export interface GestureContext {
  /** Gesture type that was detected */
  type: GestureType;
  /** Start position */
  startPosition: { x: number; y: number };
  /** End position */
  endPosition: { x: number; y: number };
  /** Distance traveled */
  distance: number;
  /** Direction of movement */
  direction?: 'up' | 'down' | 'left' | 'right';
  /** Duration of gesture in milliseconds */
  duration: number;
  /** Velocity (pixels per millisecond) */
  velocity: number;
  /** Scale for pinch gestures */
  scale?: number;
  /** Rotation angle for rotate gestures */
  rotation?: number;
}

// RETIRED (objectui#5942, ADR-0049 enforce-or-remove): `MobileComponentConfig`
// — the free-floating "mobile component schema extension" that published
// `responsive`, `gestures`, `pullToRefresh` and `infiniteScroll` — is gone, not
// narrowed. It never had a MOUNT POINT: no type mounted it as a property, no
// declaration extended it, and nothing in this repo, the example apps or the
// `objectstack` sibling checkout annotated, cast to or imported it outside the
// two barrel re-exports. A value written against it could not reach a renderer
// by any path, so all four keys behaved identically — they did nothing.
// objectui#4919 removed its last member (`mobileOverrides`), which is what left
// the container itself inert.
//
// Removed outright rather than kept as a `?: never` carcass, on this package's
// retire-vs-remove discriminator — cited, not restated (see this file's
// `RETIRE-VS-REMOVE DISCRIMINATOR` preamble; the rule is stated on
// `ChatbotSchema` in `complex.ts`). `MobileComponentConfig` is a whole
// exported type name — the whole interface goes, so there is no surviving
// carrier to hang a `never` key on — and the precondition settles the route
// on its own. Neither prong reaches it either: the named live replacements
// prong 1 points at elsewhere in this package (`crud.ts` `confirm` ->
// `confirmText`; `data-display.ts` `hoverable`/`striped` -> `data-table`)
// have no analogue here, and no documentation ever described it —
// `skills/objectui/guides/mobile.md` teaches the HOOKS and never this type.
// Same zero-pull, no-successor shape as `MobileOverrides` (objectui#4919), and
// as `AccordionItem.icon` / `ToggleGroupItem.icon` before it.
//
// No BEHAVIOUR is retired here. What the four keys named lives in
// `@object-ui/mobile` as real React hooks — `useResponsive` /
// `ResponsiveContainer`, `useGesture`, `usePullToRefresh` — which is where the
// working code always was; only the declaration nothing read is gone.
//
// Reopen condition: a declarative mobile component-config surface re-enters as
// designed product surface on its own card, with the renderer that READS it
// landing in the same change as the declaration. Re-adding the declaration
// alone is the declare-without-enforce shape this removal exists to close.

// ============================================================================
// Spec Touch Vocabulary (formerly `@objectstack/spec/ui`)
// ============================================================================
// `@objectstack/spec` 17.0.0-rc.3 deleted the whole `ui/touch` module along
// with the four other interaction-config modules (objectstack#4988, PR
// objectstack#5321). None of them had an authoring door — no metadata document
// could ever carry a touch block — so the platform stopped publishing
// vocabulary nothing could author, and a stack that parsed before the
// retirement parses byte-for-byte the same after it.
//
// The declarations below are that vocabulary moved here verbatim: same keys,
// same members, same optionality as the retired `z.infer` types this file's
// consumers used to reach through the `@objectstack/spec/ui` re-export block in
// `index.ts`. `@object-ui/mobile`'s `useSpecGesture` / `useTouchTarget` are the
// only implementations of these semantics in the repo, so this package is now
// their owner. Nothing about either hook's behaviour changes.
//
// The `Spec…` prefix on {@link SpecGestureConfig} is kept deliberately, and
// objectui#3363 has now made it the ONLY thing carrying the distinction: the
// sibling dialect above shed its own `Touch` prefix and is plain
// {@link GestureType}. (Its record half, `GestureConfig`, was retired outright
// by objectui#7519 — see the RETIRED note above. That does not free the
// prefix: `SpecGestureConfig` is still a DIFFERENT contract from the dialect's
// vocabulary — `swipe` + a direction array vs `swipe-left` — and dropping
// `Spec…` now would read as the retired name coming back under the spec's
// members.) Both prefixed names below stay exactly as they are.

/**
 * Gesture kinds the retired `ui/touch` vocabulary recognised.
 *
 * Declared as a runtime `as const` tuple, not a bare union, and that is
 * deliberate. `@object-ui/mobile`'s `gesture-spec-parity.test.tsx` pinned
 * `SPEC_GESTURE_TYPE_MAP` against `GestureTypeSchema.options` — a RUNTIME read
 * of the spec's enum — in both directions: every declared type maps to a
 * recogniser, and no renderer-local dialect sneaks in. A type-only union would
 * have left that pin with nothing to read and it would have had to be deleted,
 * which is how a retirement quietly takes working coverage with it. The tuple
 * keeps the pin executable against the vocabulary's new owner.
 */
export const SPEC_GESTURE_TYPES = [
  'swipe',
  'pinch',
  'long_press',
  'double_tap',
  'drag',
  'rotate',
  'pan',
] as const;

/** Gesture kinds the retired `ui/touch` vocabulary recognised. */
export type SpecGestureType = (typeof SPEC_GESTURE_TYPES)[number];

/** Swipe direction. */
export type SpecSwipeDirection = 'left' | 'right' | 'up' | 'down';

/** Swipe recogniser tuning. */
export interface SwipeGestureConfig {
  direction: SpecSwipeDirection[];
  threshold?: number;
  velocity?: number;
}

/** Pinch recogniser bounds. */
export interface PinchGestureConfig {
  minScale?: number;
  maxScale?: number;
}

/** Long-press recogniser tuning. */
export interface LongPressGestureConfig {
  duration: number;
  moveTolerance?: number;
}

/** A single gesture declaration. */
export interface SpecGestureConfig {
  type: SpecGestureType;
  label?: string;
  enabled: boolean;
  swipe?: SwipeGestureConfig;
  pinch?: PinchGestureConfig;
  longPress?: LongPressGestureConfig;
}

/** Minimum touch target sizing (WCAG 2.5.5). */
export interface TouchTargetConfig {
  minWidth: number;
  minHeight: number;
  padding?: number;
  hitSlop?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
}

/** A component's whole touch-interaction declaration. */
export interface TouchInteraction {
  gestures?: SpecGestureConfig[];
  touchTarget?: TouchTargetConfig;
  hapticFeedback?: boolean;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  role?: string;
}

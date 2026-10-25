#!/usr/bin/env node
/**
 * Every authored icon NAME that reaches a resolver reading lucide's runtime
 * `icons` record must be a live key of that record.
 *
 * ── The class this gate exists for ──────────────────────────────────────────
 * lucide retires a spelling by DROPPING IT FROM THE RUNTIME `icons` RECORD
 * while keeping it as a deprecated named export. A retired name therefore
 * still imports, still type-checks, and still renders wherever it is used as a
 * COMPONENT — and resolves to `null` wherever it is used as a STRING, because
 * the string lookups read that record. Nothing goes red in either direction:
 * not the compiler, not a render test that only looks at the label, not a
 * test that reaches for the export (`Edit === SquarePen` and
 * `Smile === FaceSlightlySmiling` are both TRUE — the retired alias is the
 * very same object under a dead name). MEMBERSHIP of the record is the only
 * thing that separates them.
 *
 * It had been repaired twice, in two packages, by two cards (objectui#5586,
 * objectui#5622), each leaving behind a LOCAL pin over the names that card
 * happened to touch. objectui#5633 asked for one gate over the population
 * instead of a fifth local pin.
 *
 * ── What judges ────────────────────────────────────────────────────────────
 * The runtime `icons` record itself, loaded from the installed lucide, and
 * NOTHING ELSE. This gate deliberately carries no list of retired spellings:
 * a hand-kept vocabulary is the same defect one level up — it ages the moment
 * lucide retires the next name, and it ages SILENTLY. When it has to name a
 * replacement it derives one, by identity: the retired export and its live
 * spelling are the same object, so the live key is looked up in the record
 * rather than remembered.
 *
 * ── The two surfaces, and why picking the wrong one is worse than no gate ──
 * This repo resolves icon names against TWO different lucide vocabularies:
 *
 *   RECORD  — `icons` from 'lucide-react'            (1767 keys, measured)
 *   DYNAMIC — `iconNames` from 'lucide-react/dynamic.mjs' (2025 names)
 *
 * DYNAMIC is a strict superset: it still carries `edit`, `smile`, `filter`,
 * `alert-triangle`. So a gate that checked the dynamic list would BLESS every
 * name this class is about. Only names reaching a RECORD-reading resolver are
 * judged here; the dynamic sites are censused (below) precisely so that the
 * split stays declared and a site cannot move between surfaces unnoticed.
 *
 * ── What it checks (three parts, each self-verifying) ───────────────────────
 * 1. SURFACE CENSUS — rediscovers, from source, every module that reads either
 *    vocabulary, and fails when the discovered set differs from the declared
 *    one. The population is measured on every run rather than remembered: this
 *    is what stops a ninth hand-copied resolver appearing in silence. Its first
 *    run found FOUR record-reading resolvers that objectui#5633's own table did
 *    not know about (`form/button.tsx`, `plugin-list/ListView.tsx`,
 *    `plugin-detail/RelatedList.tsx`, `previews/ActionPreview.tsx`).
 *
 * 2. AUTHORED NODES — walks authored SDUI metadata (JSON documents and the
 *    schema object literals embedded in first-party TS) and checks the `icon`
 *    names on nodes whose `type` is a censused record-reading renderer. The
 *    node's own `type` is what answers "which resolver does this string
 *    reach?", which is why this check can be broad without being suppressible.
 *
 *    An `icon` on an UNTYPED node is judged only when its NEAREST TYPED
 *    ANCESTOR is a censused container whose entry DECLARES that its child items
 *    carry icon names (`descendants: true`) — a fact read off that container's
 *    renderer, exactly the way every `paths` entry in the table below was. A
 *    typed node ENDS any descent it sits inside, because its own `type` is
 *    still the answer to which resolver its string reaches. Untyped icons under
 *    every other ancestor remain declined, not flagged.
 *
 *    ── Re-measured over the schema catalog at objectui@ef2a3bd8d ────────────
 *    The parenthetical this replaced read "the eight such names in the schema
 *    catalog are child items of `button-group`, `breadcrumb`, `command` and
 *    `dropdown-menu` — three of which never read `icon`, and the fourth renders
 *    it as raw text". objectui#5930 falsified its second half, and the count
 *    was low by 53. Re-measured, by reading each renderer (objectui#5992):
 *
 *      61 untyped `icon` names, across SEVEN containers. Exactly ONE of them
 *      reached a record-reading resolver AT THAT COMMIT — four do today, and
 *      each line below carries the card that moved it. A row's verdict is a
 *      fact about a renderer, so it expires when that renderer is repaired;
 *      "which containers reach the record" is re-read here, not remembered.
 *
 *        dropdown-menu   3  RECORD — `resolveIcon(item.icon)` in
 *                           `renderers/overlay/dropdown-menu.tsx` (objectui#5930).
 *                           JUDGED HERE. Judged RECURSIVELY, because that
 *                           renderer recurses into `item.children` for submenus
 *                           and resolves the submenu trigger's icon through the
 *                           same call — a depth no single-level `items[].icon`
 *                           path can express.
 *        button-group    8  `renderers/basic/button-group.tsx` never reads
 *                           `button.icon` at all; the names render nothing.
 *                           STILL TRUE at objectui#5931, and deliberately so:
 *                           `icon` is absent from `ButtonGroupButton` in
 *                           `packages/types` AND from its zod mirror, so
 *                           declaring it here would be censusing a key that is
 *                           not authorable. Routed for a decision, not guessed.
 *        breadcrumb      3  RECORD, since objectui#5931 — `resolveIcon(item.icon)`
 *                           in `renderers/data-display/breadcrumb.tsx`, resolved
 *                           once per item ABOVE the page/link split so BOTH arms
 *                           read it. JUDGED HERE.
 *        command         9  RECORD, since objectui#5931 — `resolveIcon(item.icon)`
 *                           in `renderers/form/command.tsx`. JUDGED HERE, and
 *                           necessarily by descent: the names sit at
 *                           `groups[].items[].icon`, a depth no single-level
 *                           `paths` entry can express.
 *        context-menu    4  RECORD, since objectui#6278 — dropdown-menu's twin,
 *                           and NOT routed by objectui#5930. JUDGED HERE.
 *        timeline        4  rendered as RAW TEXT, `<span>{item.icon}</span>`;
 *                           the four authored names are emoji, not lucide names
 *        tree-view      30  read, but as a TWO-VALUED literal switch
 *                           (`node.icon === 'folder'`) — never a record lookup
 *
 *    ── An EIGHTH container, added by objectui#6645 ─────────────────────────
 *    The row above is what this table's own rule predicts: a verdict is a fact
 *    about a renderer, so it expires when that renderer is repaired.
 *
 *        header-bar      3  RECORD, since objectui#6645 — `resolveIcon(crumb.icon)`
 *                           in `renderers/navigation/header-bar.tsx`, resolved
 *                           once per crumb ABOVE all three arms of its
 *                           `BreadcrumbLabel` helper. JUDGED HERE.
 *
 *    Until that repair this container reached NO resolver and declining its
 *    names was right — the same sequence `context-menu` went through in
 *    objectui#6278, and for the same reason: a census entry declares that a
 *    type's names REACH a vocabulary, and until the repair landed they reached
 *    nothing. ⚠️ It is NOT objectui#5992's blind spot, which is this gate
 *    GUESSING at containers nobody read off a renderer; this row was read off
 *    the renderer, like every other row here.
 *
 *    The three names are the ones `crumbs-with-icons.json` authors, which the
 *    same card added — before it the container authored none. Re-measured over
 *    `examples/schema-catalog/` with the walk described above: 64 untyped names
 *    across EIGHT containers, and the seven figures above re-measure
 *    IDENTICALLY (61 + 3). The scan-root figure below moves by the same 3.
 *
 *    `dropdown-menu.tsx` itself is correctly ABSENT from part 1's census: it
 *    imports `resolveIcon`, not `icons`, so the record read happens in
 *    `renderers/action/resolve-icon.ts`, which is already declared. That was a
 *    part-2 rule and not a census change — part 1 stood at eight resolvers when
 *    this paragraph was written, seven after objectui#5993, and ONE since
 *    objectui#5935 consolidated the remaining six onto the seam.
 *    `context-menu.tsx`, `breadcrumb.tsx` and `command.tsx` route the same way
 *    and are absent from part 1 for the same reason — part 1 knowing a MODULE
 *    and part 2 knowing a `type` are two independent facts.
 *
 *    ── Re-taken at objectui@e3784607f, and UNCHANGED ──────────────────────
 *    objectui#6009 censused the `icon` TYPE, which looks like it should move
 *    this table and does not: the table counts UNTYPED names, and a
 *    `type: 'icon'` node is typed, so the two populations are disjoint. The
 *    per-container figures above re-measure identically. Recorded rather than
 *    left implicit — "the numbers did not move" is a measurement, and the next
 *    reader should not have to re-derive that it was taken.
 *
 *    ⚠️ SCOPE, which the count above does not carry on its face: it is
 *    measured over `examples/schema-catalog/`, while this gate SCANS
 *    `packages/`, `apps/` and `examples/`. Over the full scan roots the same
 *    walk found 76 untyped names across NINE containers (79 across TEN since
 *    objectui#6645 — the same +3 in the same one container) — the extra 15 all in
 *    `packages/types/examples/` (`tree-view` +6, `timeline` +3, plus `list` 3
 *    and `sidebar` 3, two containers this table does not name at all). Both
 *    extra containers were read: `data-display/list.tsx` and
 *    `navigation/sidebar.tsx` never read `icon`, so those names reach no
 *    resolver and decline correctly. The table is right about what it judges;
 *    it is simply not the whole unjudged census.
 *
 * 3. ANCHORED MAPS — the first-party const maps that feed a record-reading
 *    resolver but are not authored nodes. This is the population the retired
 *    local pins covered, generalised: each anchor carries a minimum entry
 *    count, so a declaration that moved or was re-annotated fails LOUDLY
 *    instead of quietly extracting nothing and passing.
 *
 * ── Deliberate boundaries ──────────────────────────────────────────────────
 * - Test files are not scanned for authored nodes. Suites legitimately build
 *   fixtures out of names that must NOT resolve (`not-a-real-icon` is a
 *   control in two of them), and a gate that flagged its own controls gets
 *   suppressed.
 * - Imported lucide IDENTIFIERS are not checked repo-wide. 54 distinct retired
 *   identifiers are imported across ~350 sites and every one of them renders;
 *   flagging them would be a gate suppressed on day one. Identifiers ARE
 *   checked in the anchored icon maps of part 3, where a component map sits
 *   beside a string map that resolves the same glyphs and a dead spelling gets
 *   copied across — the exact path by which `bar-chart-3` and `gantt-chart`
 *   reached a string map (objectui#5586).
 * - A component REGISTRATION's `icon` meta is not judged, and this boundary is
 *   now CLOSED rather than open (objectui#5936). It is the palette-entry glyph
 *   on `ComponentRegistry.register(..., { icon })` — 45 registrations declare
 *   one. It was left unjudged at objectui#5633 because nothing could be found
 *   reading it, and objectui#5936 was filed to locate that reader before the
 *   gate was extended to the population. THE READER WAS NOT FOUND, in any of
 *   the three first-party populations anyone has:
 *
 *     objectui     zero  — filing seat, 2026-08-24; RE-DERIVED at objectui@24e027e93
 *                          over all five meta-bearing registry read paths, not
 *                          just `getMeta(...).icon`. `getMeta()` has four
 *                          first-party callers and they read `.labelling`,
 *                          `.namespace`, `.isContainer`, `.inputs` and
 *                          `.deprecated`; `getPublicConfigs()` has one, reading
 *                          `{ type, isContainer }`; `getConfig()`,
 *                          `getAllConfigs()` and `getNamespaceComponents()`
 *                          have none. Controls fired on the same tree: 51
 *                          `getMeta(` occurrences, 4898 `-i icon` lines.
 *     objectstack  zero  — PM seat, origin/main @ daacc1071, 2026-08-24.
 *     cloud        zero  — `repo:cloud` seat, cloud@9b6abe0f2fd5, 2026-09-03
 *                          (objectstack#12931). Structural, not just grep-deep:
 *                          cloud has NO component-registration surface at all
 *                          and no `@object-ui/*` dependency in any of its 19
 *                          package.json files. Controls fired: `getMeta` without
 *                          the paren 276, `-i icon` 412.
 *
 *   ⇒ ADJUDICATED 2026-09-04: the gate is NOT extended to registration `icon`
 *   meta. Both branches objectui#5936 offered — a record-reading consumer, or a
 *   dynamic-surface one — are NOT OBSERVED, so there is nothing to tell this
 *   gate which vocabulary such a name would reach. Judging it anyway would be
 *   this file's own cardinal error: guessing a vocabulary. ⛔ Do not re-open on
 *   the strength of the local `ui:icon` pin — that pin was the reason to go
 *   looking, not evidence of what was found, and objectui#5936 retired its
 *   membership half for exactly this reason.
 *
 *   ⚠️ Three zeros close the three KNOWN populations; they are NOT a proof of
 *   absence. A customer-authored app or an unmeasured repo could read the meta,
 *   and `WidgetRegistry` copies `manifest.icon` INTO this meta from external
 *   widget manifests — a first-party producer path whose consumer is expected
 *   to be a designer palette outside this tree. So: measured dead here, not
 *   proven dead anywhere. NEW EVIDENCE — an actual reader, in any repo — is
 *   what re-opens this, and it re-opens it as a real extension.
 *
 * Run:     node scripts/check-lucide-icon-record-names.mjs
 *          node scripts/check-lucide-icon-record-names.mjs --report
 * Exit:    0 = OK, 1 = a violation, a census drift, or a blind instrument
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';
import {
  deriveRecordIconNamePairs,
  renderModule as renderGeneratedNameList,
} from './regenerate-lucide-record-icon-names.mjs';

/** This gate's OWN repo — where lucide and typescript are resolved from. */
const gateRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── The declared census ──────────────────────────────────────────────────────
// Sites, NOT spellings. Rediscovered from source on every run by
// `discoverResolvers`: an entry that disappears and a module that appears both
// fail the gate. Add a new resolver here only after deciding which vocabulary
// it reads — that decision is the whole point of the split.
//
// ⭐ ONE ENTRY, since objectui#5935. This list carried SEVEN modules, each with
// its own hand-rolled lookup: three different tokenisers (`split('-')` on five
// of them, `split(/[-_\s]/)` on one, `split(/[-_\s]+/)` on one) and the
// `Home -> House` rename on only four — so the same authored name rendered on
// one surface and not another. All six non-seam sites now import `resolveIcon`
// from `renderers/action/resolve-icon.ts`, which is why they left this census
// in the same commit, exactly as `renderers/form/button.tsx` did at
// objectui#5993.
//
// ⛔ This list is also the ENFORCEMENT of ruling point 4 of 2026-08-31
// (objectui#5935 comment 5472612351, verbatim 「同意」):
// 「本裁定后新容器 ⛔ 不得再自带解析器,一律走 seam」. Discovery is re-run from
// source on every run and disagreement fails in BOTH directions, so WITHIN THE
// BOUND BELOW the note is mechanical rather than a request in a review
// checklist.
//
// ⚠️ THE BOUND, spelled out because this comment used to over-claim it (PR
// #7491's contract review measured the over-claim). `discoverResolvers` holds
// exactly one syntactic predicate:
//
//     a NAMED import of `icons` from 'lucide-react' — a rename such as
//     `{ icons as reg }` still counts — AND an ELEMENT ACCESS whose base is
//     that local binding, seen through parentheses, `as` casts and `!`.
//
// Measured RED against this gate: `icons[k]`; a renamed binding indexed;
// `(icons as Record<string, X>)[k]`; and any argument expression at all,
// a template literal included — the predicate never looks at the argument.
// Measured GREEN, i.e. OUTSIDE the predicate and NOT caught:
//
//   - a namespace import — `import * as L from 'lucide-react'; L.icons[k]`;
//   - a named import RE-BOUND through another const — `const t = icons; t[k]`;
//   - property access rather than element access — `icons.House`;
//   - destructuring — `const { House } = icons`;
//   - `require()` and dynamic `import()` of the module;
//   - anything inside a string or TEMPLATE LITERAL, which is emitted code and
//     not executed code in the file that holds it.
//
// objectui#7472 is the known resolver outside this predicate, and outside it
// three ways at once: `packages/cli/src/utils/app-generator.ts` emits, INSIDE a
// template literal, `import * as LucideIcons from 'lucide-react'` re-bound to a
// `lucideIcons` const and then indexed. Its absence from this list is CORRECT
// rather than a miss — it reads lucide's named-export namespace, not the
// runtime record, with no normalisation at all — and widening discovery to see
// it is a separate design question with a real false-positive cost, ⛔ not
// decided here and not asked for by that card.
//
// So, precisely: a new container that hand-rolls a lookup IN THE CONFORMING
// SHAPE turns this gate red on the commit that adds it. One written any of the
// other ways does not, and the ruling still binds it — that half is held by
// review, not by this file. The lawful way to add an icon-rendering container
// is to call the seam; adding a path here instead re-opens the divergence this
// card closed and needs a ruling.
export const DECLARED_RECORD_READERS = [
  'packages/components/src/renderers/action/resolve-icon.ts',
];

export const DECLARED_DYNAMIC_READERS = [
  'packages/app-shell/src/views/metadata-admin/widgets.tsx',
  'packages/components/src/lib/lazy-icon.tsx',
];

/**
 * A module that builds its OWN `icons` object and indexes it is not a lucide
 * resolver. `plugin-chatbot/src/elements/tool.tsx` does exactly that, which
 * makes it a free negative control on discovery: if it ever shows up as a
 * reader, discovery is matching the NAME rather than the IMPORT, and every
 * other conclusion this gate draws is suspect.
 */
export const DISCOVERY_NEGATIVE_CONTROL = 'packages/plugin-chatbot/src/elements/tool.tsx';

export const SCAN_ROOTS = ['packages', 'apps', 'examples'];

// ── Authored-node census: component `type` -> where its icon NAMES sit ───────
// Every path below was read off the renderer named beside it. A `type` absent
// from this table is not judged, because nothing here knows which vocabulary
// (if any) its icons reach — and a gate that guessed would be a gate that gets
// suppressed.
//
// `descendants: true` extends that same declaration to the container's UNTYPED
// child items — see the part-2 paragraph in the header. It is deliberately
// OPT-IN per container rather than a blanket "nearest typed ancestor" rule:
// applying descent to every censused entry would extend a judgement that was
// measured against one shape (`action:bar`'s `actions[]`) to descendant shapes
// nobody read off a renderer, which is the guessing this table exists to
// refuse. `min` is the non-vacuity precondition ANCHORED_MAPS uses below: a
// descent that reaches NOTHING reports no violations and reads exactly like a
// clean tree.
export const RECORD_READING_TYPES = {
  // `form/button.tsx` no longer reads the record itself: it imports the shared
  // `resolveIcon` (objectui#5993), which is why it left part 1's census in the
  // same commit. The `type` stays judged — its names still reach a
  // record-reading resolver, just one indirection away, exactly like the
  // `context-menu` and `dropdown-menu` entries below.
  'button': {
    paths: ['icon'],
    resolver: 'packages/components/src/renderers/action/resolve-icon.ts (via renderers/form/button.tsx)',
  },
  'action:bar': { paths: ['actions[].icon'], resolver: 'packages/components/src/renderers/action/resolve-icon.ts' },
  'action:button': { paths: ['icon'], resolver: 'packages/components/src/renderers/action/resolve-icon.ts' },
  'action:group': { paths: ['icon', 'actions[].icon'], resolver: 'packages/components/src/renderers/action/resolve-icon.ts' },
  'action:icon': { paths: ['icon'], resolver: 'packages/components/src/renderers/action/resolve-icon.ts' },
  'action:menu': { paths: ['icon', 'actions[].icon'], resolver: 'packages/components/src/renderers/action/resolve-icon.ts' },
  // objectui#5931. The container's OWN `icon` is never read (`paths: []`); its
  // item icons sit on untyped children at `items[].icon`, and the renderer
  // resolves each ONCE and renders the glyph ABOVE the `BreadcrumbPage` /
  // `BreadcrumbLink` split, so both arms read the same call. Declared by
  // `descendants` rather than `paths: ['items[].icon']`, which this walk can
  // also express: only the descent form carries `min`, and a declaration that
  // silently stops reaching its nodes is the failure this gate exists for.
  // `min` is the MEASURED count (the three names `with-icons.json` authors),
  // not the weaker `1` its two siblings below carry — a descent that reached
  // only one of three would be as blind as one that reached none.
  'breadcrumb': {
    paths: [],
    descendants: true,
    min: 3,
    resolver: 'packages/components/src/renderers/action/resolve-icon.ts (via renderers/data-display/breadcrumb.tsx)',
  },
  // objectui#5931, and the same shape one level deeper: the names sit at
  // `groups[].items[].icon`, which `ARRAY_PATH` cannot express at all — it
  // matches ONE level (`/^(\w+)\[\]\.icon$/`), so a `paths` entry here would
  // extract nothing, report no violations and read exactly like a clean tree.
  // Descent reaches them because an untyped node passes descent through to its
  // own children. `min` is the measured count: six names in `command-menu.json`
  // plus three in `file-command-palette.json`.
  'command': {
    paths: [],
    descendants: true,
    min: 9,
    resolver: 'packages/components/src/renderers/action/resolve-icon.ts (via renderers/form/command.tsx)',
  },
  // The twin of the `dropdown-menu` entry below, and it earns its own line for
  // the same reason: the container's OWN `icon` is never read (`paths: []`),
  // while its item icons sit on untyped children, recursively, and every one of
  // them goes through the single `resolveIcon(item.icon)` call that serves BOTH
  // the leaf arm and the submenu-trigger arm. The renderer did not read the key
  // at all until objectui#6278, which is why this entry could not have been
  // added by objectui#5992 — a census entry declares that a type's names REACH
  // a vocabulary, and until the repair landed they reached nothing.
  'context-menu': {
    paths: [],
    descendants: true,
    min: 1,
    resolver: 'packages/components/src/renderers/action/resolve-icon.ts (via renderers/overlay/context-menu.tsx)',
  },
  // `complex/data-table.tsx` does not read the record itself: it imports the
  // shared `resolveIcon` from `renderers/action/resolve-icon`, and its row
  // actions go through that one call — so it is a ROUTER, exactly like the
  // `button`, `context-menu` and `dropdown-menu` entries, and its `resolver`
  // names the seam the names actually reach, `(via …)` the renderer that
  // carries them there. It read as the renderer alone until objectui#7492,
  // which is a declaration naming a module that does not do the declared
  // thing — the very class this gate exists to end, one level up.
  'data-table': {
    paths: ['rowActionDefs[].icon'],
    resolver: 'packages/components/src/renderers/action/resolve-icon.ts (via renderers/complex/data-table.tsx)',
  },
  // The container's OWN `icon` is never read (`paths: []`); its item icons sit
  // on untyped children, recursively, and every one of them goes through the
  // single `resolveIcon(item.icon)` call that serves BOTH the leaf arm and the
  // submenu-trigger arm (objectui#5930, objectui#5992).
  'dropdown-menu': {
    paths: [],
    descendants: true,
    min: 1,
    resolver: 'packages/components/src/renderers/action/resolve-icon.ts (via renderers/overlay/dropdown-menu.tsx)',
  },
  // objectui#6645 — `header-bar` crumbs, and the same shape and route as the
  // `context-menu` entry above. The container's OWN `icon` is never read
  // (`paths: []`); the names sit on untyped children at `crumbs[].icon`, and
  // every one of them goes through the single `resolveIcon(crumb.icon)` call in
  // `CrumbIcon`, which renders ABOVE all three arms of `BreadcrumbLabel` (the
  // siblings dropdown, the last crumb's `BreadcrumbPage`, and every earlier
  // `BreadcrumbLink`) — so no arm can be forgotten and no arm needs its own
  // path.
  //
  // This entry could not have existed before that repair: until it landed the
  // renderer contained ZERO occurrences of `icon`, so the names reached nothing
  // and DECLINING them was correct — which is exactly what objectui#6645's
  // triage recorded, and exactly the sequence `context-menu` went through in
  // objectui#6278. ⚠️ Adding it is therefore not objectui#5992's blind spot
  // (this gate GUESSING at a container nobody read off a renderer); it is this
  // table's own rule, that a row's verdict expires when its renderer changes.
  //
  // `min` is the MEASURED count — the three names `crumbs-with-icons.json`
  // authors, the fixture the same card added.
  'header-bar': {
    paths: [],
    descendants: true,
    min: 3,
    resolver: 'packages/components/src/renderers/action/resolve-icon.ts (via renderers/navigation/header-bar.tsx)',
  },
  // `ui:icon` — the node type whose WHOLE job is naming a glyph. It could not
  // have been censused before objectui#5631: that renderer named its glyph with
  // `name`, the SDUI IDENTITY key, and every path in this table is an `icon`
  // path. Post-#5631 it reads `schema.icon` straight out of lucide's runtime
  // record (`import { icons } from 'lucide-react'` + `(icons as any)[key]`), so
  // it WAS a DIRECT record reader, not a `resolveIcon` router — which is why
  // part 1's `DECLARED_RECORD_READERS` carried it where dropdown-menu's does
  // not. objectui#5935 re-pointed it at the seam, so it left part 1 and now
  // routes like every other entry here; its `SquareDashed` placeholder and its
  // warning are untouched (objectui#5631, maintainer 2026-08-22, 一字不动),
  // because the seam decides nothing about the unresolvable case. Part 1
  // knowing a module and part 2 knowing its `type` are two independent facts;
  // this entry supplies the second (objectui#6009).
  //
  // NO `descendants`: the renderer resolves exactly one name and returns a
  // single element. It never walks `children`, so there is no untyped-child
  // population for a descent to reach — and a descent that reaches nothing is
  // an ERROR here, by the non-vacuity rule below.
  'icon': {
    paths: ['icon'],
    resolver: 'packages/components/src/renderers/action/resolve-icon.ts (via renderers/basic/icon.tsx)',
  },
  'view-switcher': {
    paths: ['views[].icon', 'viewActions[].icon'],
    resolver: 'packages/components/src/renderers/action/resolve-icon.ts (via plugin-view/src/ViewSwitcher.tsx)',
  },
};

// ── The census table's OWN declarations ──────────────────────────────────────
/**
 * `resolver` is the string printed as `Resolved through: ...` beside a
 * violation. Until objectui#7492 NOTHING judged it: it could name a module with
 * no lookup in it, or a file that does not exist, and this gate stayed green.
 * That is a declaration naming a module which does not do the declared thing —
 * the very class this gate exists to end, one level up, in its own tooling.
 * (`data-table` was that entry: it named its RENDERER, which routes through the
 * seam, so the string sent whoever was chasing a violation to a file with
 * nothing in it to find.)
 *
 * Two halves, and neither invents a vocabulary — both are derived from what the
 * gate already measures:
 *
 *  1. The part BEFORE `(via ...)` names the module whose lookup those names
 *     reach, so it must be one of the record-reading resolvers part 1
 *     rediscovers FROM SOURCE on every run. A router's own file can therefore
 *     only appear after `(via `, which is what makes the two-part form its
 *     siblings use the one shape a routed entry can take. Existence comes with
 *     it: part 1 fails on a declared reader it cannot rediscover.
 *  2. The part INSIDE `(via ...)` is a real path, spelled relative to one of the
 *     ANCESTOR directories of that reader (`renderers/form/button.tsx` against
 *     `packages/components/src/`, `plugin-view/src/ViewSwitcher.tsx` against
 *     `packages/`) — so the roots to try are read off the reader rather than
 *     listed here. A renamed or moved renderer otherwise leaves a string that
 *     reads perfectly and points nowhere.
 *
 * ⛔ `analyze`'s `recordReadingTypes` / `declaredRecordReaders` overrides are
 * deliberately NOT forwarded to this check: it judges the declarations THIS FILE
 * ships, exactly as `selfTest()` judges the lucide install rather than the tree
 * under analysis. A fixture substituting a two-row table and a fake reader path
 * would otherwise fail over strings it never chose.
 *
 * @param {Record<string, RecordReadingType>} [recordReadingTypes]
 * @param {readonly string[]} [declaredRecordReaders]
 * @returns {string[]}
 */
export function censusResolverProblems(
  recordReadingTypes = RECORD_READING_TYPES,
  declaredRecordReaders = DECLARED_RECORD_READERS,
) {
  const problems = [];
  for (const [type, spec] of Object.entries(recordReadingTypes)) {
    const declaration = String(spec.resolver ?? '');
    const shape = /^([^()]+?)(?: \(via ([^()]+)\))?$/.exec(declaration);
    if (!shape) {
      problems.push(
        `census entry \`${type}\` declares resolver \`${declaration}\`, which is neither `
        + '`<record reader>` nor `<record reader> (via <renderer>)` — the two forms this table uses.',
      );
      continue;
    }
    const [, reader, via] = shape;
    if (!declaredRecordReaders.includes(reader)) {
      problems.push(
        `census entry \`${type}\` declares resolver \`${reader}\`, which is NOT one of the `
        + `record-reading resolvers part 1 discovered (${declaredRecordReaders.join(', ') || 'none'}). `
        + 'An entry whose names reach the record through a router names the READER, and the router '
        + 'after `(via ` — naming the router alone points whoever is chasing a violation at a file '
        + 'with no lookup in it. See objectui#7492.',
      );
    }
    if (via !== undefined) {
      const segments = reader.split('/').slice(0, -1);
      const roots = [];
      for (let depth = segments.length; depth >= 0; depth -= 1) roots.push(segments.slice(0, depth).join('/'));
      if (!roots.some((root) => existsSync(join(gateRoot, root, via)))) {
        problems.push(
          `census entry \`${type}\` routes \`(via ${via})\`, which is not a file under any ancestor `
          + `directory of \`${reader}\` — the renderer was renamed, moved or misspelled, and the `
          + 'string names nothing. See objectui#7492.',
        );
      }
    }
  }
  return problems;
}

// ── Anchored first-party maps ────────────────────────────────────────────────
// The population the retired local pins covered, generalised. `min` is the
// precondition that makes "every entry" mean something: an extractor that finds
// fewer entries than the map is known to carry did not read the map, and
// reporting zero violations off zero entries is the failure mode this shape
// invites — which is why a short read is an ERROR, not a shrug.
export const ANCHORED_MAPS = [
  {
    file: 'packages/plugin-view/src/ObjectView.tsx',
    anchor: 'iconMap',
    kind: 'strings',
    min: 9,
    why: 'the producer handing ViewSwitcher its icon NAMES; `chart`/`gantt` died here (objectui#5586)',
  },
  {
    file: 'packages/plugin-view/src/ViewSwitcher.tsx',
    anchor: 'DEFAULT_VIEW_ICONS',
    kind: 'identifiers',
    min: 9,
    why: 'the component map beside that string map — a dead spelling here gets copied across',
  },
  {
    file: 'packages/plugin-list/src/ViewSwitcher.tsx',
    anchor: 'VIEW_ICONS',
    kind: 'identifiers',
    min: 9,
    why: 'the sibling switcher naming the same glyphs as components (objectui#5622)',
  },
  {
    file: 'packages/plugin-detail/src/DetailView.tsx',
    anchor: 'items.push',
    kind: 'pushed-objects',
    min: 3,
    why: 'system action items built as an `action:bar` schema; `edit` died here (objectui#5622)',
  },
];

// ── Load the judgement ───────────────────────────────────────────────────────
// `lucide-react` is not resolvable from the repo root — only the packages that
// declare it have it. Resolve it from the package owning the canonical
// resolver, so this gate reads the very copy `resolve-icon.ts` reads.
export const LUCIDE_OWNER_PKG = 'packages/components/package.json';
const lucideRequire = createRequire(join(gateRoot, LUCIDE_OWNER_PKG));
export const lucide = await import(pathToFileURL(lucideRequire.resolve('lucide-react')).href);
export const { iconNames, dynamicIconImports } = await import(pathToFileURL(lucideRequire.resolve('lucide-react/dynamic.mjs')).href);
export const icons = lucide.icons;
export const lucideVersion = JSON.parse(readFileSync(lucideRequire.resolve('lucide-react/package.json'), 'utf8')).version;
const ts = createRequire(join(gateRoot, 'package.json'))('typescript');

/**
 * Prove the instrument can see the distinction it claims to judge, BEFORE any
 * silence of its is quoted as evidence. This gate's whole subject is that the
 * current tooling reports nothing; a blind probe would report nothing too, and
 * read as green.
 */
export function selfTest() {
  const problems = [];
  const recordSize = icons ? Object.keys(icons).length : 0;
  if (recordSize < 500) {
    problems.push(`the loaded \`icons\` record has ${recordSize} keys — that is not lucide's record; every result below is meaningless.`);
  }
  if (!Array.isArray(iconNames) || iconNames.length <= recordSize) {
    problems.push(`the dynamic \`iconNames\` list (${iconNames?.length}) is not larger than the \`icons\` record (${recordSize}) — the two surfaces this gate distinguishes are not distinguishable in this install.`);
  }
  // A name lucide keeps ONLY as a deprecated export. If the predicate cannot
  // reject THIS, it cannot reject anything: `Edit` imports, type-checks, and IS
  // `SquarePen`. Absence from the record is the only difference, and it is the
  // difference every conclusion below rests on.
  if (icons && Object.prototype.hasOwnProperty.call(icons, 'Edit')) {
    problems.push('`Edit` is a key of the runtime `icons` record in this install — the membership predicate no longer separates a retired alias from a live one.');
  }
  if (icons && !Object.prototype.hasOwnProperty.call(icons, 'SquarePen')) {
    problems.push('`SquarePen` is NOT a key of the runtime `icons` record — the predicate is rejecting live names, so it would fail everything for the wrong reason.');
  }
  return problems;
}

// ── Normalisation ────────────────────────────────────────────────────────────
// The transform the ONE record-reading resolver applies before its lookup —
// `renderers/action/resolve-icon.ts`, transcribed.
//
// ⭐ This used to be an APPROXIMATION and is no longer one (objectui#5935). It
// was the WIDEST of the three tokenisers in the tree plus the rename map that
// only four of seven sites carried, chosen so the gate could never invent a
// violation some resolver would not have produced — at the cost, disclosed in
// PR #5932 and carried by this card, of UNDER-REPORTING precisely where the
// resolvers disagreed. With one resolver left there is nothing to approximate:
// this IS the normalisation, so a name judged dead here is dead everywhere and
// the blind spot is closed rather than bounded.
//
// `.filter(Boolean)` is retained and is INERT — capitalising the empty string
// yields the empty string and joining it contributes nothing (measured over
// 51,449 hostile spellings: zero mismatches with and without). It is kept
// because removing it would be an unmeasured edit to a gate's own predicate.
//
// ⚠️ Two copies of one rule, unavoidably: the resolver is TypeScript inside a
// package and this gate is a standalone `.mjs` that must run without a build.
// `scripts/__tests__/check-lucide-icon-record-names.test.ts` holds them
// together, and since PR #7491's contract review it does so BEHAVIOURALLY: it
// imports `describeIconLookup` from the resolver and asserts
// `toRecordKey(s) === describeIconLookup(s).key` over every live key re-spelled
// six ways plus a per-character separator sweep, with its own control that the
// corpus can in fact separate the two.
//
// ⛔ The source-text rows that file also keeps are NOT that guarantee, and the
// difference was measured rather than argued: widening ONLY this side to
// `/[-_.\s]+/` left the whole suite green, 40/40, because the resolver's text
// was untouched and every source-text assertion still held. Which is why "a
// change to either side that is not made to the other fails loudly" is now
// carried by a row that EXECUTES the resolver instead of one that reads it.
export const toRecordKey = (name) => {
  const pascal = String(name)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
  return pascal === 'Home' ? 'House' : pascal;
};

export const isLiveKey = (name) => Object.prototype.hasOwnProperty.call(icons, toRecordKey(name));

// Derive the live spelling of a retired name BY IDENTITY, never from a list:
// lucide keeps the retired export pointing at the same object as its live key.
//
// Built LAZILY on first read and memoised, never at module top level. This file
// exports bindings, so whatever its top level ran would run inside every
// importer — the rule `check-entry-guard.mjs` calls import-safety (objectui#6133).
//
// ⛔ Do NOT "fix" this by moving the build behind the entry guard instead. That
// was measured, not reasoned about, and rejected (objectui#6092 PR 2's ablation,
// recorded on objectui#6147): the maps stay EMPTY for importers, the suite fails
// 5 of 25, and `describeName('BarChart3')` stops saying ``write `chart-column` ``
// and says "no live key names the same glyph" instead — a WRONG DIAGNOSIS for a
// real violation, printed by a gate that still exits 1. A green baseline bought
// with a lying error message is worse than an honest debt line. Lazy satisfies
// both sides: nothing runs on import, and every reader gets the built maps.
//
// ⛔ This does not make the module cheap to import, and is not trying to:
// `icons`/`iconNames` are top-level `await import('lucide-react')` above. That
// cost is a separate question (objectui#6147) and is deliberately left alone.
let memoisedLookups = null;

/** The two identity maps, built ONCE on the first read and memoised after. */
function glyphLookups() {
  if (memoisedLookups) return memoisedLookups;
  const keyByComponent = new Map();
  for (const [key, component] of Object.entries(icons)) if (!keyByComponent.has(component)) keyByComponent.set(component, key);
  const kebabByKey = new Map();
  for (const kebab of iconNames) kebabByKey.set(toRecordKey(kebab), kebab);
  memoisedLookups = { keyByComponent, kebabByKey };
  return memoisedLookups;
}

/** `{ key, kebab }` of the live spelling naming the SAME glyph, or null. */
export function liveSpellingFor(name) {
  const { keyByComponent, kebabByKey } = glyphLookups();
  const retiredExport = lucide[toRecordKey(name)];
  if (!retiredExport) return null;
  const liveKey = keyByComponent.get(retiredExport);
  if (!liveKey) return null;
  return { key: liveKey, kebab: kebabByKey.get(liveKey) ?? null };
}

/** The sentence a violation prints — three distinct diagnoses, not one. */
export function describeName(name) {
  const key = toRecordKey(name);
  const live = liveSpellingFor(name);
  if (live) {
    return `"${name}" -> \`${key}\` is not a key of the runtime \`icons\` record. lucide keeps it only as a DEPRECATED EXPORT of the same glyph — write \`${live.kebab ?? live.key}\` (the spelling the record carries).`;
  }
  if (lucide[key]) {
    return `"${name}" -> \`${key}\` is exported by lucide but is not a key of the runtime \`icons\` record, and no live key names the same glyph.`;
  }
  return `"${name}" -> \`${key}\` is not a lucide icon at all.`;
}

// ── Source inventory ─────────────────────────────────────────────────────────
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.turbo', '.next', 'storybook-static']);

/**
 * Test files are NOT scanned for authored nodes: suites legitimately build
 * fixtures out of names that must NOT resolve (`not-a-real-icon` is a control
 * in two of them), and a gate that flagged its own controls gets suppressed.
 */
export const isTestPath = (file) => /(^|\/)(__tests__|__mocks__|e2e)\//.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);

export function collectFiles(root) {
  const sources = [];
  const documents = [];
  const walk = (absolute) => {
    let entries;
    try { entries = readdirSync(absolute, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.') continue;
      const child = join(absolute, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(child);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relative(root, child).split(sep).join('/');
      if (/\.tsx?$/.test(rel) && !rel.endsWith('.d.ts')) sources.push(rel);
      else if (rel.endsWith('.json') && !/(^|\/)(package|tsconfig|package-lock)\.json$/.test(rel)) documents.push(rel);
    }
  };
  for (const scanRoot of SCAN_ROOTS) walk(join(root, scanRoot));
  sources.sort();
  documents.sort();
  return { sources, documents };
}

// ── AST helpers ──────────────────────────────────────────────────────────────
function parseSource(root, file) {
  const text = readFileSync(join(root, file), 'utf8');
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

function unwrap(node) {
  let current = node;
  for (;;) {
    if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current)) current = current.expression;
    else if (typeof ts.isTypeAssertionExpression === 'function' && ts.isTypeAssertionExpression(current)) current = current.expression;
    else return current;
  }
}

function objectProp(objectLiteral, name) {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null;
    if (key === name) return property.initializer;
  }
  return null;
}

// ── The generated legal-name list ────────────────────────────────────────────
/**
 * The module the seam now asks its membership question of, instead of indexing
 * lucide's runtime `icons` record (objectui#9251).
 *
 * ⚠️ Reading the record was what put all 1,781 icon modules in the console's
 * eager closure, so the whole point of the move is that NO shipped module
 * imports the record any more. Discovery therefore cannot keep looking only for
 * `import { icons }` — with that predicate alone it would find zero record
 * sites the day the seam changed and, worse, would be telling the truth: the
 * record IS unread. What has to stay censused is the site that judges names
 * against the record's VOCABULARY, however it holds that vocabulary.
 *
 * The predicate is deliberately narrow, and the same shape as the one above it:
 * a NAMED import (a rename counts) whose specifier names the generated table.
 * A module that re-derives the vocabulary some other way is outside it — the
 * same declared bound the `icons` predicate carries, and review holds the rest.
 */
export const GENERATED_NAME_LIST_MODULE = 'lucide-record-icon-names';

/** Path of the generated list, relative to the repo root. */
export const GENERATED_NAME_LIST_TARGET = 'packages/components/src/lib/lucide-record-icon-names.ts';

function importsGeneratedNameList(node, specifier) {
  if (!/(^|\/)lucide-record-icon-names(\.(js|ts))?$/.test(specifier)) return false;
  if (node.importClause?.isTypeOnly) return false;
  const bindings = node.importClause?.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return false;
  return bindings.elements.some((element) => !element.isTypeOnly);
}

// ── Part 4: the generated legal-name list ────────────────────────────────────
/**
 * The list the seam judges membership with must be (a) in sync with lucide's
 * own export manifest, (b) the same vocabulary as the runtime `icons` record,
 * and (c) derived WITHOUT importing that record.
 *
 * ## Why all three, and why here
 *
 * (a) alone is a self-consistency check: the file matches a script nobody
 * proved was reading the right thing. (b) is what makes the list a RECORD
 * vocabulary rather than a third one — this gate already loads the record for
 * its own judgement, so it is the natural place to assert the equality that the
 * generator deliberately does not (keeping the record out of the generator is
 * the point of the exercise). (c) is the ruling's own clause, made mechanical:
 * 「合法图标名集合由构建期生成的静态名单提供(⛔ 不从 `Object.keys(icons)` 推导)」
 * — a derivation that read the record would re-pin every icon module into the
 * eager closure and undo objectui#9251 without changing one visible byte of the
 * seam.
 *
 * ⚠️ (c) is checked as an IMPORT, not as a text search. The prose of both files
 * names `Object.keys(icons)` in order to forbid it, so a grep would fail on the
 * very sentence that states the rule. A value import of `'lucide-react'` is the
 * thing that actually costs the bytes; a `import type` of it is erased before
 * anything is bundled and is not one.
 */
export const RECORD_FREE_MODULES = Object.freeze([
  GENERATED_NAME_LIST_TARGET,
  'scripts/regenerate-lucide-record-icon-names.mjs',
  'packages/components/src/renderers/action/resolve-icon.ts',
]);

/**
 * A file in this tree that DOES import the record for a value, so the
 * "no record import" probe below can be shown to fire before its silence over
 * {@link RECORD_FREE_MODULES} is quoted as a result. It is a test file, which
 * is why it is allowed to do so: tests are not bundled into any page.
 */
export const RECORD_IMPORT_POSITIVE_CONTROL =
  'packages/components/src/renderers/action/__tests__/resolve-icon-seam.test.ts';

/** Does `file` import lucide's record entry for a VALUE (not just a type)? */
export function importsRecordEntry(root, file) {
  const sf = parseSource(root, file);
  let found = false;
  sf.forEachChild((node) => {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return;
    if (node.moduleSpecifier.text !== 'lucide-react') return;
    if (node.importClause?.isTypeOnly) return;
    const bindings = node.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (element.isTypeOnly) continue;
        if ((element.propertyName ?? element.name).text === 'icons') found = true;
      }
      return;
    }
    // A namespace import reaches the record through the namespace object.
    if (bindings && ts.isNamespaceImport(bindings)) found = true;
  });
  return found;
}

/**
 * @param {string} root
 * @returns {string[]} errors
 */
export function judgeGeneratedNameList(root) {
  const errors = [];

  let pairs;
  try {
    pairs = deriveRecordIconNamePairs(root);
  } catch (e) {
    errors.push(`the generated legal-name list could not be derived: ${e instanceof Error ? e.message : String(e)}`);
    return errors;
  }

  // (a) the committed file is what the derivation renders.
  const target = join(root, GENERATED_NAME_LIST_TARGET);
  let committed = null;
  try { committed = readFileSync(target, 'utf8'); } catch { committed = null; }
  if (committed === null) {
    errors.push(`${GENERATED_NAME_LIST_TARGET} is missing. Run \`node scripts/regenerate-lucide-record-icon-names.mjs\`.`);
  } else if (committed !== renderGeneratedNameList(pairs)) {
    errors.push(
      `${GENERATED_NAME_LIST_TARGET} has drifted from lucide's export manifest — the seam would accept a `
      + 'different set of names than lucide ships. Run `node scripts/regenerate-lucide-record-icon-names.mjs` and commit the result.',
    );
  }

  // (b) it is the RECORD vocabulary, key for key.
  const derived = new Set(pairs.map(([pascal]) => pascal));
  const recordKeys = new Set(Object.keys(icons));
  const missing = [...recordKeys].filter((k) => !derived.has(k));
  const extra = [...derived].filter((k) => !recordKeys.has(k));
  if (missing.length > 0 || extra.length > 0) {
    errors.push(
      `the generated legal-name list is not the runtime \`icons\` vocabulary: ${missing.length} record key(s) absent `
      + `(${missing.slice(0, 5).join(', ')}), ${extra.length} name(s) it does not have `
      + `(${extra.slice(0, 5).join(', ')}). The manifest parse and the record have diverged.`,
    );
  }

  // (b2) every name must be loadable through the dynamic import map, which is
  // how the seam draws it. A name that is in the list but not in the map
  // resolves to a component that throws on mount instead of to `null`.
  const loadable = new Set(Object.keys(dynamicIconImports ?? {}));
  if (loadable.size === 0) {
    errors.push('lucide\'s dynamic import map read as empty — the loadability probe is blind, so its silence proves nothing.');
  } else {
    const unloadable = pairs.filter(([, kebab]) => !loadable.has(kebab));
    if (unloadable.length > 0) {
      errors.push(
        `${unloadable.length} generated name(s) are not keys of lucide's dynamic import map and could not be `
        + `drawn: ${unloadable.slice(0, 5).map(([p, k]) => `${p} -> ${k}`).join(', ')}.`,
      );
    }
  }

  // (c) nothing on the derivation or resolution path imports the record.
  if (!importsRecordEntry(root, RECORD_IMPORT_POSITIVE_CONTROL)) {
    errors.push(
      `the record-import probe did not fire on its positive control ${RECORD_IMPORT_POSITIVE_CONTROL}, `
      + 'so its silence over the modules below is not a reading. Point the control at a module that still imports `icons`.',
    );
  } else {
    for (const file of RECORD_FREE_MODULES) {
      if (importsRecordEntry(root, file)) {
        errors.push(
          `${file} imports lucide's runtime \`icons\` record for a value. That import is the eager closure `
          + 'objectui#9251 removed — 1,781 icon modules — and the ruling refuses deriving the legal-name set from it.',
        );
      }
    }
  }

  return errors;
}

// ── Part 1: surface census ───────────────────────────────────────────────────
/**
 * Which modules read which lucide vocabulary — rediscovered from source, so the
 * population is MEASURED on every run rather than remembered. Its first run
 * found four record-reading resolvers and two dynamic ones that objectui#5633's
 * own table did not know about.
 */
export function discoverResolvers(root, files) {
  const record = [];
  const dynamic = [];
  for (const file of files) {
    if (isTestPath(file)) continue;
    const text = readFileSync(join(root, file), 'utf8');
    if (!text.includes('lucide-react') && !text.includes(GENERATED_NAME_LIST_MODULE)) continue;
    const sf = parseSource(root, file);
    let recordLocal = null;
    let readsGeneratedNameList = false;
    let readsDynamic = false;
    sf.forEachChild((node) => {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return;
      const specifier = node.moduleSpecifier.text;
      if (specifier.startsWith('lucide-react/dynamic')) readsDynamic = true;
      if (importsGeneratedNameList(node, specifier)) readsGeneratedNameList = true;
      if (specifier !== 'lucide-react') return;
      const bindings = node.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) return;
      for (const element of bindings.elements) {
        // A TYPE-only binding is erased before anything is bundled, so it does
        // not put the record on the eager path and is not a read of it. The
        // seam imports `LucideIcon` this way.
        if (node.importClause?.isTypeOnly || element.isTypeOnly) continue;
        if ((element.propertyName ?? element.name).text === 'icons') recordLocal = element.name.text;
      }
    });

    let indexesRecord = false;
    if (recordLocal) {
      const visit = (node) => {
        if (ts.isElementAccessExpression(node)) {
          const base = unwrap(node.expression);
          if (ts.isIdentifier(base) && base.text === recordLocal) indexesRecord = true;
        }
        ts.forEachChild(node, visit);
      };
      ts.forEachChild(sf, visit);
    }

    const readsRecordVocabulary = indexesRecord || readsGeneratedNameList;
    if (readsRecordVocabulary) record.push(file);
    // ⚠️ A record site is NOT also a dynamic site, even though the seam imports
    // `DynamicIcon`. The split this gate polices is which VOCABULARY a site's
    // names are judged against, and the seam's is the record's 1,781 keys — it
    // uses the dynamic map as a LOADER for names it has already accepted, never
    // as the membership question. Listing it in both censuses would say it
    // admits `iconNames`'s 258 retired spellings, which is the one thing this
    // gate exists to deny. Moving the seam's membership to `iconNames` still
    // fails loudly: the record census would drop to zero.
    else if (readsDynamic) dynamic.push(file);
  }
  return { record: record.sort(), dynamic: dynamic.sort() };
}

// ── Part 2: authored nodes ───────────────────────────────────────────────────
const ARRAY_PATH = /^(\w+)\[\]\.icon$/;

function judgeAuthoredNodes(root, { sources, documents }, types = RECORD_READING_TYPES) {
  const violations = [];
  const errors = [];
  let judged = 0;
  let declined = 0;
  let descendantJudged = 0;
  /** Per declaring container `type`, how many untyped child icons descent reached. */
  const descentReach = new Map();

  const judge = (typeName, gather, locate) => {
    const spec = types[typeName];
    if (!spec) return;
    for (const path of spec.paths) {
      for (const found of gather(path)) {
        judged += 1;
        if (!isLiveKey(found.value)) {
          violations.push({ where: locate(found.where), site: typeName, resolver: spec.resolver, detail: describeName(found.value) });
        }
      }
    }
  };

  /**
   * The descent site a node's children inherit. A node's OWN `type` is still
   * the answer to "which resolver does this string reach?", so a typed node
   * ENDS whatever descent it sits inside and opens a new one only if its own
   * census entry declares one. That is what keeps a `type: 'separator'` menu
   * item — which this renderer returns early for, drawing no icon — declined
   * rather than judged.
   */
  const descentBelow = (typeName, inherited) => {
    if (!typeName) return inherited;
    const spec = types[typeName];
    return spec?.descendants ? { type: typeName, spec } : null;
  };

  /** Judge one untyped child icon against the container that declared descent. */
  const judgeDescendant = (site, value, where) => {
    judged += 1;
    descendantJudged += 1;
    descentReach.set(site.type, (descentReach.get(site.type) ?? 0) + 1);
    if (!isLiveKey(value)) {
      violations.push({ where, site: `${site.type} (untyped child item)`, resolver: site.spec.resolver, detail: describeName(value) });
    }
  };

  for (const file of documents) {
    if (isTestPath(file)) continue;
    let document;
    try { document = JSON.parse(readFileSync(join(root, file), 'utf8')); } catch { continue; }
    // One walker, carrying a JSON-pointer trail so a violation names the node,
    // and the descent site (if any) its untyped children answer to.
    const walk = (node, trail, descent) => {
      if (Array.isArray(node)) { node.forEach((child, index) => walk(child, `${trail}[${index}]`, descent)); return; }
      if (!node || typeof node !== 'object') return;
      const typeName = typeof node.type === 'string' ? node.type : null;
      const inherits = !typeName && descent && typeof node.icon === 'string';
      if (inherits) judgeDescendant(descent, node.icon, `${file} ${trail}.icon`);
      if (typeof node.icon === 'string' && !inherits && !(typeName && types[typeName])) declined += 1;
      if (typeName) {
        judge(typeName, (path) => {
          const found = [];
          const arrayMatch = ARRAY_PATH.exec(path);
          if (path === 'icon') {
            if (typeof node.icon === 'string') found.push({ value: node.icon, where: `${trail}.icon` });
          } else if (arrayMatch && Array.isArray(node[arrayMatch[1]])) {
            node[arrayMatch[1]].forEach((child, index) => {
              if (child && typeof child.icon === 'string') found.push({ value: child.icon, where: `${trail}.${arrayMatch[1]}[${index}].icon` });
            });
          }
          return found;
        }, (where) => `${file} ${where}`);
      }
      const below = descentBelow(typeName, descent);
      for (const [key, value] of Object.entries(node)) walk(value, `${trail}.${key}`, below);
    };
    walk(document, '$', null);
  }

  for (const file of sources) {
    if (isTestPath(file)) continue;
    const text = readFileSync(join(root, file), 'utf8');
    if (!text.includes('icon')) continue;
    const sf = parseSource(root, file);
    const visit = (node, descent) => {
      let below = descent;
      if (ts.isObjectLiteralExpression(node)) {
        const typeInit = objectProp(node, 'type');
        const iconInit = objectProp(node, 'icon');
        const typeName = typeInit && ts.isStringLiteral(typeInit) ? typeInit.text : null;
        below = descentBelow(typeName, descent);
        const iconLiteral = iconInit && ts.isStringLiteral(iconInit) ? iconInit : null;
        const inherits = !typeName && descent && iconLiteral;
        if (inherits) judgeDescendant(descent, iconLiteral.text, `${file}:${lineOf(sf, iconLiteral)}`);
        if (iconLiteral && !inherits && !(typeName && types[typeName])) declined += 1;
        if (typeName) {
          judge(typeName, (path) => {
            const found = [];
            const arrayMatch = ARRAY_PATH.exec(path);
            if (path === 'icon') {
              if (iconInit && ts.isStringLiteral(iconInit)) found.push({ value: iconInit.text, where: iconInit });
            } else if (arrayMatch) {
              const arrayInit = objectProp(node, arrayMatch[1]);
              if (arrayInit && ts.isArrayLiteralExpression(arrayInit)) {
                for (const element of arrayInit.elements) {
                  if (!ts.isObjectLiteralExpression(element)) continue;
                  const childIcon = objectProp(element, 'icon');
                  if (childIcon && ts.isStringLiteral(childIcon)) found.push({ value: childIcon.text, where: childIcon });
                }
              }
            }
            return found;
          }, (where) => `${file}:${lineOf(sf, where)}`);
        }
      }
      ts.forEachChild(node, (child) => visit(child, below));
    };
    ts.forEachChild(sf, (child) => visit(child, null));
  }

  // Non-vacuity, the precondition ANCHORED_MAPS states in full below: a descent
  // declaration that reached NOTHING produces zero violations and reads exactly
  // like a clean tree. That is the failure this whole card is about one level
  // up, so it is an ERROR here rather than a shrug.
  for (const [typeName, spec] of Object.entries(types)) {
    if (!spec.descendants) continue;
    const reached = descentReach.get(typeName) ?? 0;
    const min = spec.min ?? 1;
    if (reached < min) {
      errors.push(
        `\`${typeName}\` declares its icon names on UNTYPED child items (\`descendants: true\`), but the authored-node walk `
        + `reached ${reached} of them — fewer than the ${min} it is declared to carry. Either the authored nodes moved `
        + 'or the descent no longer reaches them; a descent that reaches nothing reports no violations and reads as green. '
        + `Resolved through: ${spec.resolver}`,
      );
    }
  }

  return { violations, errors, judged, declined, descendantJudged };
}

// ── Part 3: anchored first-party maps ────────────────────────────────────────
/**
 * The object literal a `const NAME = …` initializer ultimately is, or `null`.
 *
 * ⚠️ objectui#9943 — a bare `ts.isObjectLiteralExpression(node.initializer)`
 * test is FALSE for `const X = { … } satisfies Record<string, Y>`, because the
 * initializer is then a `SatisfiesExpression` WRAPPING the literal. That is not
 * a hypothetical spelling: it is the one a table keyed on a union the upstream
 * spec can RETIRE a member from has to use, since an annotated (or
 * `satisfies`-ed) exact type makes the retired row an excess property. Two of
 * the anchors below moved onto it, and the failure this unwrap prevents is the
 * one the `min` precondition was written for — a reader that finds nothing
 * reports no violations. Here it would at least have failed loudly; it must not
 * fail at all, because the map is still perfectly readable.
 *
 * `as` is unwrapped for the same reason and parentheses because both wrappers
 * admit them. Anything else yields `null` and the `min` precondition fires.
 */
function unwrapToObjectLiteral(node) {
  let current = node;
  while (current && (ts.isSatisfiesExpression(current) || ts.isAsExpression(current) || ts.isParenthesizedExpression(current))) {
    current = current.expression;
  }
  return current && ts.isObjectLiteralExpression(current) ? current : null;
}

function judgeAnchoredMaps(root, anchors) {
  const violations = [];
  const errors = [];
  let judged = 0;

  for (const anchor of anchors) {
    if (!existsSync(join(root, anchor.file))) {
      errors.push(`anchored map source is gone: ${anchor.file} (${anchor.why}). Fix the anchor; do not delete it.`);
      continue;
    }
    const sf = parseSource(root, anchor.file);
    const found = [];
    const visit = (node) => {
      if (anchor.kind === 'pushed-objects') {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && `${node.expression.expression.getText(sf)}.${node.expression.name.text}` === anchor.anchor) {
          for (const argument of node.arguments) {
            if (!ts.isObjectLiteralExpression(argument)) continue;
            const iconInit = objectProp(argument, 'icon');
            if (iconInit && ts.isStringLiteral(iconInit)) found.push({ value: iconInit.text, node: iconInit });
          }
        }
      } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === anchor.anchor
        && unwrapToObjectLiteral(node.initializer)) {
        for (const property of unwrapToObjectLiteral(node.initializer).properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const init = property.initializer;
          if (anchor.kind === 'strings' && ts.isStringLiteral(init)) found.push({ value: init.text, node: init });
          if (anchor.kind === 'identifiers') {
            if (ts.isIdentifier(init)) found.push({ value: init.text, node: init });
            else if (ts.isJsxSelfClosingElement(init) && ts.isIdentifier(init.tagName)) found.push({ value: init.tagName.text, node: init });
            else if (ts.isJsxElement(init) && ts.isIdentifier(init.openingElement.tagName)) found.push({ value: init.openingElement.tagName.text, node: init });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);

    if (found.length < anchor.min) {
      errors.push(
        `anchored map \`${anchor.anchor}\` in ${anchor.file} yielded ${found.length} entries, fewer than the ${anchor.min} it is known to carry — `
        + 'the declaration moved, was re-annotated, or the reader broke. A reader that finds nothing reports no violations, '
        + `which is why this is an ERROR and not a shrug. (${anchor.why})`,
      );
      continue;
    }
    judged += found.length;
    for (const entry of found) {
      // Identifier anchors name lucide EXPORTS, already record-key shaped;
      // string anchors name authored kebab spellings. `toRecordKey` is the
      // identity on the former, so one predicate serves both.
      if (!isLiveKey(entry.value)) {
        violations.push({ where: `${anchor.file}:${lineOf(sf, entry.node)}`, site: `${anchor.anchor} (${anchor.kind})`, resolver: anchor.why, detail: describeName(entry.value) });
      }
    }
  }
  return { violations, errors, judged };
}

// ── The whole judgement ──────────────────────────────────────────────────────
/**
 * One authored-node census entry. Spelled out as a type rather than left to be
 * inferred from `RECORD_READING_TYPES`, because every override this function
 * takes exists to be a DIFFERENT table from the declared one — inferring the
 * parameter from the default makes the declared table the only one that fits,
 * which is precisely backwards for a seam whose job is substitution.
 *
 * @typedef {{ paths: string[], resolver: string, descendants?: boolean, min?: number }} RecordReadingType
 *
 * @typedef {{
 *   anchors?: readonly any[],
 *   declaredRecordReaders?: readonly string[],
 *   declaredDynamicReaders?: readonly string[],
 *   negativeControl?: string,
 *   recordReadingTypes?: Record<string, RecordReadingType>,
 *   generatedNameListRoot?: string,
 * }} AnalyzeOptions
 *
 * @param {string} root
 * @param {AnalyzeOptions} [options]
 */
export function analyze(root, {
  anchors = ANCHORED_MAPS,
  declaredRecordReaders = DECLARED_RECORD_READERS,
  declaredDynamicReaders = DECLARED_DYNAMIC_READERS,
  negativeControl = DISCOVERY_NEGATIVE_CONTROL,
  recordReadingTypes = RECORD_READING_TYPES,
  // ⚠️ Deliberately NOT `root`. Parts 1-3 judge whatever tree they are pointed
  // at, which is what lets the unit suite drive them with synthetic fixtures.
  // Part 4 judges THIS repository's own generator, generated list and seam —
  // three fixed paths, none of which a fixture tree has — so it is anchored to
  // the gate's own root and a fixture run exercises it against the real files.
  // Passing `null` turns it off for a caller that only wants parts 1-3.
  generatedNameListRoot = gateRoot,
} = {}) {
  const errors = [...selfTest(), ...censusResolverProblems()];
  const { sources, documents } = collectFiles(root);
  const discovered = discoverResolvers(root, sources);

  const censusDiff = (label, found, declared, hint) => {
    for (const file of found) {
      if (!declared.includes(file)) {
        errors.push(`UNDECLARED ${label}: ${file}\n      ${hint}\n      Add it to the census in scripts/check-lucide-icon-record-names.mjs after deciding which vocabulary it reads.`);
      }
    }
    for (const file of declared) {
      if (!found.includes(file)) {
        errors.push(`STALE ${label} census entry: ${file} no longer reads that vocabulary (or moved). Update the census — do not delete the gate.`);
      }
    }
  };
  censusDiff('record-reading resolver', discovered.record, declaredRecordReaders,
    'It resolves an icon NAME through lucide\'s runtime `icons` record, where a retired spelling resolves to nothing and NOTHING goes red.');
  censusDiff('dynamic-surface resolver', discovered.dynamic, declaredDynamicReaders,
    'It resolves names through `lucide-react/dynamic.mjs`, which still carries retired spellings — a second, more forgiving vocabulary.');

  if (discovered.record.length === 0) {
    errors.push('discovery found NO record-reading resolver at all — it is not matching imports any more, and every "no violations" below is vacuous.');
  }
  if (negativeControl && (discovered.record.includes(negativeControl) || discovered.dynamic.includes(negativeControl))) {
    errors.push(`discovery classified ${negativeControl} as a lucide resolver. It builds its OWN local \`icons\` object — discovery is matching the NAME rather than the IMPORT.`);
  }

  const authored = judgeAuthoredNodes(root, { sources, documents }, recordReadingTypes);
  const anchored = judgeAnchoredMaps(root, anchors);
  errors.push(...authored.errors, ...anchored.errors);
  if (generatedNameListRoot) errors.push(...judgeGeneratedNameList(generatedNameListRoot));

  return {
    discovered,
    errors,
    violations: [...authored.violations, ...anchored.violations],
    counters: {
      sources: sources.length,
      documents: documents.length,
      authoredJudged: authored.judged,
      authoredDeclined: authored.declined,
      authoredDescendantJudged: authored.descendantJudged,
      anchoredJudged: anchored.judged,
    },
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const invokedDirectly = isEntrypoint(import.meta.url);
if (invokedDirectly) {
  const result = analyze(gateRoot);
  const { counters, discovered, errors, violations } = result;

  if (process.argv.includes('--report')) {
    console.log(`lucide ${lucideVersion} resolved from ${LUCIDE_OWNER_PKG}`);
    console.log(`RECORD vocabulary: ${Object.keys(icons).length} keys | DYNAMIC vocabulary: ${iconNames.length} names (superset by ${iconNames.length - Object.keys(icons).length})`);
    console.log(`scanned ${counters.sources} TS sources + ${counters.documents} JSON documents under ${SCAN_ROOTS.join('/, ')}/`);
    console.log(`record-reading resolvers discovered (${discovered.record.length}):`);
    for (const file of discovered.record) console.log(`    ${file}`);
    console.log(`dynamic-surface resolvers discovered (${discovered.dynamic.length}), NOT judged here:`);
    for (const file of discovered.dynamic) console.log(`    ${file}`);
    console.log(`authored icon names judged: ${counters.authoredJudged} (${counters.authoredDescendantJudged} of them on UNTYPED child items of a declared container) | icon names on nodes this gate declines to judge: ${counters.authoredDeclined}`);
    console.log(`anchored map entries judged: ${counters.anchoredJudged}`);
    console.log('');
  }

  if (errors.length === 0 && violations.length === 0) {
    console.log(
      `OK  lucide icon names: ${counters.authoredJudged + counters.anchoredJudged} authored/declared names reaching `
      + `${discovered.record.length} record-reading resolver${discovered.record.length === 1 ? '' : 's'} are live \`icons\` keys `
      + `(record ${Object.keys(icons).length} keys; dynamic surface ${discovered.dynamic.length} sites, ${iconNames.length} names, not judged here).`,
    );
    process.exit(0);
  }

  console.error('FAIL  lucide icon names\n');
  for (const violation of violations) {
    console.error(`    - ${violation.where}  [${violation.site}]`);
    console.error(`      ${violation.detail}`);
    console.error(`      Resolved through: ${violation.resolver}`);
  }
  if (violations.length > 0 && errors.length > 0) console.error('');
  for (const message of errors) console.error(`    - ${message}`);
  console.error(
    '\nlucide retires a spelling by dropping it from the runtime `icons` record while keeping it as a\n'
    + 'deprecated export, so a retired name still imports, still type-checks and still renders as a\n'
    + 'COMPONENT — and resolves to nothing as a STRING. Nothing else goes red. See objectui#5633.',
  );
  process.exit(1);
}

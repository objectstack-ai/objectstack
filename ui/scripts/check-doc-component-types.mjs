#!/usr/bin/env node
/**
 * Every `type` string literal in a `content/docs/**` code block — `.mdx` and
 * `.md` alike — and in the root `README.md` (objectui#7115), must name a
 * component the repository actually registers, or be declared, per file, as
 * belonging to some other vocabulary. Since objectui#5106
 * the same question is also asked of the KEY TABLES that document a plugin's
 * registrations, on BOTH halves of the row: the namespaced key and the bare-name
 * fallback (see "The second surface" below).
 *
 * Run:  node scripts/check-doc-component-types.mjs   (also `pnpm check:doc-types`)
 * Exit: 0 = every teaching snippet names a registered type (or a declared
 *       exemption), 1 = at least one snippet teaches a type nothing registers,
 *       an exemption has gone stale, or the scan collapsed.
 *
 * ## The failure this closes (objectui#4823, recurrence #4 would have been free)
 *
 * `examples/schema-catalog/test/catalog-gallery-render.test.tsx` (objectui#4616)
 * renders every catalog entry and fails if any paints the registry's
 * "Unknown component type" panel (OBJUI-001). The TEACHING surface had no
 * equivalent: a ```plaintext block in `content/docs/**` is not rendered, not
 * parsed and not compared against anything, so a snippet could name any `type`
 * string at all and CI stayed green end to end.
 *
 * The same defect landed three times before this gate existed, each one found
 * by a human probe rather than by a check:
 *
 *   objectui#4786  `content/docs/**`                 taught `stats-card`
 *   objectui#4796  `content/docs/fields/grid.mdx`    taught `plugin:grid`   (real: `object-grid`)
 *   objectui#4796  `content/docs/fields/location.mdx` taught `plugin:map`   (real: `object-map`)
 *
 * A reader who copied any of them got a red panel instead of a component. The
 * first scan under this gate found two more of exactly that shape, fixed in the
 * same PR: `heading` (`utilities/runner.mdx`, `utilities/vscode-extension.mdx`
 * — nothing registers it; `h1` does) and `multi-step-form`
 * (`plugins/plugin-form.mdx` — the string appears nowhere in the repo outside
 * that snippet; the wizard is `object-form` + `formType: 'wizard'`, which
 * `WizardFormSchema` declares).
 *
 * NOT in scope, deliberately: whether the snippet's OTHER keys are read by the
 * renderer the type resolves to. That is objectui#4823's second dimension and
 * needs a per-renderer read-point contract; this gate answers one question only
 * — does the type exist.
 *
 * ## Where the registered-key universe comes from — derived, never a list
 *
 * A hard-coded key list would be the Nth copy of an enumeration this repo
 * already keeps in the register calls themselves, and it would rot the first
 * time a plugin adds a component. So the universe is derived from source on
 * every run, with no build step (which is what lets this run as a per-PR check
 * next to `check-doc-links.mjs` rather than behind a `turbo build`):
 *
 *   - DIRECT: `X.register('key', …)` / `X.registerLazy('key', …)` for the
 *     receivers listed in `REGISTRY_RECEIVERS`. `namespace` and `skipFallback`
 *     are read out of the call's OWN balanced argument span — not a fixed-size
 *     window. That distinction is load-bearing and was measured: with a
 *     1500-character window, `plugin-grid/src/index.tsx`'s `object-grid`
 *     registration (line 129) picked up the `skipFallback: true` belonging to
 *     the `grid` registration 12 lines below it, and the derivation silently
 *     dropped the bare `object-grid` key — which 13 doc sites teach correctly.
 *     A window bug in a derivation this gate trusts shows up as a false RED on
 *     correct documentation, so the span is matched, not guessed.
 *   - OPTIONS: `namespace` and `skipFallback` decide which keys a registration
 *     publishes, so `resolveRegistrationOptions` reads an ALLOWLIST of exactly
 *     two ARGUMENT shapes and REPORTS every other argument shape. Read: an
 *     object literal whose top-level entries are all key-value pairs or spreads
 *     of a plain identifier, and a bare identifier that resolves to one such
 *     literal which the same file declares exactly once — counting only names
 *     immediately after `const` / `let` / `var` or in an import clause — with
 *     `const`, and whose `namespace` or `skipFallback` this file does not
 *     assign, `delete` or `Object.assign` onto IN ONE OF THE THREE SPELLINGS
 *     `optionsMutatedAfterDeclaration` matches. ⚠️ Those two qualifications are
 *     the whole of it: the allowlist is structural about the ARGUMENT, while
 *     following a NAME rests on premises this derivation enforces only against
 *     the spellings it can see. `declaredObjectBody` and
 *     `optionsMutatedAfterDeclaration` carry the exact conditions and the
 *     measured list of shapes that slip through them SILENTLY, each pinned as a
 *     KNOWN GAP reading in `check-doc-component-types.test.ts` —
 *     `register('page', R, pageMeta)` and
 *     `register('app', R, { ...pageMeta, label: 'App Page' })` are both read,
 *     and `counters.metaViaReference` counts every site whose options arrived
 *     that way and were read — namespaced or not — which the run summary
 *     prints and a pin in the objectui#5115 suite asserts is non-zero.
 *
 *     ⛔ The allowlist is the point, and it is structural rather than a list of
 *     idioms to keep up with. Reading only the call span found no `namespace:`
 *     in either line above, so both were read as bare-only and their
 *     `namespace:key` halves were lost SILENTLY — objectui#9641, five real
 *     runtime keys absent from the universe while the firing control (the same
 *     registration shape with its options spelled out at the call) was present,
 *     which is what made it a defect rather than a choice. A best-effort repair
 *     reproduces it: a cast, a member expression, a call, a spread of any of
 *     those, a conditional spread, a computed `namespace` and a computed
 *     `skipFallback` were each measured falling through to the same silent
 *     bare-only reading. Any ARGUMENT shape not on the allowlist is therefore an
 *     `unresolved-registration-meta` finding, one fixture pin per shape in
 *     `check-doc-component-types.test.ts`. ⛔ That sentence is about the
 *     argument only: a name the allowlist accepts can still be read against the
 *     wrong object, and those readings are silent rather than reported. They
 *     are enumerated where they live, and pinned.
 *
 *     ⚠️ The same correction had to be made twice, one layer down: the
 *     allowlist is structural about the ARGUMENT, and the identifier route
 *     rests on a premise about the NAME. A `const` cannot be reassigned but its
 *     contents can be written, and a `namespace` deleted after declaration used
 *     to mint a phantom through the very binding this derivation treats as
 *     safe. Those conditions now live in `declaredObjectBody`, which is where
 *     to read them —
 *     restating them here would be a second copy to keep honest. Whether that refusal costs this tree
 *     anything is a question for the gate, not for this comment: it reds
 *     nothing today, and the day a registration reaches for one of these shapes
 *     it is told so instead of losing half its keys.
 *   - LOOP: `for (const v of ['a','b'])`, `for (const v of ARR)` and
 *     `ARR.forEach(v => …)` where `ARR` is a literal array in the same file.
 *     Five registration sites use this form (`html-elements.tsx`'s `TAGS`,
 *     `semantic.tsx`'s `tags`, and three `for (const variant of […])` blocks in
 *     `apps/console`).
 *   - INDIRECT: two helpers register from a collection, and each is named
 *     explicitly in `INDIRECT_REGISTRATIONS` with the collection it reads. Both
 *     entries are re-derived per run; a named collection that disappears or
 *     stops yielding keys fails the gate rather than shrinking the universe.
 *     ⚠️ The bypass that lets these unresolvable calls through is keyed by
 *     COLLECTION, which is what the table's coverage is keyed by. It was keyed
 *     by FILE until objectui#9717, and the two keyings are not the same set:
 *     ANY unresolvable registration living in a table-named file was skipped
 *     silently, including one whose collection the table never names.
 *     `registerAllFields()`'s `RETIRED_FIELD_TYPES` tombstone loop is the
 *     measured instance — it shares `packages/fields/src/index.tsx` with the
 *     `fieldWidgetMap` entry, so its key reached neither the universe nor a
 *     finding, and its namespace was silently folded into the reconciliation of
 *     a collection it has nothing to do with. The supplying collection is now
 *     DERIVED at the call by `indirectSupply` and matched against the entries
 *     declared for that file: `uncovered-indirect-collection` when no entry
 *     names it, `unresolved-indirect-collection` when the supplier cannot be
 *     read at all. ⛔ Neither is answered by adding the missing KEY anywhere by
 *     hand — a hand-kept key is the construction objectui#9703 removed.
 *     ⚠️ The NAMESPACE of those keys is read from the registration call, not
 *     from the entry: the entry's `namespace` is a DECLARATION reconciled
 *     against the call, and a disagreement is reported. It was an input to this
 *     derivation until objectui#9703, with nothing checking it — a namespace
 *     edit at one of these calls could not reach the generated universe, and
 *     this derivation stayed green while disagreeing with the runtime. Read the
 *     `indirect-namespace-drift` / `unresolved-indirect-namespace` reasons
 *     below for what is reported and why the table is not consulted on a fall
 *     back. `skipFallback` is the half that genuinely cannot be derived — these
 *     helpers decide it per key — so `skipFallbackSet` stays declared, and a
 *     set name that stops resolving is reported rather than read as empty.
 *   - OPEN: a handful of call sites take a key that is not knowable statically
 *     (a third-party plugin's own type, a widget manifest's `type`). Those are
 *     listed in `OPEN_REGISTRATION_SITES` with the reason. Every OTHER
 *     unresolvable call site fails the gate as `unresolved-registration` — a
 *     new dynamic registration path must be taught to this derivation, because
 *     silently missing one narrows the universe and turns correct docs red.
 *
 * The universe is deliberately GENEROUS: it unions every key any package or app
 * in the repo can register, including the opt-in protocol placeholders, without
 * modelling which host loaded which package. A doc site is judged on "does this
 * string name a component that exists", never on "is it registered in the host
 * this page happens to describe". Host-specific registration is a different
 * question with a different answer per page, and a gate that guessed at it
 * would produce exactly the false reds that get gates deleted.
 *
 * ## How a doc site is judged, and why there is no structural discriminator
 *
 * `type` is not one vocabulary in these pages. Measured over all 143 files on
 * the tree this gate was written against — 560 `type: '…'` sites in fenced code
 * blocks — the corpus carries at least seven distinct vocabularies that all
 * spell the key `type`:
 *
 *   SDUI component keys   `{ type: 'object-grid', … }`          the one this gate judges
 *   action schemas        `action: { type: 'submit' }`          `@object-ui/types`' ActionSchema
 *   block schemas         `type: 'block-instance'`              `packages/types/src/blocks.ts`
 *   theme / report schemas`type: 'theme-switcher'`, `'matrix'`  `types/src/theme.ts`, `reports.ts`
 *   field + JSON-Schema   `type: 'string'`, `type: 'currency'`  variable / property declarations
 *   validation rules      `validation: [{ type: 'minLength' }]` form rule discriminants
 *   nav + feed items      `type: 'item'`, `type: 'comment'`     menu entries, activity feed items
 *
 * The obvious discriminator — classify by the enclosing key path, so a `type`
 * under `validation` is a rule and a `type` under `children` is a node — was
 * built and MEASURED before being rejected. Two findings killed it. First, the
 * snippets are TypeScript as often as JSON, and a TS annotation reads exactly
 * like an object key to a brace-tracking scanner: `const heroBlock: BlockSchema
 * = {` made `heroBlock` the enclosing key for everything inside it, and 31 of
 * the 92 off-registry sites came out with a path a human would not recognise.
 * Second, and fatally, the fix does not converge: `items` carries nav entries on
 * one page and renderable children on another, so any global parent-key rule is
 * a silent false GREEN on one of them. A misclassifying discriminator is worse
 * than none, because its mistakes are invisible in both directions.
 *
 * So the rule is flat and stated rather than inferred:
 *
 *     EVERY `type` string literal in a docs code block is a candidate SDUI
 *     component key. If its value is in the derived universe it passes. If it
 *     is not, the file must DECLARE it in `DOC_TYPE_EXEMPTIONS` with a written
 *     reason naming the vocabulary it really belongs to. Anything else is red.
 *
 * Exemptions are keyed by (file, value), never by file alone and never by value
 * alone. A whole-file exemption would silence real defects on pages that mix
 * vocabularies — `api/schema-reference.md` carries `"type": "action"` (an
 * ActionSchema discriminant, exempted below) AND `"type": "card"` /
 * `"type": "table"` (registered component keys) in the same document, measured
 * on this tree — and a value-only exemption would let a
 * page anywhere in the tree teach `submit` as a component. (file, value) also
 * keeps the entry honest: it says which page speaks which dialect, which is the
 * fact a reader of that page needs.
 *
 * Every entry is re-derived per run. An entry whose file no longer contains
 * that value, or that carries no reason, fails as `stale-exemption` — an
 * exemption is worth what its evidence is worth, and one that outlives its site
 * widens the hole for the next snippet that lands there.
 *
 * ## Line numbers are reported, but the unit of judgment is the value
 *
 * A site is reported with `file:line` so the author can go straight to it, and
 * the exemption is keyed without the line so ordinary editing above a snippet
 * does not invalidate the table.
 *
 * ## The second surface: plugin key tables (objectui#5106)
 *
 * The rule above reads FENCED CODE ONLY, on purpose — prose that mentions a type
 * in backticks is not a snippet. That scope had a measured cost. The objectui#5002
 * family (PRs #5071 / #5078 / #5079 / #5085 / #5089 / #5093 / #5100 / #5104)
 * replaced a fictional "manual `*Components` registration loop" on eight plugin
 * pages with one canonical form — a markdown table of the keys the plugin's entry
 * really registers. The new form is the right one, and it landed entirely OUTSIDE
 * the scan surface, while the code blocks it replaced had been inside it. Net
 * effect: the fact "which keys does this plugin claim" moved from a checked place
 * to an unchecked one, guarded only by hand comparison.
 *
 * So key tables are now read, and the anchor is the TABLE HEADER, not the row:
 *
 *     | Namespaced key | Bare-name fallback | Renderer behind it |
 *
 * Anchoring on the header rather than pattern-matching rows is the whole design,
 * and it was chosen after measuring the alternative. The obvious row heuristic —
 * "first cell is a backticked token containing a colon, second cell is a
 * backticked token" — was run over this tree and matched 33 rows, of which only
 * 22 were keys. The other 11 are a `:`-bearing vocabulary this repo writes in
 * tables constantly:
 *
 *   guide/console-architecture.md:104   `/apps/:appName/:objectName` | `ObjectView`
 *   utilities/runner.mdx:99             `http://localhost:5173/`     | `LocalBundleLoader`
 *   guide/metadata-diagnostics.md:43    `GET /api/v1/meta/items/:type/:name?layered=true`
 *   guide/designing-app-navigation.md:21 `{ "type": "object", … }`
 *
 * React route patterns, URLs, HTTP routes and JSON literals — every one of them a
 * false RED on correct documentation, which is the expensive direction for a gate
 * whose whole job is to be trusted about docs. The header is a DECLARATION by the
 * page that the rows beneath it are registry keys, so it discriminates perfectly
 * where a row shape cannot, and it costs an author nothing they were not already
 * writing.
 *
 * Both halves of the row are judged, and judging the namespaced half is the point
 * objectui#5106 was filed for: this gate never judged a namespace at all. It
 * compared bare keys against a universe that happens to contain namespaced keys
 * too, so the dashboard's namespaced spelling documented as any OTHER namespace
 * over the same bare name produced no signal from any static check — the bare
 * `dashboard` matched and the row passed. Flip `namespace: 'plugin-dashboard'`
 * to `'dash'` on the dashboard registration in `plugin-dashboard/src/index.tsx`
 * and `deriveRegistryKeys` follows it live to `dash:dashboard`, while every doc
 * that teaches the old spelling stays green. That is the hole; the namespaced
 * cell closes it.
 *
 * ⚠️ This paragraph used to run the same example over the literal pair
 * `view:dashboard` / `plugin-dashboard:dashboard`, which was a live reading when
 * it was written and is not one now: objectui#9533 converged that bare key onto
 * `plugin-dashboard` and retired `view:dashboard`, so a reader following the old
 * wording would look for a `namespace: 'view'` on that registration and not find
 * it. Re-pointed with the example kept, because the example is the mechanism and
 * the spelling was only ever an illustration of it.
 *
 * What is deliberately NOT checked, and why: when the fallback cell reads
 * "none — `skipFallback: true`", this gate does not assert that the bare name is
 * absent from the universe. It cannot. The universe is a deliberate UNION across
 * every package in the repo (see "generous" above), so `view:grid` skipping its
 * own bare fallback says nothing about whether some other package registers a
 * bare `grid` — and one does. Asserting the negative would red
 * `plugins/plugin-grid.mdx:185`, which is correct. The positive half is checkable
 * and is checked; the negative half needs per-host registration modelling this
 * gate deliberately does not do.
 *
 * `DOC_TYPE_EXEMPTIONS` does not apply to table rows, and that is deliberate
 * rather than an omission. An exemption declares "this value belongs to another
 * vocabulary" — but a row under a header that says "Namespaced key" has already
 * declared its vocabulary, and there is no other one it could be. A row that
 * cannot be registered is a wrong row (or a header being borrowed for a table
 * that is not a key table), and both are worth fixing rather than silencing.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';
import { closesFence, openFence } from './markdown-fence-scan.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));

// ── Configuration ────────────────────────────────────────────────────────────

/** Where the teaching prose lives. This gate walks `content/docs`, every
 *  `apps/<app>/docs/**` tree (objectui#6600), every `packages/NAME/README.md`
 *  (objectui#7896's fourth leg, landed by objectui#8115) and the root pages named
 *  below, and nothing else: not `skills/**`, not `docs/**`. ⚠️ This sentence used
 *  to name the package READMEs among the trees this gate does NOT walk, and
 *  pointed at `check-doc-snippet-types.mjs` as covering them — that gate covers
 *  them for ITS question (it compiles their `ts` fences), which is not this one,
 *  and the gap between the two questions is exactly what objectui#7896 was filed
 *  for. The full ownership map for all three doc gates — including the trees NO
 *  gate reads, and why `skills/**` is deliberately not one of them — is stated
 *  once in `check-doc-snippet-types.mjs`, beside `UNGATED_DOCS`. */
const DOCS_ROOT = 'content/docs';

/**
 * Per-app documentation trees, `apps/<app>/docs/**` (objectui#6600).
 *
 * ⚠️ This gate joining the move is the one judgement ruling D left to the
 * implementing lane, and it is joining at ZERO PRESENT YIELD: the three files
 * under `apps/console/docs/**` carry 0 `type` literals today, so this walk finds
 * nothing on the day it lands. Stated plainly because the alternative reading —
 * that a widened scope was justified by a discovery — is false here.
 *
 * The argument for joining anyway is the split-surface defect one directory over,
 * which this gate has already been burned by ONCE. objectui#7115: this gate
 * walked `content/docs`; `check-doc-snippet-types` walked `content/docs` plus the
 * package READMEs; the root `README.md` fell BETWEEN the two and was read by
 * neither, and it taught the unregistered type `stat-card` four times for as long
 * as the example existed. Leaving this gate pointed away from a tree its two
 * siblings now read would rebuild that exact geometry, deliberately, in the same
 * gate family — and `apps/console/docs/UI_IMPROVEMENT_PROPOSAL.md` is a proposal
 * about console UI shape, i.e. the file in that tree most likely to grow the
 * first `type` literal. A forward guard at zero yield is what objectui#7115
 * wishes had existed.
 *
 * ⛔ What this is NOT: a precedent for widening onto any other unscanned tree.
 * The population here is three files in a directory two sibling gates are moving
 * onto in the same change. No allowlist mechanism exists and none is wanted.
 *
 * The walk is `apps/<app>/docs`, one level of app directory and no deeper before
 * the `docs` segment. `apps/site/app/docs` is a Next.js ROUTE directory of `.tsx`
 * route files, not a documentation tree.
 */
export const APP_DOCS = { dir: 'apps', subdir: 'docs' };

/** Every `apps/<app>/docs` directory that exists, in a stable order. */
export function appDocsDirs(root) {
  const appsDir = join(root, APP_DOCS.dir);
  if (!existsSync(appsDir)) return [];
  const out = [];
  for (const entry of readdirSync(appsDir).sort()) {
    const docs = join(appsDir, entry, APP_DOCS.subdir);
    if (existsSync(docs) && statSync(docs).isDirectory()) out.push(docs);
  }
  return out;
}

/**
 * `packages/NAME/README.md` — WALKED (objectui#7896's fourth leg, objectui#8115).
 *
 * A package README is a teaching surface that ships to npm inside that package's
 * `files` list, and until this leg landed its `type` literals were read TWICE and
 * judged NEVER: `check-doc-snippet-types.mjs` compiles their `ts` / `tsx` /
 * `typescript` fences and `check-doc-fence-languages.mjs` labels every fence in
 * them, while this gate — the only one that asks whether a `type` names a
 * component that exists — walked past them. That is objectui#7115's geometry
 * rebuilt one directory over, and objectui#7896 measured it twice the way a
 * coverage claim has to be measured: a component `type` mutated inside
 * `packages/app-shell/README.md` left this gate at `EXIT=0` with counters
 * BYTE-IDENTICAL to the unmutated run, while the same mutation in the root
 * `README.md` gave `EXIT=1`. Identical counters are the proof a file is outside
 * the scan population altogether rather than judged and forgiven, and moving them
 * is what this leg is owed. The same pair re-run with this leg in place is the
 * evidence the widening is real; the pins below `objectui#7896` in
 * `check-doc-component-types.test.ts` are where it is kept re-derivable.
 *
 * ⚠️ The leg is deliberately NOT recursive and stops at each package's own root.
 * `packages/` is not an authored tree the way `content/docs` is — under pnpm every
 * package carries a `node_modules/` of SYMLINKS back into its workspace siblings,
 * so a recursive walk that follows them does not terminate. The sibling gate that
 * does walk below a package root states the measured numbers beside its own
 * `NESTED_PACKAGE_READMES`; this leg avoids the question structurally by not
 * descending at all, which also keeps it the same shape as the surface
 * `check-doc-snippet-types.mjs` collects in its own package-README leg.
 *
 * ## ⚠️ Why the leg could not land before objectui#8115, and what came with it
 *
 * The `domain:ui` ruling on objectui#7896 ordered this move census-first: a change
 * that moves a gate's scan population reports before it enforces, and the widening
 * may land in the same pull request ONLY if the census reads zero. It did not, and
 * it does not now — this leg brings unregistered `type` literals in package
 * READMEs into a walk that judges them, and every one of them is another
 * vocabulary with a declaration site in source. Those are the
 * `DOC_TYPE_EXEMPTIONS` entries keyed under `packages/` below, ruled one at a time
 * under objectui#8115 (triage `5582405961`, option A; reading A₁ in `5594701696`:
 * the ruled entries land WITH the leg, in one change, because an entry whose
 * `(file, value)` the walk never reaches fails as `stale-exemption` — so there is
 * no order in which they could land first).
 *
 * ⛔ The exemption table is not a switch for turning this first run green, and
 * that fence is the reason each entry below names its vocabulary AND where that
 * vocabulary is declared: stuffing the table here would bury a real defect among
 * entries nobody read. Two sites of the original census were re-classified as
 * DEFECTS rather than exempted and fixed on their own cards — the
 * `activity-timeline` detail tab (objectui#8114) and the flow node type `action`
 * (objectui#8483) — which is what this fence is for.
 *
 * ⚠️ And the census is DATED wherever it is written down. The reading this
 * docblock used to carry (26 sites across 8 files, re-derived on `c30026715`) was
 * already stale by the time the leg landed, because objectui#8114's fix removed
 * one of the sites it counted. ⛔ Do not inherit a count from this file or from
 * objectui#8115's card — re-derive it with this gate's own `deriveRegistryKeys`,
 * its fence walker and its `type` matcher over `packageReadmePages`, and anchor
 * whatever you write to the commit you measured it on. A file COUNT is what a
 * later reader uses to judge whether a fix is complete, so a rotted one reads as
 * unfinished work that does not exist (objectui#8484, and objectui#7448 one file
 * over).
 *
 * ⚠️ What this is NOT: a precedent for widening onto an arbitrary unscanned tree,
 * which is what the ⛔ beside `APP_DOCS` refuses. `packages/NAME/README.md` is the
 * surface this gate's own two siblings already walk, so the move aligns the third
 * gate to its family rather than reaching into a new tree.
 *
 * ## The two couplings this leg owes, and where they are kept
 *
 * The leg sits BEFORE the root pages in `scanDocs`, which is the slot the two
 * sibling walks append it in and what keeps the three document lists comparable
 * element by element. And `check-doc-expression-carriage.mjs` IMPORTS this file's
 * surface constants and pins its own walk as an EQUALITY against a walk rebuilt
 * from them — that pin compares against the CONSTANTS, not against this gate's
 * actual walk, so a leg added here ALONE would leave the pin GREEN while the two
 * surfaces silently diverge, which is objectui#7115's shape a third time. That
 * census takes the same leg through `PACKAGE_READMES` / `packageReadmePages`
 * below, and its `SURFACE_LABEL` names it.
 */
export const PACKAGE_READMES = { dir: 'packages', name: 'README.md' };

/**
 * Every package's own `README.md`, in a stable order.
 *
 * An absent `packages/` yields `[]` so a throwaway fixture tree stays scannable,
 * exactly as `appDocsDirs` and the root-page leg do. A real run cannot rely on
 * that: the CLI refuses to publish a verdict when this leg collects nothing,
 * because a leg that reaches no file is a surface that shrank in silence, which
 * is the defect this whole widening exists to close.
 *
 * Exported so the carriage census asks this gate what the leg contains instead of
 * rebuilding it — one walk, not two arrays that agree today.
 */
export function packageReadmePages(root) {
  const pkgDir = join(root, PACKAGE_READMES.dir);
  if (!existsSync(pkgDir)) return [];
  const out = [];
  for (const entry of readdirSync(pkgDir).sort()) {
    const readme = join(pkgDir, entry, PACKAGE_READMES.name);
    if (existsSync(readme)) out.push(readme);
  }
  return out;
}

/**
 * Pages at the repository ROOT that join the walk by name.
 *
 * objectui#7115. The root `README.md` is the most-read authored file in the
 * repository — the GitHub landing page and the npm package page — and it was the
 * one teaching surface NO doc gate read. This gate walked `content/docs`; its
 * sibling `check-doc-snippet-types.mjs` walked `content/docs` plus the package
 * READMEs; the root README fell between the two. It taught `stat-card` four
 * times, in the flagship "dashboard in JSON" example, and `stat-card` is
 * registered nowhere — four `OBJUI-001` "Unknown component type" panels for
 * anyone who copied the headline snippet. The defect survived for exactly one
 * reason: nothing read the file. That is objectui#5174's shape (40 `.md` guides
 * outside the ledger) and objectui#5342's, one directory up.
 *
 * ⚠️ Widening a scan surface is the change that can be GREEN ABOUT NOTHING, so
 * this entry landed RED FIRST: with the name added and the content still saying
 * `stat-card`, this gate failed on `README.md:290`-`:293` with
 * `unregistered-doc-type`. That failure is the evidence the walk reaches the
 * file; the content fix then turned it green. Anything added here later is owed
 * the same proof, in that order.
 *
 * A name here that does not resolve is a FAILED run, not a quiet skip — see the
 * check beside `FLOORS` in the CLI block. Without it, renaming or moving the
 * file would silently return the surface to what objectui#7115 found.
 *
 * Exported so the equality is checked rather than hoped for: three gates now
 * carry this array, and `check-doc-fence-languages.test.ts` pins all three
 * against each other.
 */
export const ROOT_PAGES = ['README.md'];

/** Page extensions collected under `DOCS_ROOT`. BOTH are collected, and that is
 *  the whole content of the scan surface: `content/docs` is authored in a mix of
 *  `.mdx` and `.md` — the same guide tree, the same renderer, the same reader —
 *  and an extension is not a coverage decision. Deliberately kept identical to
 *  `check-doc-snippet-types.mjs`'s `DOC_EXTENSIONS`: two collectors walking one
 *  tree two different ways is a defect one level up from either gate, and it is
 *  how a page ends up covered by the question it passes and invisible to the one
 *  it fails.
 *
 *  Collecting only `.mdx` is what objectui#5342 measured, and unlike its sibling
 *  objectui#5174 this file was never lying about it — the sentence above used to
 *  say `.mdx` and the ledger was keyed by `.mdx` paths throughout. It was a
 *  stated coverage decision, not a broken promise, and the decision is now the
 *  other way: 40 `.md` pages sat outside the ledger, so they were neither
 *  covered nor declared ungated. Anything else under the tree (the `meta.json`
 *  sidecars) holds no prose and is not a page. */
const DOC_EXTENSIONS = ['.mdx', '.md'];

/** The header that marks a markdown table as a plugin KEY TABLE — the canonical
 *  form the objectui#5002 family standardised on, and the anchor this gate uses
 *  to read tables without reading prose. See "The second surface" in the header
 *  for the measurement that rejected row-shape matching in favour of this.
 *
 *  Matched on the first two cells only: pages spell the third column
 *  "Renderer behind it", and pinning a description column would make the gate
 *  brittle about wording that carries no meaning for it. Anchored with `^` and a
 *  literal `|` so it cannot match the same words in prose. */
const KEY_TABLE_HEADER = /^\s*\|\s*Namespaced key\s*\|\s*Bare-name fallback\s*\|/i;

/** A markdown delimiter row (`| --- | --- |`), which is what makes the line above
 *  it a header rather than an ordinary row that happens to read like one. */
const TABLE_DELIMITER = /^\s*\|[\s:|-]+\|\s*$/;

/** A table cell holding exactly one backticked token, and nothing else. */
const BACKTICKED_CELL = /^`([^`]+)`$/;

/** The fallback cell's "this registration passes `skipFallback: true`" spelling.
 *  Recognised so the row is still JUDGED on its namespaced half rather than
 *  skipped — a row this gate cannot read is a row it silently stops guarding. */
const NO_FALLBACK_CELL = /^none\b/i;

/** Where registrations live. Every workspace source root that can register. */
const SOURCE_ROOTS = ['packages', 'apps', 'examples'];

/**
 * Receiver expressions whose `.register(` / `.registerLazy(` is a
 * ComponentRegistry registration. Spelled out rather than matched loosely
 * because this repo has several unrelated `.register(` methods — react-hook-form
 * controls, the formula table, the record context, `serviceWorker.register` —
 * and treating those as registrations would put arbitrary strings into the
 * universe.
 */
const REGISTRY_RECEIVERS = ['ComponentRegistry', 'componentRegistry', 'registry', 'scope'];

/**
 * Helpers that register from a collection instead of from a literal argument.
 * Each entry names the collection it reads; the derivation re-reads that
 * collection every run and fails if it is gone.
 *
 * ⚠️ `namespace` here is a DECLARATION, ⛔ not the value the derivation uses.
 * The derivation reads the namespace out of the registration call and reports
 * `indirect-namespace-drift` when this value disagrees with it (objectui#9703).
 * Until then this field WAS the value — a hand-kept input to a derivation with
 * nothing reconciling it, so the derivation could be green and wrong at once.
 * `skipFallbackSet` is the other half and is genuinely not derivable: these
 * helpers decide `skipFallback` per key at the call, so the set is named here
 * and read from the site file, and a name that stops resolving is reported.
 *
 * ⚠️ `excluded` is the OTHER disposition, and an entry carrying it contributes
 * NO keys: it declares that this collection's registrations are known and that
 * their keys deliberately stay out of the universe, with the reason written
 * down. It exists because the alternative is the silence objectui#9717 was
 * filed about — a registration nobody had reasoned about, producing the right
 * answer by accident. ⛔ It is not a way to quiet a finding: an excluded entry
 * is still reconciled against the call and still goes stale the moment the
 * registration it names stops existing, and the run summary prints how many
 * collections are being withheld, so the decision cannot sink out of view.
 *
 * EXPORTED because the `protocol-placeholder` entry is also the DECLARATION a
 * sibling gate reads to tell a real renderer from a placeholder panel
 * (`check-prompt-component-keys.mjs`, objectui#8929). That gate must never
 * carry its own list of placeholder key names — such a list is exactly the
 * drift it exists to close — so it asks this table which module the
 * placeholders come from and follows it live.
 */
export const INDIRECT_REGISTRATIONS = [
  {
    site: 'packages/components/src/renderers/placeholders.tsx',
    collection: 'PROTOCOL_COMPONENTS',
    kind: 'array',
    namespace: 'protocol-placeholder',
    reason:
      '`registerPlaceholder(type)` registers every entry of PROTOCOL_COMPONENTS under the ' +
      '`protocol-placeholder` namespace (opt-in via registerPlaceholders(); apps/console calls it). ' +
      'The keys are protocol vocabulary the docs legitimately teach.',
  },
  {
    site: 'packages/components/src/renderers/placeholders.tsx',
    collection: 'PALETTE_PLACEHOLDER_BLOCKS',
    kind: 'array',
    namespace: 'protocol-placeholder',
    reason:
      'The same `registerPlaceholder(type)` helper the PROTOCOL_COMPONENTS entry above names is ALSO ' +
      'handed this collection, eagerly, in every host — palette-offered page blocks must not render a ' +
      'red unknown-type panel just because a host skipped the opt-in bootstrap. It went undeclared ' +
      'until objectui#9717 because the bypass was keyed by file, and a sibling entry naming this file ' +
      'answered for it. ⚠️ Its members are today a subset of PROTOCOL_COMPONENTS, so declaring it adds ' +
      'no key — but that overlap is a coincidence nothing holds in place, and the next palette block ' +
      'that is not protocol vocabulary would have gone missing in exactly the same silence.',
  },
  {
    site: 'packages/fields/src/index.tsx',
    collection: 'fieldWidgetMap',
    kind: 'object-keys',
    namespace: 'field',
    skipFallbackSet: 'FIELD_TYPES_SKIP_FALLBACK',
    reason:
      '`registerField(fieldType)` registers each key of fieldWidgetMap as `field:<type>` (plus the ' +
      'bare key unless FIELD_TYPES_SKIP_FALLBACK holds it), and `registerAllFields()` runs it for ' +
      'every key at module load. Since objectui#10859 batch 8 the set holds EVERY key, so this ' +
      'entry contributes `field:<type>` keys only. A field page\'s `type: \'boolean\'` is the FIELD ' +
      'vocabulary, not a node type, and each such page declares it in DOC_TYPE_EXEMPTIONS — those ' +
      'values used to pass here only because the bare fallback shared their spelling.',
  },
  {
    site: 'packages/fields/src/index.tsx',
    collection: 'RETIRED_FIELD_TYPES',
    kind: 'object-keys',
    namespace: 'field',
    excluded:
      'WITHHELD by ruling objectui#9717 letter A, which answered NO to exactly this question: does a ' +
      'RETIRED TOMBSTONE SPELLING belong in a universe whose job is "does this string name a component that ' +
      'exists"? ⚠️ DROPPING this `excluded` line does NOT admit the collection\'s keys (today ' +
      '`field:owner`): without the exclusion the derivation has to read the collection literal in the ' +
      'site file, where RETIRED_FIELD_TYPES is IMPORTED from `@object-ui/core` (the `reason` below says ' +
      'so), so THIS entry reports `stale-indirect-registration`, `check:doc-types` and ' +
      '`regenerate-known-schema-types.mjs --check` both exit non-zero, and a document teaching ' +
      '`field:owner` stays RED for that different reason — admitting the spelling is NOT a one-line ' +
      'change; re-derive this by deleting the line and running those two commands.',
    reason:
      '`registerAllFields()` registers every key of RETIRED_FIELD_TYPES a second time, last, under the ' +
      '`field:` namespace with `skipFallback: true` — a tombstone widget that renders a visible refusal ' +
      'naming the migration, which is the whole point of the table. Until objectui#9717 this ' +
      'registration was invisible here: the bypass was keyed by file, the `fieldWidgetMap` entry above ' +
      'named the same file, and these keys left no trace in the universe and no finding either. The ' +
      'keys stay out — but now BY DECLARATION. ⚠️ Two things this entry is deliberately NOT: it does ' +
      'not name the keys (the collection is read at runtime by the registration, and a hand-kept key ' +
      'list is the construction objectui#9703 removed), and it does not read the collection literal — ' +
      'RETIRED_FIELD_TYPES is IMPORTED into this file from `@object-ui/core`, so nothing here could ' +
      'read it anyway. What re-checks this entry is the registration call itself: delete the tombstone ' +
      'loop and this entry reports `stale-indirect-registration`.',
  },
  {
    site: 'packages/plugin-dashboard/src/index.tsx',
    collection: 'RETIRED_DASHBOARD_NODE_TYPES',
    kind: 'object-keys',
    namespace: 'view',
    excluded:
      'WITHHELD, the same disposition and the same ruling as the RETIRED_FIELD_TYPES entry ' +
      'above (objectui#9717 letter A: retired spellings stay OUT): does a RETIRED TOMBSTONE SPELLING ' +
      'belong in a universe whose job is ' +
      '"does this string name a component that exists"? Held the same way here so the two answers ' +
      'cannot drift apart. ⭐ For this collection the exclusion also carries the point of the ' +
      'retirement: objectui#8760 graded a key that passes every authoring check and fails only in ' +
      "front of a user as the WRONG side of the line, so a spelling this package has retired must be " +
      'named by `objectui check` rather than blessed by the generated whitelist. ⚠️ DROPPING this ' +
      '`excluded` line does NOT re-admit `view:dashboard` — measured on this tree it makes THIS entry ' +
      'report `stale-indirect-registration`, and `check:doc-types` and ' +
      '`regenerate-known-schema-types.mjs --check` both exit non-zero and write nothing. Without the ' +
      'exclusion the derivation has to read the collection literal in the site file, and ' +
      'RETIRED_DASHBOARD_NODE_TYPES is IMPORTED there from `./retired-node-types` (the `reason` below ' +
      'says so for its own purposes), so it resolves to no literal keys at all: the universe does not ' +
      'regain the spelling, `KNOWN_SCHEMA_TYPES` is not rewritten, and a document teaching ' +
      '`view:dashboard` stays RED — it just stays red for a DIFFERENT reason, with the gate now ' +
      'refusing the whole entry. ⇒ admitting the spelling is NOT a one-line change here; the keys ' +
      'would first have to be readable from this file. Re-derive both halves by deleting the line and ' +
      'running those two commands.',
    reason:
      '`packages/plugin-dashboard` registers every key of RETIRED_DASHBOARD_NODE_TYPES last, under the ' +
      '`view` namespace with `skipFallback: true` — a tombstone widget that renders a visible refusal ' +
      'naming the migration to `plugin-dashboard:dashboard` (objectui#9533, director summon #24 / ' +
      'batch #152 item 5, letter 1). ⚠️ Two things this entry is deliberately NOT: it does not name ' +
      'the keys, and it does not read the collection literal — RETIRED_DASHBOARD_NODE_TYPES is ' +
      'IMPORTED into the site file from `./retired-node-types`, so nothing here could read it anyway. ' +
      'What re-checks this entry is the registration call itself: delete the tombstone loop and this ' +
      'entry reports `stale-indirect-registration`.',
  },
];

/**
 * Registration call sites whose key genuinely cannot be known statically. Each
 * is matched by `<file>:<line>` and must still BE a register call on that line,
 * so a moved or deleted site is reported rather than silently forgiven.
 */
const OPEN_REGISTRATION_SITES = {
  'packages/core/src/registry/PluginScopeImpl.ts': {
    receiver: 'registry',
    reason:
      'PluginScope.register() forwards a third-party plugin\'s own type through to the registry. ' +
      'The key belongs to the plugin, not to this repository, so there is nothing here to derive.',
  },
  'packages/core/src/registry/WidgetRegistry.ts': {
    receiver: 'componentRegistry',
    reason:
      'WidgetRegistry registers `manifest.type` from a host-supplied widget manifest. The manifest ' +
      'is data, not source, so its types are not derivable from this tree.',
  },
};

/**
 * Per-file declarations that a `type` value in that page belongs to a
 * vocabulary other than the SDUI component registry.
 *
 * Keyed `<repo-relative doc path>` -> `<type value>` -> reason. The reason must
 * name the vocabulary and, where one exists, where it is declared — an
 * exemption that only says "not a component" teaches the next reader nothing
 * and cannot be re-checked.
 */
const DOC_TYPE_EXEMPTIONS = {
  'content/docs/api/schema-reference.md': {
    metric:
      'Dashboard widget kind under `widgets[].type` — `metric`, a member of `ChartTypeSchema` ' +
      '(@objectstack/spec/ui) reaching this repo by reference through `DashboardWidgetTypeName`. ' +
      'Not a node type: the node type is `dashboard`, which the enclosing snippet spells. The NODE ' +
      'key the dashboard renders this widget through is `plugin-dashboard:metric`: objectui#10859 ' +
      'batch 8 (phase 2b) moved both dashboard surfaces onto that key and gave the registration ' +
      '`skipFallback: true`, which is the only reason this value used to pass here as a registered ' +
      'key.',
    'metric-card':
      'Dashboard widget-slot entry directly in a `dashboard`\'s `widgets[]` — ' +
      '`DASHBOARD_COMPONENT_WIDGET_TYPES` (`@object-ui/types`\' `complex` module; its TypeScript face ' +
      'is `DashboardWidgetSlotComponentSchema`), the closed ' +
      'component slot of the 2026-08-14 ruling (objectstack#8593). Not a node position: the node ' +
      'type is `dashboard`, which the enclosing snippet spells. The dashboard hands the entry to ' +
      'the registry as `plugin-dashboard:metric-card`: objectui#10859 batch 8 (phase 2b) gave that ' +
      'registration `skipFallback: true`, which is the only reason this value used to pass here as ' +
      'a registered key.',
    kanban:
      'ViewSwitcher `views[].type` — the VIEW-TYPE vocabulary (`ViewType`, ' +
      'packages/types/src/views.ts), which is what a switcher tab names, not a node type; the ' +
      'nested `schema` in the same snippet carries `object-kanban`, the node type. Needed from ' +
      'objectui#8802, which retired the bare `kanban` NODE type key — until then the value ' +
      'passed by coincidence, the two vocabularies sharing one spelling. ⛔ The stored/view-type ' +
      'spelling is deliberately NOT retired (`ObjectView` maps a stored `kanban` view onto the ' +
      '`object-kanban` node type). Same vocabulary as the `components/complex/view-switcher.mdx` ' +
      'entry below.',
    action:
      'ActionSchema discriminant under an ACTION LIST, never a rendered child — an action\'s own ' +
      '`dialog.actions[]` and `chain[]`, a detail page\'s `actions[]` and a CRUD dialog\'s ' +
      '`actions[]` are each typed `ActionSchema[]` (packages/types/src/crud.ts:154, 175, 290, 341), ' +
      'and that interface declares `type: \'action\'` at crud.ts:68. Same vocabulary as the ' +
      '`core/enhanced-actions.mdx` entry below. (This reason used to cite `CRUDSchema`\'s ' +
      '`toolbar.actions[]` / `rowActions[]` / `batchActions[]` as the carriers; those keys were ' +
      'retired with `CRUDSchema` in objectui#5373, and the sites this exemption covers on the page ' +
      'now sit under ActionSchema and DetailSchema.)',
    string:
      'PageNodeSchema variable declaration\'s data type inside `variables[]`, next to `name` / ' +
      '`defaultValue` — `PageVariable` (packages/types/src/layout.ts:566, re-exported from ' +
      '@objectstack/spec\'s `PageVariableSchema`). (This reason used to add "same vocabulary as ' +
      'blocks/block-schema.mdx\'s `string`"; that page was DELETED with the whole block schema ' +
      'family in objectui#4895, so this entry now stands on its own declaration site.)',
    area:
      'Dashboard widget kind under `widgets[].type` in the `DashboardComponentSchema` example — a ' +
      'member of `ChartTypeSchema` (@objectstack/spec/ui) reaching this repo by reference through ' +
      '`DashboardWidgetTypeName`. Not a node type: the node type is `dashboard`, which the enclosing ' +
      'snippet spells. Needed from objectui#11070 round 6, which moved that example\'s `component` ' +
      'chart to the dataset-bound widget form under objectui#11228 ruling C. Same vocabulary as the ' +
      '`packages/plugin-dashboard/README.md` entries below.',
    date:
      'Detail-view field type in a `groups[].fields[]` entry, next to `text` / `email` — ' +
      '`DetailViewField.type` (packages/types/src/views.ts), the field vocabulary a detail value is ' +
      'formatted by. Not a node type. objectui#10859 batch 8 retired the bare `date` field-widget ' +
      'fallback, which is the only reason this value used to pass here as a registered key.',
  },
  // `content/docs/blocks/{authentication,dashboard,ecommerce,forms,marketing}.mdx`
  // each had one entry here — `submit` / `navigate` / `analytics`, the
  // discriminant inside a `button` node's `action` bag. objectui#5250 slice B
  // removed every one of those bags: `button` declares no `action` and nothing
  // reads one, so the strict authoring face refused all five snippets, which now
  // teach an `action:button` node instead (or, for `analytics`, nothing — no
  // executor of that name exists). Deleted with their sites.
  // `content/docs/blocks/block-schema.mdx` had five entries here — `block`,
  // `block-instance`, `block-library`, `block-editor` (the four block-family
  // discriminants) and `string` (a `BlockVariable.type` data type) — plus a note
  // recording that `slot` had already left in the objectui#5937 docs-truth fix.
  // The PAGE is gone: the block schema family was retired whole in objectui#4895
  // (ADR-0049 enforce-or-remove, maintainer ruling 2026-09-02, option C1), so
  // every one of those entries would now fail as `stale-exemption`. Deleted with
  // their site rather than re-pointed — there is no page left to point at.
  'content/docs/components/complex/filter-ui.mdx': {
    'date-range':
      'Filter control type — `packages/types/src/crud.ts:329` and `views.ts:804` declare it in the ' +
      'filter enum, alongside `date-picker` / `number-range`.',
  },
  'content/docs/components/complex/view-switcher.mdx': {
    kanban:
      'ViewSwitcher `views[].type` — the VIEW-TYPE vocabulary (`ViewType`, ' +
      'packages/types/src/views.ts), which is what a switcher tab names, not a node type. ' +
      'The nested `schema` in the very same snippet carries the node type. Needed from ' +
      'objectui#8802, which retired the bare `kanban` NODE type key — until then the value ' +
      'passed by coincidence, the two vocabularies sharing one spelling. ⛔ The stored/view-type ' +
      'spelling is deliberately NOT retired: `ObjectView` maps a stored `kanban` view onto the ' +
      '`object-kanban` node type, and renaming it would break every stored kanban view in every ' +
      'deployment.',
    share:
      'First member of a TypeScript union of view-action ids (`\'share\' | \'settings\' | ' +
      '\'duplicate\' | \'delete\'`) in a Schema API declaration, not a node type.',
  },
  'content/docs/components/index.md': {
    'component-name':
      'Metasyntactic placeholder in the page\'s "Usage Pattern" template — the block shows the SHAPE ' +
      'every component schema has (`type` / `className` / component-specific props) and the value ' +
      'stands for whichever key the reader picked from the catalog below it. Nothing registers the ' +
      'literal string, by design.',
  },
  'content/docs/core/app-schema.mdx': {
    item: 'AppSchema menu entry kind — a navigation item, sibling of `group`. Not a rendered node.',
    group: 'AppSchema menu entry kind — a navigation group holding `children` items.',
    action:
      'NavigationItem kind under an app\'s `navigation` (`NavigationItemTypeSchema`, spec ' +
      '`ActionNavItemSchema`) — an entry that names a declared action by `actionDef.actionName`, ' +
      'which the console sidebar dispatches. Not a rendered node. The page teaches it as the one ' +
      'channel for app-level actions since objectui#7469 retired the app node\'s `actions` array.',
  },
  'content/docs/core/enhanced-actions.mdx': {
    action:
      'ActionSchema discriminant. This page documents the action vocabulary end to end, so every ' +
      '`type: \'action\'` here is an action definition rather than a node.',
    boolean:
      'Action parameter type in an action\'s `params[]` — `ActionParam` ' +
      '(packages/types/src/ui-action.ts), whose `type` is the field vocabulary the parameter dialog ' +
      'renders. Not a node type. objectui#10859 batch 8 retired the bare `boolean` field-widget ' +
      'fallback, which is the only reason this value used to pass here as a registered key.',
    file:
      'Action parameter type in an action\'s `params[]` — `ActionParam` ' +
      '(packages/types/src/ui-action.ts), whose `type` is the field vocabulary the parameter dialog ' +
      'renders. Not a node type. objectui#10859 batch 8 retired the bare `file` field-widget ' +
      'fallback, which is the only reason this value used to pass here as a registered key.',
  },
  'content/docs/core/report-schema.mdx': {
    line: 'Chart series kind under a report section\'s `chart.series`, not a node type.',
    'page-break':
      'ReportSection kind — `packages/types/src/reports.ts:210` declares the section enum ' +
      '(`header | summary | chart | table | text | page-break`).',
    'report-builder':
      'ReportBuilderSchema discriminant — packages/types/src/reports.ts:464, zod/reports.zod.ts:154.',
    string: 'Report field data type in a `fields` declaration, not a node type.',
    number:
      'Report field data type in a `fields` / `availableFields` declaration — `ReportField.type` ' +
      '(packages/types/src/reports.ts), the vocabulary this file\'s `string` entry names. Not a ' +
      'node type. objectui#10859 batch 8 retired the bare `number` field-widget fallback, which is ' +
      'the only reason this value used to pass here as a registered key.',
    summary:
      'ReportSection kind under a report\'s `sections[]`, sibling of `header` — ' +
      '`ReportSection.type` (packages/types/src/reports.ts), the enum this file\'s `page-break` ' +
      'entry names. Not a node type. objectui#10859 batch 8 retired the bare `summary` field-widget ' +
      'fallback, which is the only reason this value used to pass here as a registered key.',
  },
  'content/docs/core/schema-renderer.mdx': {
    'my-widget':
      'Deliberate placeholder in the "register your own component" walkthrough — the page teaches ' +
      'the reader to register this key, so it is unregistered here by design.',
  },
  'content/docs/fields/auto-number.mdx': {
    autonumber:
      'FIELD type documented by this page: `AutoNumberFieldMetadata` (`FieldMetadata`, ' +
      'packages/types/src/field-types.ts) declares the literal, the `@objectstack/spec` ' +
      '`FieldType` spelling (objectui#12242, which retired `auto_number` as a field type), and the ' +
      'form renders it through `field:auto_number`. Not a node type.',
  },
  'content/docs/fields/boolean.mdx': {
    boolean:
      'FIELD type documented by this page: `BooleanFieldMetadata` (`FieldMetadata`, ' +
      'packages/types/src/field-types.ts) declares the literal, and the form renders it through ' +
      '`field:boolean`. Not a node type. objectui#10859 batch 8 retired the bare `boolean` ' +
      'field-widget fallback, which is the only reason this value used to pass here as a registered ' +
      'key.',
  },
  'content/docs/fields/currency.mdx': {
    currency:
      'FIELD type documented by this page: `CurrencyFieldMetadata` (`FieldMetadata`, ' +
      'packages/types/src/field-types.ts) declares the literal, and the form renders it through ' +
      '`field:currency`. Not a node type. objectui#10859 batch 8 retired the bare `currency` ' +
      'field-widget fallback, which is the only reason this value used to pass here as a registered ' +
      'key.',
  },
  'content/docs/fields/date.mdx': {
    date:
      'FIELD type documented by this page: `DateFieldMetadata` (`FieldMetadata`, ' +
      'packages/types/src/field-types.ts) declares the literal, and the form renders it through ' +
      '`field:date`. Not a node type. objectui#10859 batch 8 retired the bare `date` field-widget ' +
      'fallback, which is the only reason this value used to pass here as a registered key.',
    datetime:
      'FIELD type documented by this page: `DateTimeFieldMetadata` (`FieldMetadata`, ' +
      'packages/types/src/field-types.ts) declares the literal, and the form renders it through ' +
      '`field:datetime`. Not a node type. objectui#10859 batch 8 retired the bare `datetime` ' +
      'field-widget fallback, which is the only reason this value used to pass here as a registered ' +
      'key. (The page\'s "DateTime Variant" section.)',
  },
  'content/docs/fields/datetime.mdx': {
    datetime:
      'FIELD type documented by this page: `DateTimeFieldMetadata` (`FieldMetadata`, ' +
      'packages/types/src/field-types.ts) declares the literal, and the form renders it through ' +
      '`field:datetime`. Not a node type. objectui#10859 batch 8 retired the bare `datetime` ' +
      'field-widget fallback, which is the only reason this value used to pass here as a registered ' +
      'key.',
  },
  'content/docs/fields/file.mdx': {
    file:
      'FIELD type documented by this page: `FileFieldMetadata` (`FieldMetadata`, ' +
      'packages/types/src/field-types.ts) declares the literal, and the form renders it through ' +
      '`field:file`. Not a node type. objectui#10859 batch 8 retired the bare `file` field-widget ' +
      'fallback, which is the only reason this value used to pass here as a registered key.',
  },
  'content/docs/fields/formula.mdx': {
    formula:
      'FIELD type documented by this page: `FormulaFieldMetadata` (`FieldMetadata`, ' +
      'packages/types/src/field-types.ts) declares the literal, and the form renders it through ' +
      '`field:formula`. Not a node type. objectui#10859 batch 8 retired the bare `formula` ' +
      'field-widget fallback, which is the only reason this value used to pass here as a registered ' +
      'key.',
  },
  'content/docs/fields/grid.mdx': {
    currency:
      'Column type inside a `grid` FIELD\'s `columns[]` — `GridFieldMetadata.columns`, typed by ' +
      'reference to @objectstack/spec\'s `FieldSchema.inlineColumns`. A sub-field\'s data type, not ' +
      'a node type. objectui#10859 batch 8 retired the bare `currency` field-widget fallback, which ' +
      'is the only reason this value used to pass here as a registered key.',
    date:
      'Column type inside a `grid` FIELD\'s `columns[]` — `GridFieldMetadata.columns`, typed by ' +
      'reference to @objectstack/spec\'s `FieldSchema.inlineColumns`. A sub-field\'s data type, not ' +
      'a node type. objectui#10859 batch 8 retired the bare `date` field-widget fallback, which is ' +
      'the only reason this value used to pass here as a registered key.',
    file:
      'Column type inside a `grid` FIELD\'s `columns[]` — `GridFieldMetadata.columns`, typed by ' +
      'reference to @objectstack/spec\'s `FieldSchema.inlineColumns`. A sub-field\'s data type, not ' +
      'a node type. objectui#10859 batch 8 retired the bare `file` field-widget fallback, which is ' +
      'the only reason this value used to pass here as a registered key.',
    lookup:
      'Column type inside a `grid` FIELD\'s `columns[]` — `GridFieldMetadata.columns`, typed by ' +
      'reference to @objectstack/spec\'s `FieldSchema.inlineColumns`. A sub-field\'s data type, not ' +
      'a node type. objectui#10859 batch 8 retired the bare `lookup` field-widget fallback, which ' +
      'is the only reason this value used to pass here as a registered key.',
    number:
      'Column type inside a `grid` FIELD\'s `columns[]` — `GridFieldMetadata.columns`, typed by ' +
      'reference to @objectstack/spec\'s `FieldSchema.inlineColumns`. A sub-field\'s data type, not ' +
      'a node type. objectui#10859 batch 8 retired the bare `number` field-widget fallback, which ' +
      'is the only reason this value used to pass here as a registered key.',
  },
  'content/docs/fields/location.mdx': {
    location:
      'FIELD type documented by this page: `LocationFieldMetadata` (`FieldMetadata`, ' +
      'packages/types/src/field-types.ts) declares the literal, and the form renders it through ' +
      '`field:location`. Not a node type. objectui#10859 batch 8 retired the bare `location` ' +
      'field-widget fallback, which is the only reason this value used to pass here as a registered ' +
      'key.',
  },
  'content/docs/fields/lookup.mdx': {
    lookup:
      'FIELD type documented by this page: `LookupFieldMetadata` (`FieldMetadata`, ' +
      'packages/types/src/field-types.ts) declares the literal, and the form renders it through ' +
      '`field:lookup`. Not a node type. objectui#10859 batch 8 retired the bare `lookup` ' +
      'field-widget fallback, which is the only reason this value used to pass here as a registered ' +
      'key.',
  },
  'content/docs/fields/number.mdx': {
    number:
      'FIELD type documented by this page: `NumberFieldMetadata` (`FieldMetadata`, ' +
      'packages/types/src/field-types.ts) declares the literal, and the form renders it through ' +
      '`field:number`. Not a node type. objectui#10859 batch 8 retired the bare `number` ' +
      'field-widget fallback, which is the only reason this value used to pass here as a registered ' +
      'key.',
  },
  'content/docs/fields/object.mdx': {
    array:
      'JSON Schema property type inside the `schema` of the page\'s object-level `json_schema` ' +
      'validation rule, not a node type.',
    number:
      'JSON Schema property type inside the `schema` of the page\'s object-level `json_schema` ' +
      'validation rule, the vocabulary the `array` entry of this file already names. Not a node ' +
      'type. objectui#10859 batch 8 retired the bare `number` field-widget fallback, which is the ' +
      'only reason this value used to pass here as a registered key.',
    object:
      'JSON Schema `type` of the document and of a nested property inside the `schema` of the ' +
      'page\'s object-level `json_schema` validation rule, the vocabulary the `array` / `number` ' +
      'entries of this file already name. Not a node type, and since objectui#12242 not the field ' +
      'type either: that is `json`, below. objectui#10859 batch 8 retired the bare `object` ' +
      'field-widget fallback, which is the only reason this value used to pass here as a registered ' +
      'key.',
    json:
      'FIELD type documented by this page: `ObjectFieldMetadata` (`FieldMetadata`, ' +
      'packages/types/src/field-types.ts) declares the literal, the `@objectstack/spec` ' +
      '`FieldType` spelling (objectui#12242), and the form renders it through `field:object`. Not ' +
      'a node type.',
    json_schema:
      'Validation rule type: an entry of an object\'s `validations[]` (`@objectstack/spec`\'s ' +
      '`JSONValidationSchema`), the object-level declaration of a JSON field\'s shape that replaced ' +
      'the field-level `schema` key (objectui#12242). Not a node type.',
  },
  'content/docs/fields/percent.mdx': {
    percent:
      'FIELD type documented by this page: `PercentFieldMetadata` (`FieldMetadata`, ' +
      'packages/types/src/field-types.ts) declares the literal, and the form renders it through ' +
      '`field:percent`. Not a node type. objectui#10859 batch 8 retired the bare `percent` ' +
      'field-widget fallback, which is the only reason this value used to pass here as a registered ' +
      'key.',
  },
  'content/docs/fields/phone.mdx': {
    phone:
      'FIELD type documented by this page: `PhoneFieldMetadata` (`FieldMetadata`, ' +
      'packages/types/src/field-types.ts) declares the literal, and the form renders it through ' +
      '`field:phone`. Not a node type. objectui#10859 batch 8 retired the bare `phone` field-widget ' +
      'fallback, which is the only reason this value used to pass here as a registered key.',
  },
  'content/docs/fields/rich-text.mdx': {
    html:
      'FIELD type documented by this page: `HtmlFieldMetadata` (`FieldMetadata`, ' +
      'packages/types/src/field-types.ts) declares the literal, and the form renders it through ' +
      '`field:html`, whose value displays through the sanitised fields path. Not a node type. ' +
      'objectui#13449 retired the raw-HTML `html` NODE type (`ui:html` and its bare key), which is ' +
      'the only reason this value used to pass here as a registered key.',
    richtext:
      'FIELD type documented by this page: `RichtextFieldMetadata` (`FieldMetadata`, ' +
      'packages/types/src/field-types.ts) declares the literal, and the form renders it through ' +
      '`field:richtext`. Not a node type. objectui#10859 batch 8 retired the bare `richtext` ' +
      'field-widget fallback, which is the only reason this value used to pass here as a registered ' +
      'key.',
  },
  'content/docs/fields/summary.mdx': {
    summary:
      'FIELD type documented by this page: `SummaryFieldMetadata` (`FieldMetadata`, ' +
      'packages/types/src/field-types.ts) declares the literal, and the form renders it through ' +
      '`field:summary`. Not a node type. objectui#10859 batch 8 retired the bare `summary` ' +
      'field-widget fallback, which is the only reason this value used to pass here as a registered ' +
      'key.',
  },
  'content/docs/fields/url.mdx': {
    url:
      'FIELD type documented by this page: `UrlFieldMetadata` (`FieldMetadata`, ' +
      'packages/types/src/field-types.ts) declares the literal, and the form renders it through ' +
      '`field:url`. Not a node type. objectui#10859 batch 8 retired the bare `url` field-widget ' +
      'fallback, which is the only reason this value used to pass here as a registered key.',
  },
  'content/docs/fields/user.mdx': {
    user:
      'FIELD type documented by this page: `UserFieldMetadata` (`FieldMetadata`, ' +
      'packages/types/src/field-types.ts) declares the literal, and the form renders it through ' +
      '`field:user`. Not a node type. objectui#10859 batch 8 retired the bare `user` field-widget ' +
      'fallback, which is the only reason this value used to pass here as a registered key.',
  },
  'content/docs/fields/vector.mdx': {
    vector:
      'FIELD type documented by this page: `VectorFieldMetadata` (`FieldMetadata`, ' +
      'packages/types/src/field-types.ts) declares the literal, and the form renders it through ' +
      '`field:vector`. Not a node type. objectui#10859 batch 8 retired the bare `vector` ' +
      'field-widget fallback, which is the only reason this value used to pass here as a registered ' +
      'key.',
  },
  'content/docs/guide/architecture.md': {
    'my-grid':
      'Deliberate placeholder in the "register your component, then address it by key" contrast — ' +
      'the snippet\'s own line above spells `ComponentRegistry.register(\'my-grid\', MyGrid)`, so it ' +
      'is unregistered in this repository by design.',
    string:
      '`ComponentInput.type` in a `register(...)` call\'s `inputs[]` — a DESIGNER input\'s coarse ' +
      'control kind (packages/types/src/base.ts:386), sibling of `number` / `boolean` / `enum`. ' +
      'Not a node type.',
  },
  'content/docs/guide/building-crud-app.md': {
    date:
      'Object-metadata FIELD type of a field in an object definition\'s `fields` map — a member of ' +
      '`FieldType` (@objectstack/spec/data, `FieldSchema.type`). A field\'s data type, not a node ' +
      'type. objectui#10859 batch 8 retired the bare `date` field-widget fallback, which is the ' +
      'only reason this value used to pass here as a registered key.',
  },
  'content/docs/guide/component-registry.md': {
    custom:
      'Placeholder discriminant in a "type your custom component" `interface CustomSchema extends ' +
      'BaseSchema` declaration — the page is teaching the reader to declare their own schema ' +
      'interface, so the literal is theirs to register.',
    'my-component':
      'Deliberate placeholder in the "register a custom component" walkthrough — the page registers ' +
      'this key itself (`ComponentRegistry.register(\'my-component\', MyComponent, …)`) and then ' +
      'shows the JSON that addresses it.',
    string:
      '`ComponentInput.type` in a `register(...)` call\'s `inputs[]` — a designer input\'s coarse ' +
      'control kind (packages/types/src/base.ts:386), not a node type.',
    boolean:
      '`ComponentInput.type` in the walkthrough\'s `register(...)` call\'s `inputs[]` — a designer ' +
      'input\'s coarse control kind, the vocabulary this file\'s `string` entry names. Not a node ' +
      'type. objectui#10859 batch 8 retired the bare `boolean` field-widget fallback, which is the ' +
      'only reason this value used to pass here as a registered key.',
    number:
      '`ComponentInput.type` in the walkthrough\'s `register(...)` call\'s `inputs[]` — a designer ' +
      'input\'s coarse control kind, the vocabulary this file\'s `string` entry names. Not a node ' +
      'type. objectui#10859 batch 8 retired the bare `number` field-widget fallback, which is the ' +
      'only reason this value used to pass here as a registered key.',
    rating:
      'Deliberate example key: the walkthrough declares its own `RatingSchema` and registers it ' +
      'itself (`ComponentRegistry.register(\'rating\', RatingComponent, …)`), so the reader owns ' +
      'this key. Until objectui#10859 batch 8 it collided with the fields package\'s bare `rating` ' +
      'fallback, now retired; the form\'s rating widget stays `field:rating`.',
  },
  'content/docs/guide/console-architecture.md': {
    delete:
      '`ActionDef.type` passed to `useActionRunner().execute(...)` — a RunnableActionType, the ' +
      'action vocabulary declared at packages/core/src/actions/ActionRunner.ts:112. An action being ' +
      'run, not a node being rendered.',
    object:
      'Navigation item kind under an app\'s `navigation[]` — `NavigationItemType` ' +
      '(packages/types/src/app.ts, from @objectstack/spec\'s `NavigationItemSchema`). An app ' +
      'navigation entry, not a node type. objectui#10859 batch 8 retired the bare `object` ' +
      'field-widget fallback, which is the only reason this value used to pass here as a registered ' +
      'key.',
  },
  'content/docs/guide/dashboard-filters.md': {
    metric:
      'Dashboard widget kind under `widgets[].type` — `metric`, a member of `ChartTypeSchema` ' +
      '(@objectstack/spec/ui) reaching this repo by reference through `DashboardWidgetTypeName`. ' +
      'Not a node type: the node type is `dashboard`, which the enclosing snippet spells. The NODE ' +
      'key the dashboard renders this widget through is `plugin-dashboard:metric`: objectui#10859 ' +
      'batch 8 (phase 2b) moved both dashboard surfaces onto that key and gave the registration ' +
      '`skipFallback: true`, which is the only reason this value used to pass here as a registered ' +
      'key.',
    bar: 'Dashboard widget kind under `widgets[]`, alongside `line` — same vocabulary as the ' +
      'plugins/plugin-dashboard.mdx entry below. Not a node type.',
    line: 'Dashboard widget kind under `widgets[]`, alongside `bar` — same vocabulary as the ' +
      'plugins/plugin-dashboard.mdx entry below. Not a node type.',
  },
  'content/docs/guide/designing-app-navigation.md': {
    object:
      'Navigation item kind under an app\'s `navigation[]` — `NavigationItemType` ' +
      '(packages/types/src/app.ts, from @objectstack/spec\'s `NavigationItemSchema`). An app ' +
      'navigation entry, not a node type. objectui#10859 batch 8 retired the bare `object` ' +
      'field-widget fallback, which is the only reason this value used to pass here as a registered ' +
      'key.',
    url:
      'Navigation item kind under an app\'s `navigation[]` — `NavigationItemType` ' +
      '(packages/types/src/app.ts, from @objectstack/spec\'s `NavigationItemSchema`). An app ' +
      'navigation entry, not a node type. objectui#10859 batch 8 retired the bare `url` ' +
      'field-widget fallback, which is the only reason this value used to pass here as a registered ' +
      'key.',
  },
  'content/docs/guide/fields.md': {
    rating:
      'Form field type in a `form` node\'s `fields[]` — the field vocabulary, which the form ' +
      'resolves through `field:rating`. Not a node type. objectui#10859 batch 8 retired the bare ' +
      '`rating` field-widget fallback, which is the only reason this value used to pass here as a ' +
      'registered key.',
    user:
      'Field metadata handed to a cell renderer (`getCellRenderer(\'user\')`, `field={{ type: ' +
      '\'user\' }}`) — `UserFieldMetadata` (`FieldMetadata`). Not a node type. objectui#10859 batch ' +
      '8 retired the bare `user` field-widget fallback, which is the only reason this value used to ' +
      'pass here as a registered key.',
  },
  'content/docs/guide/objectos-integration.mdx': {
    'my-custom-widget':
      'Deliberate placeholder in the "register a lazy custom widget" walkthrough — the reader ' +
      'supplies this key.',
    currency:
      'Object-metadata FIELD type of a field in an object definition\'s `fields` map — a member of ' +
      '`FieldType` (@objectstack/spec/data, `FieldSchema.type`). A field\'s data type, not a node ' +
      'type. objectui#10859 batch 8 retired the bare `currency` field-widget fallback, which is the ' +
      'only reason this value used to pass here as a registered key.',
  },
  'content/docs/guide/plugin-development.md': {
    array:
      '`ComponentInput.type` in this walkthrough\'s own `register(...)` `inputs[]` — a designer ' +
      'input\'s coarse control kind (packages/types/src/base.ts:386), not a node type.',
    board:
      'The walkthrough\'s OWN plugin key. This page builds `@object-ui/plugin-board` end to end, so ' +
      'every `board` here — the `BoardSchema` interface, the `register(\'board\', BoardRenderer, …)` ' +
      'call, the test fixture and the final JSON — is the key the READER registers by following the ' +
      'page. Unregistered in this repository by design.',
    enum: '`ComponentInput.type` in the walkthrough\'s `inputs[]` — the coarse kind that carries an ' +
      '`enum` list of allowed values, not a node type.',
    string:
      '`ComponentInput.type` in the walkthrough\'s `inputs[]` (packages/types/src/base.ts:386), not ' +
      'a node type.',
  },
  'content/docs/guide/plugins.md': {
    module:
      'The `package.json` manifest\'s OWN `"type": "module"` field — Node\'s ESM switch, in a block ' +
      'showing the plugin package\'s manifest. Not a UI schema at all. objectui#5127 is the same ' +
      'collision measured on `objectui check`, which read every JSON file\'s root `type` as a ' +
      'component key and reported `module` as unknown in any Node project.',
    'my-feature':
      'Deliberate placeholder for the reader\'s own plugin schema — the page\'s `MyFeatureSchema ' +
      'extends BaseSchema` declaration in the "author your plugin\'s types" step.',
  },
  'content/docs/guide/record-edit-modes.md': {
    picklist:
      'ObjectStack object-metadata FIELD type inside a `fields` record, alongside `text` and ' +
      '`lookup` — the picker/lookup family spelling packages/core/src/utils/record-title.ts:101 ' +
      'names explicitly. A field\'s data type, not a node type.',
    lookup:
      'Object-metadata FIELD type of a field in a `fields` record, alongside `text` and `picklist` ' +
      '— a member of `FieldType` (@objectstack/spec/data, `FieldSchema.type`). A field\'s data ' +
      'type, not a node type. objectui#10859 batch 8 retired the bare `lookup` field-widget ' +
      'fallback, which is the only reason this value used to pass here as a registered key.',
  },
  'content/docs/guide/schema-overview.md': {
    action:
      'ActionSchema discriminant in a `const action: ActionSchema = { … }` declaration — this page ' +
      'tours each schema family by declaring one of each, so the literal is the document\'s own ' +
      'discriminant. Same vocabulary as core/enhanced-actions.mdx.',
    group: 'AppSchema menu entry kind — a navigation group holding `children` items, same ' +
      'vocabulary as core/app-schema.mdx.',
    item: 'AppSchema menu entry kind — a navigation item, sibling of `group`. Same vocabulary as ' +
      'core/app-schema.mdx. Not a rendered node.',
    // `block` and `string` also stood here — the `const block: BlockSchema` tour and
    // the `BlockVariable.type` inside its `variables[]`. Both left with the block
    // schema family (objectui#4895): the tour is deleted from that page, so each
    // entry would now fail as `stale-exemption`.
  },
  'content/docs/guide/schema-playground.md': {
    reset:
      'ActionSchema discriminant under a form\'s `actions[]`, alongside `submit` — an action ' +
      'definition in a list, not a rendered child.',
    submit:
      'ActionSchema discriminant under a form\'s `actions[]`, alongside `reset` — an action ' +
      'definition in a list, not a rendered child.',
    // `date` stood here too — a column type under the layout `grid` that page
    // taught as a data table. objectui#5250 slice B rewrote that snippet as the
    // `data-table` it described, whose columns carry no `type`; deleted with its site.
  },
  'content/docs/guide/schema-rendering.md': {
    'admin-panel':
      'Stand-in for one of the READER\'s own registered components in the "move logic to ' +
      'expressions" pattern block, whose subject is `visibleOn` — the two nodes exist to be shown ' +
      'and hidden, and nothing about the pattern depends on which components they are. Weaker than ' +
      'the `my-component` placeholder above it, which the same page registers in its own snippet: ' +
      'these two are never registered on the page, so the name alone does not announce that they ' +
      'are the reader\'s. Recorded here as the disclosed cost of leaving the block\'s subject alone.',
    'my-component':
      'Deliberate placeholder — the snippet\'s own line above spells ' +
      '`ComponentRegistry.register(\'my-component\', MyComponent)`, then shows the schema that ' +
      'addresses it.',
    'user-panel':
      'Stand-in for one of the READER\'s own registered components in the `visibleOn` pattern block, ' +
      'the `${!user.isAdmin}` half of the pair — see the `admin-panel` entry above for the full ' +
      'reason and its known weakness.',
  },
  'content/docs/plugins/index.md': {
    'plugin-component-name':
      'Metasyntactic placeholder in the page\'s "Usage Pattern" template — the block shows the shape ' +
      'every plugin node has and the value stands for whichever plugin key the reader picked from ' +
      'the table above it. Nothing registers the literal string, by design.',
  },
  'content/docs/plugins/plugin-dashboard.mdx': {
    metric:
      'Dashboard widget kind under `widgets[].type` — `metric`, a member of `ChartTypeSchema` ' +
      '(@objectstack/spec/ui) reaching this repo by reference through `DashboardWidgetTypeName`. ' +
      'Not a node type: the node type is `dashboard`, which the enclosing snippet spells. The NODE ' +
      'key the dashboard renders this widget through is `plugin-dashboard:metric`: objectui#10859 ' +
      'batch 8 (phase 2b) moved both dashboard surfaces onto that key and gave the registration ' +
      '`skipFallback: true`, which is the only reason this value used to pass here as a registered ' +
      'key.',
    'metric-card':
      'Dashboard widget-slot entry directly in a `dashboard`\'s `widgets[]` — ' +
      '`DASHBOARD_COMPONENT_WIDGET_TYPES` (`@object-ui/types`\' `complex` module; its TypeScript face ' +
      'is `DashboardWidgetSlotComponentSchema`), the closed ' +
      'component slot of the 2026-08-14 ruling (objectstack#8593). Not a node position: the node ' +
      'type is `dashboard`, which the enclosing snippet spells. This entry also covers the page\'s ' +
      '`metric-card` shape block, which the page introduces as that slot entry, and a ' +
      '`DashboardWidgetSchema` literal typed `metric-card` (the slot set joins the widget type ' +
      'enum). The dashboard hands the entry to the registry as `plugin-dashboard:metric-card`: ' +
      'objectui#10859 batch 8 (phase 2b) gave that registration `skipFallback: true`, which is the ' +
      'only reason this value used to pass here as a registered key.',
    bar: 'Dashboard widget kind under `widgets[]`, alongside `line`. Not a node type.',
    line: 'Dashboard widget kind under `widgets[]`, alongside `bar`. Not a node type.',
  },
  'content/docs/plugins/plugin-detail.mdx': {
    comment: 'FeedItem kind in a `FeedItem[]` literal — `@object-ui/types` activity feed vocabulary.',
    field_change: 'FeedItem kind in a `FeedItem[]` literal — activity feed vocabulary.',
  },
  // `content/docs/plugins/plugin-form.mdx` used to need `minLength` / `maxLength`
  // exempted here, as "ValidationRule discriminants under a field's
  // `validation[]`". Both halves of that reason were fiction (objectui#5118): no
  // `ValidationRule` type exists in this repository, and `validation` is not an
  // array — it is `FieldValidationRules`, an object keyed by rule name, so a
  // rule never carries a `type` discriminant at all. The page now authors the
  // real shape, which spells no `type` there, and the entries went stale.
  'content/docs/plugins/plugin-grid.mdx': {
    count_unique: 'Column summary aggregation under `columns[].summary`, not a node type.',
    multiple:
      'SelectionConfig mode under `selection` — the spec\'s `none` / `single` / `multiple` ' +
      'vocabulary (`SelectionConfigSchema`, @objectstack/spec/ui), not a node type.',
    currency:
      'Column type under an `object-grid` node\'s `columns[]` — the field type a column renders its ' +
      'cells by (`ListColumnSchema.type`, @objectstack/spec/ui). Not a node type. objectui#10859 ' +
      'batch 8 retired the bare `currency` field-widget fallback, which is the only reason this ' +
      'value used to pass here as a registered key.',
    datetime:
      'Column type under an `object-grid` node\'s `columns[]` — the field type a column renders its ' +
      'cells by (`ListColumnSchema.type`, @objectstack/spec/ui). Not a node type. objectui#10859 ' +
      'batch 8 retired the bare `datetime` field-widget fallback, which is the only reason this ' +
      'value used to pass here as a registered key.',
    number:
      'Column type under an `object-grid` node\'s `columns[]` — the field type a column renders its ' +
      'cells by (`ListColumnSchema.type`, @objectstack/spec/ui). Not a node type. objectui#10859 ' +
      'batch 8 retired the bare `number` field-widget fallback, which is the only reason this value ' +
      'used to pass here as a registered key.',
  },
  'content/docs/plugins/plugin-report.mdx': {
    matrix: 'ReportSchema.type kind — a report definition\'s shape, sibling of `joined` / `summary`.',
    joined: 'ReportSchema.type kind — a report definition\'s shape, sibling of `matrix` / `summary`.',
    summary:
      'ReportSchema.type kind — a report definition\'s shape, sibling of `matrix` / `joined` ' +
      '(`ReportSchema`, @objectstack/spec/ui: `tabular` | `summary` | `matrix` | `joined`). Not a ' +
      'node type. objectui#10859 batch 8 retired the bare `summary` field-widget fallback, which is ' +
      'the only reason this value used to pass here as a registered key.',
  },
  'content/docs/utilities/runner.mdx': {
    'my-component':
      'Deliberate placeholder in the "load your own plugin" walkthrough — the reader registers it.',
    'your-component':
      'Deliberate placeholder in the "load your own plugin" walkthrough — the reader registers it.',
  },
  // `content/docs/utilities/vscode-extension.mdx` had two entries here — `ajax`
  // (under a form's `onSubmit`) and `api` (under a `data-table`'s `dataSource`).
  // Both sat in snippets the extension never shipped; objectui#5250 slice B
  // rewrote that section from `packages/vscode-extension/snippets/objectui.json`.
  // Deleted with their sites.

  // ── `packages/NAME/README.md` (objectui#8115) ────────────────────────────────
  //
  // These arrived WITH the fourth leg (`PACKAGE_READMES` above) because the gate
  // admits no other order: an entry whose (file, value) the walk never reaches
  // fails as `stale-exemption`, so none of them could have landed ahead of the
  // walk that reaches it. Ruled one at a time against the source that declares
  // each vocabulary, ⛔ not transcribed as a group from the census that found
  // them — that census's vocabulary column was measured WRONG for
  // `plugin-report`'s `bar` (a chart type, not a report kind) and cited weaker
  // declaration sites than exist for the gesture kinds. ⛔ And two of the sites it
  // counted are deliberately NOT here: they were re-classified as DEFECTS and
  // fixed on their own cards (objectui#8114's `activity-timeline` detail tab,
  // objectui#8483's flow node type `action`). That absence is what the table is
  // worth — it is a record of rulings, ⛔ never a switch for turning a first run
  // of a widened walk green.

  'packages/app-shell/README.md': {
    // TWO vocabularies four lines apart in ONE `flows/renewal_reminder.json`
    // block — the flow DOCUMENT's `type` and its NODES' `type` are different
    // enums. That is the case (file, value) keying exists for: a whole-file
    // exemption here would silence both, and a value-only one would let any page
    // in the tree teach `start` as a component.
    autolaunched:
      'FlowSchema `type` — the flow PROCESS-KIND enum (`autolaunched` / `record_change` / `schedule` ' +
      '/ `screen` / `api`), declared on `FlowSchema` in @objectstack/spec\'s automation flow schema ' +
      'and seeded as this repo\'s canonical default by the metadata-admin flow anchor\'s ' +
      '`createDefaults`. It types the DOCUMENT; the four entries below type the nodes inside it.',
    start:
      'Flow-graph node kind under `nodes[].type` — a member of `FlowNodeAction` (@objectstack/spec\'s ' +
      'automation flow schema). `start` is one of the two STRUCTURAL kinds the engine handles without ' +
      'a registered executor (`FLOW_STRUCTURAL_NODE_TYPES`: the start sentinel and the end ' +
      'terminator), which is why it is a member of the enum while being absent from the editor ' +
      'palette `NODE_PALETTE` in app-shell\'s flow canvas parts. ⚠️ Re-check this entry against the ' +
      'ENUM, not against the palette: absence from BOTH is what made the flow node type `action` a ' +
      'DEFECT rather than an exemption (objectui#8483).',
    decision:
      'Flow-graph node kind under `nodes[].type` — a member of `FlowNodeAction` (@objectstack/spec\'s ' +
      'automation flow schema), and the `Logic` branch node the editor palette `NODE_PALETTE` offers ' +
      'as "Decision". Not a node type in the SDUI sense — a flow graph is data the flow engine ' +
      'executes, not a component tree `SchemaRenderer` walks.',
    notify:
      'Flow-graph node kind under `nodes[].type` — a member of `FlowNodeAction` (@objectstack/spec\'s ' +
      'automation flow schema), offered by `NODE_PALETTE` under `Integration`. Same vocabulary as ' +
      '`decision` above.',
    end:
      'Flow-graph node kind under `nodes[].type` — a member of `FlowNodeAction` (@objectstack/spec\'s ' +
      'automation flow schema) and the second of the two STRUCTURAL kinds (`FLOW_STRUCTURAL_NODE_TYPES`), ' +
      'the terminator `start` above is the sentinel for. Same vocabulary as `decision` above.',
  },
  'packages/data-objectstack/README.md': {
    lookup:
      'Object-metadata FIELD type of a field in a `client.save(\'object\', …)` call\'s `fields` map ' +
      '— a member of `FieldType` (@objectstack/spec/data, `FieldSchema.type`). A field\'s data ' +
      'type, not a node type. objectui#10859 batch 8 retired the bare `lookup` field-widget ' +
      'fallback, which is the only reason this value used to pass here as a registered key.',
  },
  'packages/mobile/README.md': {
    'swipe-left':
      '`useGesture` gesture kind — a member of `GestureType`, the direction-fused touch vocabulary ' +
      'declared in `@object-ui/types`\' `mobile` module, which this package owns outright since ' +
      '@objectstack/spec deleted its `ui/touch` surface (objectui#3363). ⚠️ The census that found ' +
      'this site cited the `useGesture` / `useSpecGesture` hook pair as the declaration; the hooks ' +
      'CONSUME the union, they do not declare it, and the union is the thing to re-check.',
    'swipe-right':
      '`useGesture` gesture kind — a member of `GestureType` (`@object-ui/types`\' `mobile` module). ' +
      'Same vocabulary as `swipe-left` above; the two are separate entries because the table is keyed ' +
      'by value, which is what keeps a ruling about one spelling from covering another.',
    pinch:
      '`useSpecGesture` gesture kind under `SpecGestureConfig.type` — a member of `SpecGestureType`, ' +
      'which is derived from the `SPEC_GESTURE_TYPES` runtime witness in `@object-ui/types`\' `mobile` ' +
      'module. ⚠️ A DIFFERENT union from the `GestureType` above, deliberately kept apart under the ' +
      '`Spec` prefix: it is the retired @objectstack/spec touch vocabulary this package now owns, and ' +
      '`pinch` happens to be a member of both. Two vocabularies sharing one spelling is exactly the ' +
      'coincidence a reader of this entry needs told about.',
  },
  'packages/plugin-dashboard/README.md': {
    metric:
      'Dashboard widget kind under `widgets[].type` — `metric`, a member of `ChartTypeSchema` ' +
      '(@objectstack/spec/ui) reaching this repo by reference through `DashboardWidgetTypeName`. ' +
      'Not a node type: each site sits in a `dashboard`\'s `widgets[]` or is a literal typed ' +
      '`DashboardWidgetSchema` (the dataset-bound JSONC example and the typed literals). The ' +
      'NODE key the dashboard renders this widget through is `plugin-dashboard:metric`: ' +
      'objectui#10859 batch 8 (phase 2b) moved both dashboard surfaces onto that key and gave the ' +
      'registration `skipFallback: true`, which is the only reason this value used to pass here as ' +
      'a registered key.',
    'metric-card':
      'Dashboard widget-slot entry directly in a `dashboard`\'s `widgets[]` — ' +
      '`DASHBOARD_COMPONENT_WIDGET_TYPES` (`@object-ui/types`\' `complex` module; its TypeScript face ' +
      'is `DashboardWidgetSlotComponentSchema`), the closed ' +
      'component slot of the 2026-08-14 ruling (objectstack#8593). Not a node position: the node ' +
      'type is `dashboard`, which the enclosing snippet spells. This entry also covers the legacy ' +
      '`{ id, component, layout }` envelope\'s `component` node, which the dashboard renders through ' +
      'the same key move (`toDashboardNodeType` in `widgetDispatch.ts`), and the ' +
      '`DashboardWidgetSlotComponentSchema` literal. The dashboard hands the entry to the registry ' +
      'as `plugin-dashboard:metric-card`: objectui#10859 batch 8 (phase 2b) gave that registration ' +
      '`skipFallback: true`, which is the only reason this value used to pass here as a registered ' +
      'key.',
    line:
      'Dashboard widget kind under `widgets[].type` — `DashboardWidgetTypeName` (`@object-ui/types`\' ' +
      '`complex` module) declares that CLOSED vocabulary, and its spec half flows in BY REFERENCE ' +
      'from `ChartTypeSchema` (@objectstack/spec/ui), where `line` is a member. Not a node type: the ' +
      'node type is `dashboard`, which the enclosing snippet spells. This entry covers TWO sites in ' +
      'this file — the TypeScript `widgets[]` example and the dataset-bound JSONC one — which is the ' +
      '(file, value) keying doing its job. Same vocabulary as the ' +
      '`content/docs/plugins/plugin-dashboard.mdx` entry above.',
    pie:
      'Dashboard widget kind under `widgets[].type` — a member of `ChartTypeSchema` ' +
      '(@objectstack/spec/ui) reaching this repo by reference through `DashboardWidgetTypeName`. ' +
      'Same vocabulary as `line` above.',
    bar:
      'Dashboard widget kind under `widgets[].type` — a member of `ChartTypeSchema` ' +
      '(@objectstack/spec/ui) reaching this repo by reference through `DashboardWidgetTypeName`. ' +
      'Same vocabulary as `line` above, and ⚠️ NOT the same as `packages/plugin-report/README.md`\'s ' +
      '`bar`, which is a chart type nested under a report section\'s `chart` — one spelling, two ' +
      'carriers, which is why neither is exempted tree-wide.',
  },
  'packages/plugin-gantt/README.md': {
    milestone:
      'Gantt TASK kind under `GanttTask.type` — `GanttTaskType` (`task` / `summary` / `milestone` / ' +
      '`group`), declared beside `GanttTask` in this plugin\'s `GanttView` module and normalised from ' +
      'record data by `normalizeTaskType` in `ObjectGantt`. Not a node type: the node type this ' +
      'plugin registers is `object-gantt`.',
    fs:
      'Dependency LINK kind under `dependencies[].type` — `GanttLinkType` (`fs` / `ss` / `ff` / `sf`, ' +
      'finish-to-start, start-to-start, finish-to-finish, start-to-finish), declared beside ' +
      '`GanttTaskType` in this plugin\'s `GanttView` module and re-declared for the scheduler as ' +
      '`SchedLinkType` in its `scheduling` module. ⚠️ A DIFFERENT vocabulary from the task kind above ' +
      'in the same file — `type` here hangs off a dependency entry, not off a task.',
    ss: 'Dependency LINK kind under `dependencies[].type` — `GanttLinkType` (start-to-start). Same vocabulary as `fs` above.',
    ff: 'Dependency LINK kind under `dependencies[].type` — `GanttLinkType` (finish-to-finish). Same vocabulary as `fs` above.',
    sf: 'Dependency LINK kind under `dependencies[].type` — `GanttLinkType` (start-to-finish). Same vocabulary as `fs` above.',
  },
  'packages/plugin-grid/README.md': {
    multiple:
      'SelectionConfig mode under `selection.type` — the spec\'s `none` / `single` / `multiple` enum ' +
      '(`SelectionConfigSchema`, @objectstack/spec/ui, re-exported as `SelectionConfig` from ' +
      '`@object-ui/types`). Not a node type. This entry covers THREE sites in this file, one per ' +
      'grid example. Same vocabulary as the `content/docs/plugins/plugin-grid.mdx` entry above.',
    count_unique:
      'Column summary aggregation under `columns[].summary.type` — a member of `ColumnSummarySchema` ' +
      '(@objectstack/spec/ui), which `ColumnSummaryConfigSchema` REUSES for the object form so the ' +
      'shorthand (`summary: \'sum\'`) and the object form cannot drift into two vocabularies. This ' +
      'plugin dispatches the value in its `useColumnSummary` hook. Not a node type.',
    currency:
      'Column type under an `object-grid` node\'s `columns[]` — the field type a column renders its ' +
      'cells by (`ListColumnSchema.type`, @objectstack/spec/ui). Not a node type. objectui#10859 ' +
      'batch 8 retired the bare `currency` field-widget fallback, which is the only reason this ' +
      'value used to pass here as a registered key. Same vocabulary as the ' +
      '`content/docs/plugins/plugin-grid.mdx` entry above.',
    datetime:
      'Column type under an `object-grid` node\'s `columns[]` — the field type a column renders its ' +
      'cells by (`ListColumnSchema.type`, @objectstack/spec/ui). Not a node type. objectui#10859 ' +
      'batch 8 retired the bare `datetime` field-widget fallback, which is the only reason this ' +
      'value used to pass here as a registered key. Same vocabulary as the ' +
      '`content/docs/plugins/plugin-grid.mdx` entry above.',
    number:
      'Column type under an `object-grid` node\'s `columns[]` — the field type a column renders its ' +
      'cells by (`ListColumnSchema.type`, @objectstack/spec/ui). Not a node type. objectui#10859 ' +
      'batch 8 retired the bare `number` field-widget fallback, which is the only reason this value ' +
      'used to pass here as a registered key. Same vocabulary as the ' +
      '`content/docs/plugins/plugin-grid.mdx` entry above.',
  },
  'packages/plugin-kanban/README.md': {
    kanban:
      '⚠️ The one entry in this group whose value belongs to the vocabulary this gate JUDGES rather ' +
      'than to another one. It is the bare `kanban` node type key, RETIRED by objectui#8802, spelled ' +
      'deliberately inside a warning comment so a reader who still has it in a document recognises ' +
      'the refusal they will get. The declaration is the tombstone that performs that refusal — ' +
      '`RetiredKanbanNodeSchema`, built by `retiredNodeType(\'kanban\', …)` in `@object-ui/types`\' ' +
      '`zod/complex.zod.ts` — and `object-kanban`, the live key this plugin registers, is spelled in ' +
      'the same fence a few lines below. ⇒ What re-checks this entry is the retirement itself: ' +
      're-register the bare key and the site passes on the registry branch instead, which reports ' +
      'THIS entry as `stale-exemption`.',
  },
  'packages/plugin-report/README.md': {
    matrix:
      'Report kind under `defineReport({ type })` — `SpecReportTypeName` (`tabular` / `summary` / ' +
      '`matrix` / `joined`), declared in `@object-ui/types`\' `spec-report` module. Not a node type: ' +
      'a report definition is metadata the report renderer reads, not a component tree. Same ' +
      'vocabulary as the `content/docs/plugins/plugin-report.mdx` entry above.',
    joined:
      'Report kind under `defineReport({ type })` — `SpecReportTypeName`, sibling of `matrix` above ' +
      'and the one that carries `blocks[]`. Same vocabulary as `matrix`.',
    bar:
      '⚠️ NOT the report-kind vocabulary its two neighbours in this file belong to, and the census ' +
      'that found this site filed it as one. It is a CHART TYPE under a report section\'s ' +
      '`chart.type` — a member of `ChartTypeSchema` (@objectstack/spec/ui) — classified into a ' +
      'rendering plan by `planReportChart` in this plugin\'s `DatasetReportRenderer`. Recorded as a ' +
      'correction rather than inherited: an entry that mis-names its vocabulary sends the next reader ' +
      'to the wrong declaration and cannot be re-checked.',
    currency:
      'Report field data type in a `ReportComponentSchema` `fields[]` entry — `ReportField.type` ' +
      '(packages/types/src/reports.ts). Not a node type. objectui#10859 batch 8 retired the bare ' +
      '`currency` field-widget fallback, which is the only reason this value used to pass here as a ' +
      'registered key.',
    summary:
      'ReportSchema.type kind — a report definition\'s shape (`ReportSchema`, @objectstack/spec/ui: ' +
      '`tabular` | `summary` | `matrix` | `joined`), which `ReportRenderer` dispatches on. Not a ' +
      'node type. Same vocabulary as the `content/docs/plugins/plugin-report.mdx` entry above. ' +
      'objectui#10859 batch 8 retired the bare `summary` field-widget fallback, which is the only ' +
      'reason this value used to pass here as a registered key.',
  },
  'packages/plugin-view/README.md': {
    share:
      'View-action id under `ObjectViewSchema.viewActions[].type` — the union `share` / `settings` / ' +
      '`duplicate` / `delete`, declared inline on that member in `@object-ui/types`\' `objectql` ' +
      'module and mirrored on `ViewSwitcherSchema` in its `views` module. Not a node type. Same ' +
      'vocabulary as the `content/docs/components/complex/view-switcher.mdx` entry above.',
    kanban:
      'ViewSwitcher `views[].type` — the VIEW-TYPE vocabulary (`ViewType`, `@object-ui/types`\' ' +
      '`views` module), which is what a switcher tab names; the nested `schema` on the very same line ' +
      'carries the node type. Needed from objectui#8802, which retired the bare `kanban` NODE type ' +
      'key — until then the value passed by coincidence, the two vocabularies sharing one spelling. ' +
      '⛔ The stored / view-type spelling is deliberately NOT retired (`ObjectView` maps a stored ' +
      '`kanban` view onto the `object-kanban` node type). ⚠️ A DIFFERENT vocabulary from the retired ' +
      'NODE key exempted in `packages/plugin-kanban/README.md`, with which it shares its spelling and ' +
      'nothing else. Same vocabulary as the two `content/docs` entries above.',
    'date-range':
      'Filter control kind under `FilterUISchema.filters[].type` — the union `text` / `number` / ' +
      '`select` / `multi-select` / `date` / `date-range` / `boolean`, declared inline on that member ' +
      'in `@object-ui/types`\' `views` module, alongside the CRUD filter enum that spells ' +
      '`date-picker` / `number-range`. Not a node type. Same vocabulary as the ' +
      '`content/docs/components/complex/filter-ui.mdx` entry above.',
  },
  'packages/types/README.md': {
    'metric-card':
      'Dashboard widget-slot entry directly in a `dashboard`\'s `widgets[]` — ' +
      '`DASHBOARD_COMPONENT_WIDGET_TYPES` (`@object-ui/types`\' `complex` module; its TypeScript face ' +
      'is `DashboardWidgetSlotComponentSchema`), the closed ' +
      'component slot of the 2026-08-14 ruling (objectstack#8593). Not a node position: the node ' +
      'type is `dashboard`, which the snippet\'s `card` helper wraps the entry in. The dashboard ' +
      'hands the entry to the registry as `plugin-dashboard:metric-card`: objectui#10859 batch 8 ' +
      '(phase 2b) gave that registration `skipFallback: true`, which is the only reason this value ' +
      'used to pass here as a registered key.',
  },
};

/**
 * Floors. A refactor that quietly empties any of these walks would satisfy
 * every assertion in this file while comparing nothing, so each input the
 * verdict depends on has a size the tree is known to clear by a wide margin.
 */
const FLOORS = {
  // `files`, not `docFiles`: the counter `scanDocs` publishes is `files`, so the
  // key used to name a counter that has never existed. `undefined < 100` is
  // `false`, so this floor — the one that catches the walk finding NOTHING —
  // silently passed an empty tree for its whole life. Found while adding the key
  // table floors below (objectui#5106); the mis-key is now unspellable, because
  // `analyze` fails on any FLOORS key that names no counter.
  files: 100,
  codeBlocks: 400,
  typeSites: 300,
  registryKeys: 300,
  // objectui#5106. Roughly half of what this tree holds today (4 tables, 24 rows,
  // 45 judged keys), matching the margin the four floors above keep: a floor is a
  // collapse detector, not a ratchet, and one set at today's exact count turns
  // every legitimate docs edit red. What it must catch is the scan silently
  // finding NOTHING — a renamed header, a broken walk, a regex that stopped
  // matching — because zero rows compared against a universe passes while
  // asserting nothing at all, which is the failure this whole surface exists to
  // prevent one level up.
  keyTables: 2,
  keyTableRows: 12,
  keyTableKeys: 20,
};

// ── Source utilities ─────────────────────────────────────────────────────────

/**
 * Blank out `//` and block comments, preserving every byte position and line
 * break so reported line numbers stay true, and return alongside it a mask
 * marking which positions sit INSIDE a string literal.
 *
 * Both faces are needed and for opposite reasons. Comments must go because
 * registrations are quoted verbatim inside JSDoc in several files
 * (`Registry.ts`, `WidgetRegistry.ts`, `layout/src/index.ts`) and a comment is
 * not a registration. String CONTENTS must stay, because that is where the keys
 * are — but a receiver match that begins inside a string is prose, not a call:
 * `packages/core/src/errors/index.ts:27` carries the sentence "Ensure the
 * component is registered via registry.register() before rendering", which
 * matches the receiver pattern and resolves to no key at all.
 */
function stripComments(text) {
  let out = '';
  const inString = new Uint8Array(text.length);
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      for (; i < stop; i++) out += text[i] === '\n' ? '\n' : ' ';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += ch;
      i++;
      while (i < n) {
        inString[i] = 1;
        if (text[i] === '\\') {
          out += text[i] + (text[i + 1] ?? '');
          if (i + 1 < n) inString[i + 1] = 1;
          i += 2;
          continue;
        }
        out += text[i];
        if (text[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return { source: out, inString };
}

/**
 * Return the index just past the `)` matching the `(` at `open`, respecting
 * nested brackets and string literals. Returns -1 when unbalanced.
 */
function spanEnd(text, open) {
  let depth = 0;
  let i = open;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < n && text[i] !== quote) {
        if (text[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return -1;
}

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

function walkFiles(dir, predicate, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

const isTestFile = (rel) =>
  rel.includes(`${sep}__tests__${sep}`) ||
  rel.includes('/__tests__/') ||
  /\.(test|spec)\.[tj]sx?$/.test(rel) ||
  /\.(guard|regression)\.test\./.test(rel);

// ── Registry derivation ──────────────────────────────────────────────────────

/**
 * Resolve the literal names a registration's first argument can take.
 * Returns `null` when the argument is not statically knowable.
 */
function resolveKeyArgument(source, callOpen) {
  const after = source.slice(callOpen + 1);
  const literal = /^\s*(['"])([^'"]*)\1\s*,/.exec(after);
  if (literal) return [literal[2]];

  const identifier = /^\s*([A-Za-z_$][\w$]*)\s*,/.exec(after);
  if (!identifier) return null;
  const name = identifier[1];
  const before = source.slice(0, callOpen);

  // for (const v of ['a', 'b'])
  const inline = [...before.matchAll(new RegExp(`for\\s*\\(\\s*const\\s+${name}\\s+of\\s+\\[([^\\]]*)\\]`, 'g'))].pop();
  if (inline) return [...inline[1].matchAll(/(['"])([^'"]+)\1/g)].map((m) => m[2]);

  // for (const v of ARR)   |   ARR.forEach(v => …)
  const viaArray = [
    ...before.matchAll(
      new RegExp(
        `for\\s*\\(\\s*const\\s+${name}\\s+of\\s+([A-Za-z_$][\\w$]*)|([A-Za-z_$][\\w$]*)\\s*\\.\\s*forEach\\s*\\(\\s*\\(?${name}\\b`,
        'g',
      ),
    ),
  ].pop();
  const arrayName = viaArray && (viaArray[1] || viaArray[2]);
  if (!arrayName) return null;
  const declaration = new RegExp(
    `(?:const|let|var)\\s+${arrayName}\\s*(?::[^=]*)?=\\s*(?:new Set\\()?\\[([\\s\\S]*?)\\]`,
    'm',
  ).exec(source);
  if (!declaration) return null;
  const names = [...declaration[1].matchAll(/(['"])([^'"]+)\1/g)].map((m) => m[2]);
  return names.length ? names : null;
}

/**
 * Split a balanced `(…)` / `{…}` / `[…]` span into its top-level,
 * comma-separated parts, with the outer delimiters dropped. Depth and quotes
 * are tracked, so a comma inside `inputs: [ … ]` or inside a string is not
 * read as a separator.
 */
function topLevelParts(span) {
  const inner = span.slice(1, -1);
  const parts = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  const n = inner.length;
  while (i < n) {
    const ch = inner[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < n && inner[i] !== quote) {
        if (inner[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  parts.push(inner.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

const IDENTIFIER = '[A-Za-z_$][\\w$]*';
const META_SPREAD = new RegExp(`^\\.\\.\\.\\s*(${IDENTIFIER})$`);
const META_ENTRY = new RegExp(`^(?:(${IDENTIFIER})|'([^']*)'|"([^"]*)")\\s*:\\s*([\\s\\S]+)$`);
const STRING_LITERAL = /^(['"])([^'"]*)\1$/;

const escapeForRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Properties of a registration's options that decide which keys it publishes.
 * A write to either of these AFTER the declaration changes the answer, so
 * `declaredObjectBody` refuses a name whose file writes one.
 */
const KEY_BEARING_OPTIONS = 'namespace|skipFallback';

/** Assignment operators, including the logical and compound forms. */
const ASSIGN_OP = '(?:\\?\\?|\\|\\||&&|\\*\\*|<<|>>>|>>|[-+*/%&^|])?=(?!=)';

/**
 * Does this file contain one of THREE SPELLINGS of a write to `name`'s
 * key-bearing options? Returns the reason, or null.
 *
 * ⚠️ Stated as three spellings rather than as "is it written to", because that
 * is all this is (objectui#9641 round 3 measured the difference). What is seen:
 *
 *   1. an assignment whose target is `name` spelled EXACTLY, followed by a
 *      LITERAL `namespace` / `skipFallback` — dotted, or bracketed with a
 *      quoted string. Compound and logical assignment operators included.
 *   2. a `delete` of that same exact-name-plus-literal-property shape.
 *   3. an `Object.assign` whose FIRST argument is `name` spelled exactly.
 *
 * ⛔ NOTHING ELSE IS SEEN, and the difference is silent — no finding is raised,
 * the declaration is read as written, and the run looks certain. A write
 * through an ALIAS of the name, inside a CALLEE the object is passed to, with a
 * COMPUTED property key, as a DESTRUCTURING-assignment target, through
 * `Reflect.set` / `Reflect.deleteProperty` / `Object.defineProperty` /
 * `Object.setPrototypeOf`, or from another module, is invisible here. Each of
 * those is pinned as a KNOWN GAP reading in `check-doc-component-types.test.ts`
 * so that closing one later fails a test rather than passing unnoticed; ⛔ this
 * paragraph is not a to-do list — the ruling on objectui#9641 (batch #150 item
 * 2, letter B) is that the reachable end state for a regex instrument is an
 * accurate declaration of what it cannot see, not a closed set of shapes.
 *
 * ⛔ READ-ONLY member access is not a write and must keep reading — a file that
 * logs or compares `name.namespace` still passes the declared object to
 * `register()`. That is why this looks for an assignment operator, a `delete`
 * or an `Object.assign` TARGET rather than for the property name.
 *
 * ⚠️ It is also POSITION-AGNOSTIC: a write spelled anywhere in the file
 * refuses the name, including one placed after the `register()` call, which the
 * runtime never reached before it read the namespace. That direction is LOUD
 * (a finding on a correct registration), which is why it is left as it is.
 */
function optionsMutatedAfterDeclaration(source, name) {
  const n = escapeForRegExp(name);
  // Spelled out per quote rather than with a backreference: this fragment is
  // embedded in regexes with different group numbering, and a backreference
  // that outruns the group count is read as an OCTAL ESCAPE in JavaScript —
  // it matches a control character, so the bracket form silently never fired.
  const quoted = `(?:'(?:${KEY_BEARING_OPTIONS})'|"(?:${KEY_BEARING_OPTIONS})")`;
  const property = `(?:\\.\\s*(?:${KEY_BEARING_OPTIONS})|\\[\\s*${quoted}\\s*\\])`;
  if (new RegExp(`(?<![\\w$])${n}\\s*${property}\\s*${ASSIGN_OP}`).test(source)) {
    return `\`${name}\` has its \`namespace\` or \`skipFallback\` assigned somewhere in this file`;
  }
  if (new RegExp(`(?<![\\w$])delete\\s+${n}\\s*${property}`).test(source)) {
    return `\`${name}\` has its \`namespace\` or \`skipFallback\` deleted somewhere in this file`;
  }
  if (new RegExp(`(?<![\\w$])Object\\s*\\.\\s*assign\\s*\\(\\s*${n}(?![\\w$])`).test(source)) {
    return `\`${name}\` is the target of an \`Object.assign\`, which can write any option onto it`;
  }
  return null;
}

/**
 * The `{ … }` body of the object literal `name` is declared with in this file,
 * or the reason it must not be followed.
 *
 * ⚠️ Following a name is a PREMISE — that the literal written at the
 * declaration is the object the call passes — and every condition below is one
 * way that premise fails. Each was measured as a defect before it was a
 * condition (objectui#9641 review rounds 1 and 2):
 *
 *   more than one COUNTED      a function-scoped `const` earlier in the file
 *   declaration                shadows the module-level one this call reads, so
 *                              the wrong object answers — a silent MISS. ⚠️ Two
 *                              positions are counted and no others; the
 *                              paragraph below states which.
 *   `let` / `var`              a binding initialised with a namespaced object
 *                              and reassigned to one without it still derived
 *                              the namespaced key. That is a PHANTOM: a key the
 *                              runtime never stores, blessed by the check.
 *   options written after      a `const` cannot be reassigned but its CONTENTS
 *                              can: assigning `meta.namespace`, deleting it, or
 *                              `Object.assign`-ing onto `meta` all move the keys
 *                              the registration publishes while the declaration
 *                              still reads the way it always did. Both
 *                              directions were measured — an added namespace is
 *                              a miss, a deleted one and an added
 *                              `skipFallback` are PHANTOMS.
 *
 * ⭐ The phantom is the worse direction and the reason these are refusals
 * rather than best efforts. A miss refuses a type that renders — expensive,
 * visible, and it argues for itself. A phantom green-lights a spelling that
 * renders NOTHING, and the author finds out in the browser.
 *
 * ⚠️ WHAT THIS DOES NOT GUARD, stated because nothing here enforces it
 * (AGENTS #9), and stated as the COUNT'S OWN RULE rather than as a list of
 * binding kinds, because the list was the over-claim (objectui#9641 round 3).
 *
 * The count sees a name in exactly two positions: IMMEDIATELY AFTER the
 * keyword `const` / `let` / `var`, and inside an import clause. That is all.
 * A name reached any other way is not a binding as far as this is concerned,
 * so the module-level literal answers while the call passes a different
 * object — silently, with no finding. Measured and pinned as KNOWN GAP
 * readings in `check-doc-component-types.test.ts`: a FUNCTION PARAMETER of the
 * same name, a DESTRUCTURING pattern (object or array), a LATER DECLARATOR of
 * the same statement (`const first = 1, name = …`), and a `catch` binding.
 * All four are phantom-direction.
 *
 * Closing any of them needs scope analysis this regex-level derivation does not
 * do. ⛔ That is not a to-do list: the ruling on objectui#9641 (batch #150 item
 * 2, letter B) is that the reachable end state here is an accurate declaration
 * of what the instrument cannot see. The pins exist so that closing one later
 * fails a test rather than passing unnoticed.
 *
 * ⛔ NOTHING re-derives whether a site is shadowed by one of those bindings —
 * that is the gap itself, and no counter here should be read as covering it.
 * What IS re-derived every run is how many sites take the by-reference route at
 * all (`counters.metaViaReference`), which bounds how many sites the gap could
 * reach without saying that any of them is shadowed.
 */
function declaredObjectBody(source, name) {
  const escaped = escapeForRegExp(name);
  const declarations = [
    ...source.matchAll(new RegExp(`(?<![\\w$])(const|let|var)\\s+${escaped}(?![\\w$])`, 'g')),
  ];
  const imported = new RegExp(
    `(?<![\\w$])import\\s[^;]*?(?<![\\w$])${escaped}(?![\\w$])[^;]*?from\\s*['"]`,
  ).test(source);
  const bindings = declarations.length + (imported ? 1 : 0);
  if (bindings === 0) {
    return { body: null, reason: `\`${name}\` is not declared in this file` };
  }
  if (bindings > 1) {
    return {
      body: null,
      reason: `\`${name}\` is bound ${bindings} times in this file, so which binding this call reads depends on scope`,
    };
  }
  if (imported) {
    return { body: null, reason: `\`${name}\` is imported, so the object it names is not in this file` };
  }
  const [declaration] = declarations;
  if (declaration[1] !== 'const') {
    return {
      body: null,
      reason: `\`${name}\` is declared with \`${declaration[1]}\`, so it may hold a different object by the time this call runs`,
    };
  }
  const mutated = optionsMutatedAfterDeclaration(source, name);
  if (mutated) return { body: null, reason: mutated };
  const opener = new RegExp(`^const\\s+${escaped}(?![\\w$])\\s*(?::[^=]*)?=\\s*\\{`).exec(
    source.slice(declaration.index),
  );
  if (!opener) {
    return { body: null, reason: `\`${name}\` is not initialised with an object literal` };
  }
  const open = declaration.index + opener[0].length - 1;
  const end = spanEnd(source, open);
  if (end < 0) return { body: null, reason: `the object literal \`${name}\` is initialised with is unbalanced` };
  return { body: source.slice(open, end), reason: null };
}

/**
 * Read `namespace` / `skipFallback` out of a meta OBJECT BODY, following
 * top-level spreads into the object they spread (objectui#9641).
 *
 * Entries are read in source order, and an entry that SETS one of the two
 * properties replaces whatever an earlier entry set. An entry that does not
 * mention a property leaves the earlier reading standing, which is what a
 * spread of an object without that OWN property does at runtime. So an object
 * that spreads a base and then writes `namespace` carries the written one, and
 * one that writes `namespace` and then spreads a base that has its own
 * `namespace` carries the base's.
 *
 * ⚠️ "Sets" is tracked rather than inferred from the value: `skipFallback:
 * false` arriving by spread must override an earlier explicit `true`, and a
 * truthiness test cannot tell it apart from a spread that never mentions
 * `skipFallback` at all. That was a real MISS of the bare key (objectui#9641
 * round 3), and `skipFallbackSet` is what distinguishes the two.
 *
 * ⚠️ The order claim is about THESE TWO PROPERTIES only, and only for bodies
 * where every entry was recognised — an unrecognised entry raises `unresolved`
 * and the reading it produces is not asserted to be the runtime's.
 *
 * ⚠️ Every entry must be RECOGNISED, not merely searched for a `namespace:`.
 * An entry this cannot read may be the one carrying the namespace, and the
 * whole point of objectui#9641 is that assuming otherwise is silent.
 *
 * `seen` is a RECURSION STACK, not a visited set: a name is released once its
 * body has been read, so a literal that spreads the same base TWICE re-applies
 * it the second time as the runtime does, while a spread still on the stack is
 * a cycle and is skipped. A visited set got that wrong in both directions at
 * once, and silently (objectui#9641 round 3).
 */
function readMetaBody(source, body, seen) {
  let namespace = null;
  let skipFallback = false;
  // Explicit `false` is not the same reading as "never mentioned": a spread
  // carrying `skipFallback: false` must OVERRIDE an earlier explicit `true`,
  // and a truthiness test cannot tell those apart. Tracked, not inferred.
  let skipFallbackSet = false;
  let unresolved = null;
  const refuse = (reason) => {
    unresolved ??= reason;
  };
  for (const entry of topLevelParts(body)) {
    if (entry.startsWith('...')) {
      const spread = META_SPREAD.exec(entry);
      if (!spread) {
        refuse('it spreads something that is not a plain identifier, so the object it spreads cannot be read here');
        continue;
      }
      const name = spread[1];
      // `seen` is a RECURSION STACK, not a visited set: the name is released
      // once its body has been read, so the same base spread twice re-applies
      // the second time, exactly as the runtime re-copies it. Only a spread
      // that is still on the stack is a cycle, and that is what is skipped.
      if (seen.has(name)) continue;
      seen.add(name);
      const { body: nested, reason } = declaredObjectBody(source, name);
      if (!nested) {
        seen.delete(name);
        refuse(reason);
        continue;
      }
      const inherited = readMetaBody(source, nested, seen);
      seen.delete(name);
      if (inherited.namespace) namespace = inherited.namespace;
      if (inherited.skipFallbackSet) {
        skipFallback = inherited.skipFallback;
        skipFallbackSet = true;
      }
      refuse(inherited.unresolved);
      continue;
    }
    const pair = META_ENTRY.exec(entry);
    if (!pair) {
      refuse('it holds an entry that is neither a key-value pair nor a spread of a plain identifier');
      continue;
    }
    const key = pair[1] ?? pair[2] ?? pair[3];
    const value = pair[4].trim();
    if (key === 'namespace') {
      const literal = STRING_LITERAL.exec(value);
      if (!literal) {
        refuse('its `namespace` is not a string literal, so the key it publishes cannot be known here');
        continue;
      }
      namespace = literal[2];
      continue;
    }
    if (key === 'skipFallback') {
      if (value === 'true') {
        skipFallback = true;
        skipFallbackSet = true;
      } else if (value === 'false') {
        skipFallback = false;
        skipFallbackSet = true;
      } else {
        refuse('its `skipFallback` is neither `true` nor `false`, so whether the bare key exists cannot be known here');
      }
    }
  }
  return { namespace, skipFallback, skipFallbackSet, unresolved };
}

/**
 * Resolve the registration options (`namespace`, `skipFallback`) of one
 * `register()` / `registerLazy()` call from its argument span.
 *
 * Two shapes are READ: an object literal whose top-level entries are all
 * key-value pairs or spreads of a plain identifier, and a bare identifier that
 * resolves to such a literal in the same file. `pageMeta.namespace` is `'ui'`,
 * so both of these store `ui:page` / `ui:app` alongside the bare fallbacks:
 *
 *   ComponentRegistry.register('page', PageRenderer, pageMeta)
 *   ComponentRegistry.register('app', PageRenderer, { ...pageMeta, label: 'App Page' })
 *
 * ⛔ EVERY OTHER ARGUMENT SHAPE IS REPORTED, and that is the whole design.
 * ⚠️ Argument shape, not registration shape: once a name is accepted here,
 * whether it names the object the call passes is a premise `declaredObjectBody`
 * enforces only against the spellings it can see, and the readings that slip
 * through are SILENT, not reported. That half is declared and pinned there.
 *
 * Reading only
 * the call span found no `namespace:` in either line above and produced the
 * bare halves ALONE — five real runtime keys missing from a universe whose
 * whole job is to say which keys are real, with no finding raised, so both
 * consumers agreed on a universe neither had measured (objectui#9641). The
 * repair for that cannot itself be a best effort: a cast, a member expression,
 * a call, a spread of any of those, a conditional spread and a computed
 * `namespace` were each measured resolving to a silent bare-only reading, which
 * is the same defect with a different spelling. None of them appears in this
 * tree today, so refusing them costs nothing here and is what lets the
 * regeneration script's header say, truthfully, that a form this cannot resolve
 * fails HERE rather than shrinking the universe there.
 *
 * `viaReference` marks a site whose options were reached through an identifier
 * rather than spelled out at the call, and feeds `counters.metaViaReference`.
 */
function resolveRegistrationOptions(source, span) {
  const parts = topLevelParts(span);
  const bare = { namespace: null, skipFallback: false, unresolved: null, viaReference: false };
  if (parts.length < 3) return bare;
  const meta = parts[2];

  // An options argument spelled `undefined`, `null` or `void 0` is the ABSENCE
  // of options, which `register()` reads exactly as a missing third argument.
  // They match the identifier pattern, so without this they were refused as
  // "not declared in this file" — a red on a correct bare-only registration.
  if (/^(?:undefined|null|void\s+0)$/.test(meta)) return bare;

  if (new RegExp(`^${IDENTIFIER}$`).test(meta)) {
    const { body, reason } = declaredObjectBody(source, meta);
    if (!body) return { ...bare, unresolved: reason, viaReference: true };
    return { ...readMetaBody(source, body, new Set([meta])), viaReference: true };
  }

  if (meta.startsWith('{') && meta.endsWith('}')) {
    const viaReference = topLevelParts(meta).some((entry) => META_SPREAD.test(entry));
    return { ...readMetaBody(source, meta, new Set()), viaReference };
  }

  return {
    ...bare,
    unresolved: 'its options argument is neither an object literal nor a plain identifier',
  };
}

function literalArray(source, name) {
  const m = new RegExp(`(?:const|let|var)\\s+${name}\\s*(?::[^=]*)?=\\s*\\[([\\s\\S]*?)\\n\\];`, 'm').exec(source);
  if (!m) return null;
  return [...m[1].matchAll(/(['"])([^'"]+)\1/g)].map((x) => x[2]);
}

function literalObjectKeys(source, name) {
  const m = new RegExp(`(?:const|let|var)\\s+${name}\\b[\\s\\S]*?=\\s*\\{([\\s\\S]*?)\\n\\};`, 'm').exec(source);
  if (!m) return null;
  return [...m[1].matchAll(/^\s*(['"])([^'"]+)\1\s*:/gm)].map((x) => x[2]);
}

function literalSet(source, name) {
  const m = new RegExp(`(?:const|let|var)\\s+${name}\\s*(?::[^=]*)?=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`, 'm').exec(source);
  if (!m) return new Set();
  return new Set([...m[1].matchAll(/(['"])([^'"]+)\1/g)].map((x) => x[2]));
}

/**
 * The two shapes a collection reaches a registration helper in — a bare array
 * binding and `Object.keys(<object>)` — which are exactly the two readings
 * INDIRECT_REGISTRATIONS' `kind` names. Capture groups, in order: the object of
 * an `Object.keys(…)`, then the bare array.
 */
const COLLECTION_EXPRESSION = `(?:Object\\s*\\.\\s*keys\\s*\\(\\s*(${IDENTIFIER})\\s*\\)|(${IDENTIFIER}))`;

/**
 * The collection a name is bound to by the last binder before `limit`:
 * `for (const NAME of COLL)`, `for (const NAME of Object.keys(COLL))`,
 * `COLL.forEach(NAME => …)` and `Object.keys(COLL).forEach(NAME => …)`.
 *
 * Returns null when no binder in this file supplies the name that way — which
 * is reported by the caller rather than read as "no collection", because a
 * registration whose supplier cannot be named is exactly the one this
 * derivation must not wave through.
 */
function collectionOfBinder(source, name, limit) {
  const pattern = new RegExp(
    `for\\s*\\(\\s*(?:const|let|var)\\s+${name}\\s+of\\s+${COLLECTION_EXPRESSION}` +
      `|${COLLECTION_EXPRESSION}\\s*\\.\\s*forEach\\s*\\(\\s*\\(?\\s*${name}\\b`,
    'g',
  );
  const match = [...source.slice(0, limit).matchAll(pattern)].pop();
  if (!match) return null;
  const object = match[1] ?? match[3];
  const array = match[2] ?? match[4];
  return object ? { name: object, kind: 'object-keys' } : { name: array, kind: 'array' };
}

/**
 * The innermost function declared in this file whose PARAMETER supplies `name`
 * at `index`. This is the second hop these helpers take: a collection is
 * iterated at one place and the registration lives one call deeper, inside the
 * helper the iteration hands each member to.
 */
function enclosingParameterFunction(source, name, index) {
  const declarations = [
    ...source.matchAll(new RegExp(`function\\s+(${IDENTIFIER})\\s*\\(`, 'g')),
    ...source.matchAll(new RegExp(`(?:const|let|var)\\s+(${IDENTIFIER})\\s*(?::[^=]*)?=\\s*(?:async\\s+)?\\(`, 'g')),
  ];
  let best = null;
  for (const declaration of declarations) {
    const open = declaration.index + declaration[0].length - 1;
    const close = spanEnd(source, open);
    if (close < 0 || close > index) continue;
    const params = source.slice(open + 1, close - 1);
    if (!new RegExp(`(?<![\\w$])${name}(?![\\w$])`).test(params)) continue;
    const brace = source.indexOf('{', close - 1);
    if (brace < 0 || brace > index) continue;
    const bodyEnd = spanEnd(source, brace);
    if (bodyEnd <= index) continue;
    if (!best || declaration.index > best.start) {
      best = { name: declaration[1], start: declaration.index, end: bodyEnd };
    }
  }
  return best;
}

/**
 * Which collections supply the keys of ONE collection-keyed registration call.
 *
 * ⭐ This is the half objectui#9717 was filed about. The bypass that lets these
 * calls through used to be keyed by FILE while INDIRECT_REGISTRATIONS' coverage
 * is keyed by COLLECTION, so ANY unresolvable registration living in a
 * table-named file was skipped silently — including one whose collection the
 * table never names. `registerAllFields()`'s `RETIRED_FIELD_TYPES` tombstone
 * loop is the measured instance: it shares a file with the `fieldWidgetMap`
 * entry, so its keys left no trace in the universe and no finding either.
 *
 * So the supplier is DERIVED here and reconciled against the table, the same
 * treatment objectui#9703 gave the namespace. Returns every collection reaching
 * the call, plus an `unresolved` note when some route into it cannot be read —
 * both are returned, because a call fed by one readable and one unreadable
 * collection must neither lose the readable half nor go quiet about the other.
 */
function indirectSupply(source, callOpen) {
  const identifier = /^\s*([A-Za-z_$][\w$]*)\s*,/.exec(source.slice(callOpen + 1));
  if (!identifier) {
    return { collections: [], unresolved: 'its key argument is not a plain identifier' };
  }
  const name = identifier[1];
  const direct = collectionOfBinder(source, name, callOpen);
  if (direct) return { collections: [direct], unresolved: null };

  const fn = enclosingParameterFunction(source, name, callOpen);
  if (!fn) {
    return {
      collections: [],
      unresolved:
        `\`${name}\` is neither bound by a loop over a collection nor a parameter of a function ` +
        'declared in this file',
    };
  }
  const collections = [];
  let unresolved = null;
  const push = (collection) => {
    if (!collections.some((c) => c.name === collection.name && c.kind === collection.kind)) {
      collections.push(collection);
    }
  };
  const passedPattern = new RegExp(`${COLLECTION_EXPRESSION}\\s*\\.\\s*forEach\\s*\\(\\s*${fn.name}\\s*\\)`, 'g');
  for (const passed of source.matchAll(passedPattern)) {
    push(passed[1] ? { name: passed[1], kind: 'object-keys' } : { name: passed[2], kind: 'array' });
  }
  const appliedPattern = new RegExp(`(?<![\\w$.])${fn.name}\\s*\\(([^)]*)\\)`, 'g');
  for (const applied of source.matchAll(appliedPattern)) {
    if (applied.index >= fn.start && applied.index < fn.end) continue;
    const argument = applied[1].trim();
    const bound = /^[A-Za-z_$][\w$]*$/.test(argument) ? collectionOfBinder(source, argument, applied.index) : null;
    if (bound) push(bound);
    else {
      unresolved ??=
        `\`${fn.name}(${argument})\` is called here with an argument this derivation cannot trace ` +
        'back to a collection';
    }
  }
  if (collections.length === 0 && !unresolved) {
    unresolved = `nothing in this file hands \`${fn.name}\` the members of a collection`;
  }
  return { collections, unresolved };
}

/** One INDIRECT_REGISTRATIONS entry's coverage, keyed the way the table is. */
const coverageKey = (site, collection) => `${site} (${collection})`;

/**
 * The tables are injectable for the same reason the sibling gates' are: they are
 * keyed by real repository paths, so a fixture tree can only exercise the
 * MECHANISM if it can supply its own. The defaults are the live tables, which is
 * what every caller outside the test suite wants.
 */
export function deriveRegistryKeys(root, options = {}) {
  const indirect = options.indirectRegistrations ?? INDIRECT_REGISTRATIONS;
  const openRegistrations = options.openRegistrationSites ?? OPEN_REGISTRATION_SITES;
  const keys = new Map();
  const findings = [];
  const counters = { sourceFiles: 0, callSites: 0, resolved: 0, open: 0, indirect: 0, withheld: 0, metaViaReference: 0 };
  const openSeen = new Set();
  const indirectSeen = new Set();
  /** `coverageKey(site, collection)` -> the options read at each call that collection feeds. */
  const indirectCallMeta = new Map();
  /** `<indirect site>` -> the entries the table declares FOR THAT FILE, in table order. */
  const indirectEntriesByFile = new Map();
  for (const entry of indirect) {
    if (!indirectEntriesByFile.has(entry.site)) indirectEntriesByFile.set(entry.site, []);
    indirectEntriesByFile.get(entry.site).push(entry);
  }

  const add = (key, site) => {
    if (!key || key.includes('${')) return;
    if (!keys.has(key)) keys.set(key, []);
    keys.get(key).push(site);
  };

  const receiverPattern = new RegExp(
    `(?<![\\w$])(?:${REGISTRY_RECEIVERS.join('|')})\\s*\\.\\s*(register|registerLazy)\\s*\\(`,
    'g',
  );

  const sourceFiles = [];
  for (const rootDir of SOURCE_ROOTS) {
    const abs = join(root, rootDir);
    walkFiles(abs, (f) => /\.(ts|tsx)$/.test(f) && !isTestFile(relative(root, f)), sourceFiles);
  }

  for (const abs of sourceFiles.sort()) {
    const rel = relative(root, abs).split(sep).join('/');
    const raw = readFileSync(abs, 'utf8');
    if (!/\.register(Lazy)?\s*\(/.test(raw)) continue;
    counters.sourceFiles++;
    const { source, inString } = stripComments(raw);
    receiverPattern.lastIndex = 0;
    let match;
    while ((match = receiverPattern.exec(source))) {
      if (inString[match.index]) continue;
      counters.callSites++;
      const callOpen = match.index + match[0].length - 1;
      const line = lineAt(source, match.index);
      const site = `${rel}:${line}`;
      const names = resolveKeyArgument(source, callOpen);
      if (!names) {
        const entriesHere = indirectEntriesByFile.get(rel);
        if (entriesHere) {
          // The key comes from a collection this file iterates; the collection
          // itself is read below by INDIRECT_REGISTRATIONS. WHICH collection is
          // derived here and matched against the entries declared for this file
          // — the bypass is keyed by COLLECTION, the same thing the table's
          // coverage is keyed by (objectui#9717). Keyed by FILE, as it was, this
          // branch swallowed every unresolvable registration the file happened
          // to hold, whether or not any entry covered it. The NAMESPACE is
          // spelled at this call like any other, so it is read HERE and carried
          // to the loop below, which reconciles the entry's declaration against
          // it instead of trusting it (objectui#9703).
          const supply = indirectSupply(source, callOpen);
          if (supply.unresolved) {
            findings.push({
              reason: 'unresolved-indirect-collection',
              site,
              detail:
                `INDIRECT_REGISTRATIONS names this file, but which collection feeds this ${match[1]}() ` +
                `call could not be read: ${supply.unresolved}. A call this derivation cannot pair with a ` +
                'collection cannot be told apart from one the table does not cover, and reading it as ' +
                'covered is the objectui#9717 defect. Iterate the collection in a form this reads ' +
                '(`COLL.forEach(helper)`, `for (const k of Object.keys(COLL))`), or teach ' +
                '`indirectSupply` the form.',
            });
          }
          const covered = supply.collections.filter((c) => entriesHere.some((e) => e.collection === c.name));
          for (const collection of supply.collections) {
            if (covered.includes(collection)) continue;
            findings.push({
              reason: 'uncovered-indirect-collection',
              site,
              detail:
                `this ${match[1]}() call registers the members of \`${collection.name}\`, which no ` +
                `INDIRECT_REGISTRATIONS entry for this file names (declared here: ` +
                `${entriesHere.map((e) => `\`${e.collection}\``).join(', ')}). Its keys are in the runtime ` +
                'registry and absent from the derived universe, and until objectui#9717 the bypass was ' +
                'keyed by file so nothing said so. Declare the collection in INDIRECT_REGISTRATIONS, or ' +
                'decide deliberately that these keys stay out — but not by silence.',
            });
          }
          if (covered.length > 0) {
            const indirectEnd = spanEnd(source, callOpen);
            const indirectSpan =
              indirectEnd < 0 ? source.slice(callOpen, callOpen + 2000) : source.slice(callOpen, indirectEnd);
            const options = resolveRegistrationOptions(source, indirectSpan);
            for (const collection of covered) {
              const key = coverageKey(rel, collection.name);
              indirectSeen.add(key);
              if (!indirectCallMeta.has(key)) indirectCallMeta.set(key, []);
              indirectCallMeta.get(key).push({ site, namespace: options.namespace, unresolved: options.unresolved });
            }
          }
          continue;
        }
        const open = openRegistrations[rel];
        if (open) {
          counters.open++;
          openSeen.add(rel);
          continue;
        }
        findings.push({
          reason: 'unresolved-registration',
          site,
          detail:
            `the key argument of this ${match[1]}() call is not a string literal and could not be ` +
            'resolved to one. Teach `resolveKeyArgument` this form, or declare the site in ' +
            'OPEN_REGISTRATION_SITES with the reason it cannot be known statically.',
        });
        continue;
      }
      counters.resolved++;
      const end = spanEnd(source, callOpen);
      const span = end < 0 ? source.slice(callOpen, callOpen + 2000) : source.slice(callOpen, end);
      const { namespace, skipFallback, unresolved, viaReference } = resolveRegistrationOptions(source, span);
      if (viaReference && !unresolved) counters.metaViaReference++;
      if (unresolved) {
        findings.push({
          reason: 'unresolved-registration-meta',
          site,
          detail:
            `the options of this ${match[1]}() call cannot be read here: ${unresolved}. A namespaced ` +
            'registration read as bare loses its `namespace:key` half from the universe SILENTLY, which is ' +
            'the objectui#9641 defect — so an options shape this cannot resolve is reported rather than ' +
            'assumed namespace-free. Spell the options out at the call as key-value pairs, declare them in ' +
            'this file as a single `const` object literal, or teach `readMetaBody` this form.',
        });
      }
      for (const name of names) {
        if (namespace) {
          add(`${namespace}:${name}`, site);
          if (!skipFallback) add(name, site);
        } else {
          add(name, site);
        }
      }
    }
  }

  for (const rel of Object.keys(openRegistrations)) {
    if (!openSeen.has(rel)) {
      findings.push({
        reason: 'stale-open-site',
        site: rel,
        detail:
          'OPEN_REGISTRATION_SITES names this file, but no unresolvable registration call was found ' +
          'in it. Re-confirm the site or delete the entry.',
      });
    }
  }

  for (const entry of indirect) {
    if (!indirectSeen.has(coverageKey(entry.site, entry.collection))) {
      findings.push({
        reason: 'stale-indirect-registration',
        site: coverageKey(entry.site, entry.collection),
        detail:
          `INDIRECT_REGISTRATIONS names this file, but no registration in it takes its key from ` +
          `\`${entry.collection}\`. The helper was probably rewritten to register literals, or the ` +
          'iteration moved to another collection; drop the entry so the universe is not padded from a ' +
          'collection nothing reads. ⚠️ This is keyed by COLLECTION, not by file (objectui#9717): a ' +
          'sibling entry still reading the same file no longer answers for this one.',
      });
    }
    const abs = join(root, entry.site);
    let source;
    try {
      source = stripComments(readFileSync(abs, 'utf8')).source;
    } catch {
      findings.push({
        reason: 'stale-indirect-registration',
        site: entry.site,
        detail: 'file named in INDIRECT_REGISTRATIONS no longer exists.',
      });
      continue;
    }
    // A WITHHELD entry declares the registration and declares that its keys stay
    // OUT of the universe (objectui#9717). It is the other legitimate answer to
    // `uncovered-indirect-collection`, and the point of it is that the exclusion
    // becomes a reviewable line with a reason instead of a silence. Its
    // collection is deliberately NOT read: nothing is derived from it, so a read
    // would only invent a way to fail. What keeps it honest is the same
    // staleness check every other entry gets, and that one is derived from the
    // CALL — delete the registration and this entry reports, exclusion or not.
    const withheld = typeof entry.excluded === 'string' && entry.excluded.length > 0;
    const names = withheld
      ? []
      : entry.kind === 'array'
        ? literalArray(source, entry.collection)
        : literalObjectKeys(source, entry.collection);
    if (!withheld && (!names || names.length === 0)) {
      findings.push({
        reason: 'stale-indirect-registration',
        site: `${entry.site} (${entry.collection})`,
        detail:
          `the collection \`${entry.collection}\` no longer resolves to a non-empty list of literal ` +
          'keys. The derivation would silently lose these registrations, so this is reported rather ' +
          'than skipped.',
      });
      continue;
    }
    const skip = entry.skipFallbackSet && !withheld ? literalSet(source, entry.skipFallbackSet) : new Set();
    if (entry.skipFallbackSet && !withheld && skip.size === 0) {
      findings.push({
        reason: 'stale-indirect-registration',
        site: `${entry.site} (${entry.skipFallbackSet})`,
        detail:
          `the skip set \`${entry.skipFallbackSet}\` no longer resolves to a non-empty literal Set. ` +
          'Read as empty, every key of this collection gains a bare fallback it does not really ' +
          'publish — the universe grows SILENTLY, which is the same class as losing one. Re-point ' +
          'the entry at the set the helper reads, or drop `skipFallbackSet` deliberately.',
      });
    }
    // THE NAMESPACE IS DERIVED, NOT DECLARED (objectui#9703). It used to be read
    // out of `entry.namespace` — a hand-kept value that was an INPUT to this
    // derivation with nothing reconciling it against the call it described, so a
    // namespace edit at the call could not reach the universe and the derivation
    // stayed green while disagreeing with the runtime. The call's `namespace:` is
    // a plain string literal at every site this covers, so it is read there and
    // the table's value is demoted to a DECLARATION that must match.
    //
    // ⚠️ `skipFallback` is NOT derivable the same way and deliberately stays
    // declared: these helpers pass it per key (`FIELD_TYPES_SKIP_FALLBACK.has(fieldType)`),
    // so the call carries no answer for any individual key — which is exactly why
    // `skipFallbackSet` names the set instead, and why its emptiness is reported above.
    const calls = indirectCallMeta.get(coverageKey(entry.site, entry.collection)) ?? [];
    const declared = entry.namespace ?? null;
    let namespace = declared;
    const unreadable = calls.filter((c) => c.namespace === null && c.unresolved);
    const observed = [...new Set(calls.filter((c) => !(c.namespace === null && c.unresolved)).map((c) => c.namespace))];
    if (calls.length === 0) {
      // Already reported as `stale-indirect-registration` above — no call of this
      // shape was found in the file at all, so there is nothing to reconcile.
    } else if (unreadable.length > 0) {
      findings.push({
        reason: 'unresolved-indirect-namespace',
        site: unreadable[0].site,
        detail:
          `this call registers the \`${entry.collection}\` collection, and its \`namespace\` could not be ` +
          `read here: ${unreadable[0].unresolved}. Falling back to the value INDIRECT_REGISTRATIONS ` +
          'declares would restore exactly the unreconciled reading objectui#9703 removed, so it is ' +
          'reported instead. Spell `namespace` out as a string literal at the call.',
      });
    } else if (observed.length !== 1) {
      findings.push({
        reason: 'unresolved-indirect-namespace',
        site: entry.site,
        detail:
          `the registrations fed by \`${entry.collection}\` pass ${observed.length} different ` +
          `namespaces (${observed.map((n) => (n === null ? '(bare)' : `\`${n}\``)).join(', ')}), so the ` +
          'namespace of its keys cannot be read from the call. One namespace per collection is what ' +
          'this reconciliation assumes; split the collection, or give its registrations one namespace. ' +
          '⚠️ Since objectui#9717 these are the calls THIS collection feeds, not every collection-keyed ' +
          'call in the file — a sibling collection registering under another namespace no longer reads ' +
          'as a disagreement here.',
      });
    } else {
      namespace = observed[0];
      if (namespace !== declared) {
        findings.push({
          reason: 'indirect-namespace-drift',
          site: entry.site,
          detail:
            `INDIRECT_REGISTRATIONS declares namespace ${declared === null ? '(bare)' : `\`${declared}\``} for ` +
            `\`${entry.collection}\`, but the registration really passes ` +
            `${namespace === null ? '(bare)' : `\`${namespace}\``}. The derived universe follows the CALL; ` +
            'update the entry so the declaration beside it stops describing a tree that moved.',
        });
      }
    }
    if (withheld) {
      // Counted and PRINTED in the run summary rather than left to the table:
      // a key deliberately held out of the universe is a decision, and a
      // decision nobody can see from the gate's own output is back where it
      // started.
      counters.withheld++;
      continue;
    }
    counters.indirect += names.length;
    for (const name of names) {
      // Same shape as a direct call: the namespaced key always, plus the bare
      // fallback unless the helper's skip set holds it. `PROTOCOL_COMPONENTS`
      // entries are ALREADY namespaced strings (`view:grid`, `field:text`), so
      // the bare form there is the spelling the docs actually teach and the
      // `protocol-placeholder:` prefix is the derived one — the reverse of the
      // usual reading, but the same two keys either way.
      if (namespace) {
        add(`${namespace}:${name}`, entry.site);
        if (!skip.has(name)) add(name, entry.site);
      } else {
        add(name, entry.site);
      }
    }
  }

  return { keys, findings, counters };
}

// ── Docs scan ────────────────────────────────────────────────────────────────

/**
 * Collect every `type: '<value>'` / `"type": "<value>"` site inside a fenced
 * code block. Fences are tracked so prose that merely mentions a type in
 * backticks is not read as a snippet.
 *
 * In the SAME walk, collect the rows of every plugin key table — the tables
 * introduced by the objectui#5002 family and anchored by `KEY_TABLE_HEADER`.
 * One walk rather than two because two collectors over one tree is the defect
 * this file's `DOC_EXTENSIONS` note already warns about, one level down: they
 * drift, and a page ends up covered by the surface it passes and invisible to
 * the one it fails.
 *
 * Key tables are read OUTSIDE fences, which is the opposite of the snippet rule
 * and correct for both: a table is prose-level markdown, and a table drawn
 * inside a ``` block is an example OF a table, not a claim about this repo.
 */
export function scanDocs(root) {
  const docsDir = join(root, DOCS_ROOT);
  const isDoc = (f) => DOC_EXTENSIONS.some((ext) => f.endsWith(ext));
  const files = walkFiles(docsDir, isDoc).sort();
  // Per-app docs trees (objectui#6600), appended sorted after the content tree.
  for (const dir of appDocsDirs(root)) files.push(...walkFiles(dir, isDoc).sort());
  // Each package's own README (objectui#7896's fourth leg, landed by objectui#8115),
  // in the slot the two sibling walks append it in — BEFORE the root pages — so the
  // three gates' document lists stay comparable element by element.
  files.push(...packageReadmePages(root));
  // Root pages join by name rather than by walk. An absent one is dropped here so
  // a throwaway fixture tree stays scannable; the CLI refuses to publish a
  // verdict when one is missing from a real run, which is where that must bite.
  files.push(...ROOT_PAGES.map((name) => join(root, name)).filter((abs) => existsSync(abs)));
  const sites = [];
  const tableRows = [];
  const counters = { files: files.length, codeBlocks: 0, typeSites: 0, keyTables: 0, keyTableRows: 0 };

  for (const abs of files) {
    const rel = relative(root, abs).split(sep).join('/');
    const lines = readFileSync(abs, 'utf8').split('\n');
    /** @type {import('./markdown-fence-scan.mjs').OpenFence | null} */
    let open = null;
    let lang = null;
    for (let i = 0; i < lines.length; i++) {
      // ⛔ Never re-spell the fence predicate here. `markdown-fence-scan.mjs` is
      // its one authority, and it is one because the local spelling this line
      // used to hold read a four-backtick opener as a three-backtick fence in a
      // language named with a leading backtick (objectui#9194).
      if (open) {
        if (closesFence(lines[i], open)) {
          open = null;
          lang = null;
          continue;
        }
      } else {
        const opened = openFence(lines[i]);
        if (opened) {
          open = opened;
          lang = opened.lang || 'plaintext';
          counters.codeBlocks++;
          continue;
        }
      }
      if (!open) {
        if (KEY_TABLE_HEADER.test(lines[i]) && TABLE_DELIMITER.test(lines[i + 1] ?? '')) {
          counters.keyTables++;
          const header = i + 1;
          // Consume the body until the table ends. A table ends at the first line
          // that is not a row; markdown needs no terminator, so "not a row" is the
          // only signal there is.
          for (let j = i + 2; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
            const cells = lines[j]
              .split('|')
              .slice(1, -1)
              .map((c) => c.trim());
            counters.keyTableRows++;
            tableRows.push({
              file: rel,
              line: j + 1,
              header,
              namespaced: cells[0] ?? '',
              fallback: cells[1] ?? '',
              text: lines[j].trim(),
            });
            i = j;
          }
        }
        continue;
      }
      for (const m of lines[i].matchAll(/(?:"type"|'type'|(?<![\w$.])type)\s*:\s*(['"])([^'"]*)\1/g)) {
        const value = m[2];
        if (!value) continue;
        counters.typeSites++;
        sites.push({ file: rel, line: i + 1, lang, value, text: lines[i].trim() });
      }
    }
    if (open) {
      // An unclosed fence means the rest of the file was read as code. Report it
      // rather than guessing, because the alternative is a silently truncated scan.
      sites.push({ file: rel, line: lines.length, lang: 'unterminated', value: null, unterminated: true });
    }
  }
  return { sites, tableRows, counters };
}

// ── Verdict ──────────────────────────────────────────────────────────────────

/**
 * Identity of an exemption, for the hit set that decides staleness.
 *
 * `JSON.stringify` rather than a joined string: a separator has to be a byte
 * that cannot occur in either half, and the obvious pick — a control character —
 * is exactly what this repository has now paid for four times (objectstack#4763,
 * #4890, PR #5140 / #5157). One raw control byte makes `grep` treat the whole
 * file as binary: zero matches, no signal, and the next agent greps this gate
 * and finds nothing. A two-element array has no separator to choose.
 */
const exemptionKey = (file, value) => JSON.stringify([file, value]);

export function analyze(root, options = {}) {
  const exemptions = options.exemptions ?? DOC_TYPE_EXEMPTIONS;
  const registry = deriveRegistryKeys(root, options);
  const docs = scanDocs(root);
  const findings = [...registry.findings];
  const counters = {
    ...docs.counters,
    registryKeys: registry.keys.size,
    ...registry.counters,
    registered: 0,
    exempted: 0,
    keyTableKeys: 0,
    keyTableRegistered: 0,
  };

  const exemptionHits = new Map();

  for (const site of docs.sites) {
    if (site.unterminated) {
      findings.push({
        reason: 'unterminated-code-fence',
        site: `${site.file}:${site.line}`,
        detail: 'a code fence is never closed, so the scan cannot tell code from prose in this file.',
      });
      continue;
    }
    if (registry.keys.has(site.value)) {
      counters.registered++;
      continue;
    }
    const reason = exemptions[site.file]?.[site.value];
    if (typeof reason === 'string' && reason.trim().length > 0) {
      counters.exempted++;
      exemptionHits.set(exemptionKey(site.file, site.value), true);
      continue;
    }
    findings.push({
      reason: 'unregistered-doc-type',
      site: `${site.file}:${site.line}`,
      value: site.value,
      lang: site.lang,
      text: site.text,
    });
  }

  // Key-table rows. Judged on BOTH halves and NOT routed through
  // `DOC_TYPE_EXEMPTIONS` — see "The second surface" in the file header for why a
  // row under this header has no other vocabulary it could belong to.
  for (const row of docs.tableRows) {
    const namespaced = BACKTICKED_CELL.exec(row.namespaced);
    if (!namespaced) {
      findings.push({
        reason: 'unreadable-key-table-row',
        site: `${row.file}:${row.line}`,
        detail:
          `the first cell of this row under the key table at :${row.header} is not a single ` +
          'backticked key. Either write it as `namespace:type`, or — if this table does not ' +
          'document registrations — give it a header other than "Namespaced key | Bare-name ' +
          'fallback", which is what tells this gate to judge the rows.',
      });
      continue;
    }
    counters.keyTableKeys++;
    if (registry.keys.has(namespaced[1])) {
      counters.keyTableRegistered++;
    } else {
      findings.push({
        reason: 'unregistered-key-table-key',
        site: `${row.file}:${row.line}`,
        value: namespaced[1],
        half: 'namespaced',
        text: row.text,
      });
    }

    const fallback = BACKTICKED_CELL.exec(row.fallback);
    if (!fallback) {
      // "none — `skipFallback: true`" is the declared no-fallback spelling. The
      // namespaced half above was still judged, which is the half that matters.
      if (!NO_FALLBACK_CELL.test(row.fallback)) {
        findings.push({
          reason: 'unreadable-key-table-row',
          site: `${row.file}:${row.line}`,
          detail:
            'the bare-name fallback cell is neither a single backticked key nor the declared ' +
            '"none — `skipFallback: true`" spelling, so this gate cannot tell whether the row ' +
            'claims a bare key or claims there is none.',
        });
      }
      continue;
    }
    counters.keyTableKeys++;
    if (registry.keys.has(fallback[1])) {
      counters.keyTableRegistered++;
    } else {
      findings.push({
        reason: 'unregistered-key-table-key',
        site: `${row.file}:${row.line}`,
        value: fallback[1],
        half: 'bare fallback',
        text: row.text,
      });
    }
  }

  for (const [file, values] of Object.entries(exemptions)) {
    for (const [value, why] of Object.entries(values)) {
      if (typeof why !== 'string' || why.trim().length === 0) {
        findings.push({
          reason: 'stale-exemption',
          site: `${file} -> ${value}`,
          detail: 'exemption carries no written reason.',
        });
        continue;
      }
      if (!exemptionHits.has(exemptionKey(file, value))) {
        findings.push({
          reason: 'stale-exemption',
          site: `${file} -> ${value}`,
          detail:
            'no code block in that file spells this type any more. Delete the entry, or re-point it ' +
            'at the file that now carries the snippet.',
        });
      }
    }
  }

  return { findings, counters, registryKeys: registry.keys };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const HINTS = {
  'unregistered-doc-type':
    'A documentation code block teaches a `type` that nothing in this repository registers. A reader ' +
    'who copies it gets the renderer\'s red "Unknown component type" panel (OBJUI-001) instead of a ' +
    'component. Either spell the registered key (grep `ComponentRegistry.register(` for the real ' +
    'name), or — if the value belongs to another vocabulary (an action schema, a validation rule, a ' +
    'field data type, a nav item kind) — declare it in DOC_TYPE_EXEMPTIONS with a reason naming that ' +
    'vocabulary. See objectui#4823.',
  'unregistered-key-table-key':
    'A plugin KEY TABLE — a table headed `| Namespaced key | Bare-name fallback | … |` — documents a ' +
    'key that nothing in this repository registers. This table is the canonical way a plugin page ' +
    'states which schema types its entry claims (objectui#5002 family), so a wrong cell here ' +
    'misdocuments the plugin\'s whole public surface. Both halves are judged: the NAMESPACED half ' +
    'against the `namespace:` the registration really passes, and the bare half against the ' +
    'fallback it publishes. If the namespaced half is the one reported, check the `namespace` option ' +
    'in the plugin\'s `ComponentRegistry.register(` call before editing the doc — the registration ' +
    'may be what moved. Unlike a fenced snippet this is NOT exemptible: the header has already ' +
    'declared these rows to be registry keys. See objectui#5106.',
  'unreadable-key-table-row':
    'A row under a key-table header could not be read as a key. Either the row is malformed, or the ' +
    'header `| Namespaced key | Bare-name fallback | … |` is being used for a table that does not ' +
    'document registrations — give that one a different header, since this one is what tells the gate ' +
    'to judge the rows beneath it.',
  'stale-exemption':
    'An entry in DOC_TYPE_EXEMPTIONS no longer matches the tree. Re-point it or delete it — an ' +
    'exemption whose site has gone silently widens the hole for the next snippet that lands there.',
  'unresolved-registration':
    'A ComponentRegistry registration takes a key this derivation cannot resolve to literals. Left ' +
    'unhandled it shrinks the universe, which turns CORRECT documentation red. Teach ' +
    '`resolveKeyArgument` the form, or declare the site in OPEN_REGISTRATION_SITES.',
  'unresolved-registration-meta':
    'A ComponentRegistry registration takes OPTIONS this derivation cannot read — a shape other than ' +
    'an object literal of key-value pairs and plain-identifier spreads, or an identifier that is not a ' +
    'single `const` object literal in the same file. The `namespace` such options may carry decides ' +
    'whether the `namespace:key` half of the registration exists, so reading them as absent drops a ' +
    'real key SILENTLY and `objectui check` then calls a document that renders perfectly unknown. ' +
    'Spell the options out at the call, declare them as one `const` object literal in this file, or ' +
    'teach `readMetaBody` the form. See objectui#9641.',
  'stale-open-site':
    'OPEN_REGISTRATION_SITES names a file that no longer has an unresolvable registration.',
  'stale-indirect-registration':
    'An INDIRECT_REGISTRATIONS entry no longer resolves to keys, so the universe lost them silently — ' +
    'or its declared skip set no longer resolves, which pads the universe with bare fallbacks that are ' +
    'not published. Both directions are silent, so both are reported.',
  'indirect-namespace-drift':
    'An INDIRECT_REGISTRATIONS entry declares a namespace its registration call does not pass. The ' +
    'universe follows the CALL, so nothing is lost — but the declaration beside it now describes a ' +
    'tree that moved, and it is the thing the next reader will trust. Update the entry. See ' +
    'objectui#9703.',
  'uncovered-indirect-collection':
    'A registration in a file INDIRECT_REGISTRATIONS names takes its keys from a collection NO entry ' +
    'names. Those keys are in the runtime registry and missing from the derived universe, which turns ' +
    'CORRECT documentation red. The bypass used to be keyed by FILE while the table\'s coverage is ' +
    'keyed by COLLECTION, so this was skipped in silence — `field:owner`, registered by ' +
    '`registerAllFields()`\'s RETIRED_FIELD_TYPES tombstone loop, is the measured instance. Declare ' +
    'the collection, or decide deliberately that its keys stay out. See objectui#9717.',
  'unresolved-indirect-collection':
    'A registration in a file INDIRECT_REGISTRATIONS names could not be paired with the collection ' +
    'that feeds it. Such a call cannot be told apart from one no entry covers, and reading it as ' +
    'covered restores exactly the file-keyed bypass objectui#9717 removed — so it is reported. Iterate ' +
    'the collection in a form this derivation reads, or teach `indirectSupply` the form.',
  'unresolved-indirect-namespace':
    'A collection-keyed registration\'s `namespace` could not be read at the call, or one file passes ' +
    'several. The namespace of these keys is DERIVED from the call (objectui#9703) precisely so a ' +
    'hand-kept value cannot drift away from it, so an unreadable one is reported rather than taken ' +
    'from the table — taking it from the table is the defect. Spell `namespace` out as a string ' +
    'literal at the call.',
  'unterminated-code-fence':
    'A doc file has an unclosed ``` fence. The scan cannot separate code from prose past that point.',
};

const invokedDirectly = isEntrypoint(import.meta.url);

if (invokedDirectly) {
  const argOf = (name) => {
    const index = process.argv.indexOf(name);
    return index > -1 ? process.argv[index + 1] : null;
  };
  const root = resolve(argOf('--root') ?? resolve(scriptDir, '..'));

  // Checked BEFORE the scan, because a missing root page produces a smaller
  // number rather than an error, and `FLOORS` below cannot tell a shrunken
  // surface from an ordinary docs edit.
  for (const name of ROOT_PAGES) {
    if (!existsSync(resolve(root, name))) {
      console.error(
        `ROOT_PAGES names \`${name}\`, which does not exist under ${root}. That name is part of this ` +
          "gate's scan surface (objectui#7115), so a dangling entry means the surface is quietly " +
          'smaller than this file says it is — which is the whole defect objectui#7115 was filed for. ' +
          'Re-point the entry at the page\'s new path, or remove it deliberately.',
      );
      process.exit(1);
    }
  }

  // Same check, same reason, for the package-README leg (objectui#7896): it is
  // collected by WALK rather than by name, so a `packages/` that stops yielding
  // READMEs does not dangle — it just returns fewer files, and every count this
  // gate prints stays plausible while the surface shrinks back to what
  // objectui#7896 measured. `FLOORS` cannot tell that apart from a docs edit
  // either, because the floor it would trip is a whole-tree one.
  if (packageReadmePages(root).length === 0) {
    console.error(
      `The ${PACKAGE_READMES.dir}/*/${PACKAGE_READMES.name} leg collected 0 file(s) under ${root}. That ` +
        "leg is part of this gate's scan surface (objectui#7896), and a leg that reaches no file is a " +
        'surface that shrank in silence — the defect the widening was filed to close. Point the leg at ' +
        'the tree those READMEs live in, or remove it deliberately.',
    );
    process.exit(1);
  }

  let result;
  try {
    result = analyze(root);
  } catch (error) {
    console.error(
      `❌  ${error.message}\n\n` +
        '    Reported as a failure rather than a pass: this gate decides whether the docs teach types ' +
        'that exist,\n    so losing an input means it cannot decide, and a green verdict would have ' +
        'looked at nothing.',
    );
    process.exit(1);
  }

  const { findings, counters } = result;

  for (const [key, floor] of Object.entries(FLOORS)) {
    // A floor naming a counter that does not exist is not a floor. It compares
    // `undefined`, which is never below anything, so it reads as permanently
    // satisfied — the exact shape that let `docFiles` stand as a dead floor. A
    // collapse detector that can itself collapse is worth less than none, so this
    // is checked before the comparison rather than left to review.
    if (!Object.hasOwn(counters, key)) {
      console.error(
        `FLOORS names \`${key}\`, which is not a counter this scan publishes ` +
          `(${Object.keys(counters).sort().join(', ')}). A floor over a missing counter compares ` +
          '`undefined` and can never fail, so it guards nothing. Fix the spelling or drop the entry.',
      );
      process.exit(1);
    }
    if (counters[key] < floor) {
      console.error(
        `The scan collapsed: ${key} = ${counters[key]}, below the floor of ${floor}. The docs walk or ` +
          'the registry derivation is broken, and an empty comparison would pass while asserting nothing.',
      );
      process.exit(1);
    }
  }

  console.log(
    `Scanned ${counters.files} doc file(s) (${DOC_EXTENSIONS.join(' + ')}), ` +
      `${counters.codeBlocks} code block(s), ` +
      `${counters.typeSites} \`type\` literal(s) against ${counters.registryKeys} registered key(s) ` +
      `derived from ${counters.sourceFiles} source file(s) (${counters.resolved} resolved call site(s), ` +
      `${counters.metaViaReference} via referenced options, ${counters.indirect} indirect, ` +
      `${counters.open} open, ${counters.withheld} collection(s) declared and WITHHELD): ` +
      `${counters.registered} registered, ${counters.exempted} exempted; ` +
      `${counters.keyTables} key table(s), ${counters.keyTableRows} row(s), ` +
      `${counters.keyTableKeys} table key(s) judged (namespaced + bare), ` +
      `${counters.keyTableRegistered} registered.`,
  );

  if (findings.length === 0) {
    console.log('✅  Every documented component type is registered.');
    process.exit(0);
  }

  console.error(`\n❌  ${findings.length} problem(s):\n`);
  for (const finding of findings) {
    if (finding.reason === 'unregistered-doc-type') {
      console.error(`      ${finding.site}  [${finding.reason}]  type '${finding.value}' (${finding.lang})`);
      console.error(`          ${finding.text}`);
      continue;
    }
    if (finding.reason === 'unregistered-key-table-key') {
      console.error(`      ${finding.site}  [${finding.reason}]  ${finding.half} '${finding.value}'`);
      console.error(`          ${finding.text}`);
      continue;
    }
    console.error(`      ${finding.site}  [${finding.reason}]  ${finding.detail}`);
  }
  for (const reason of Object.keys(HINTS)) {
    if (findings.some((f) => f.reason === reason)) console.error(`\n${reason}: ${HINTS[reason]}`);
  }
  console.error(
    '\nThe teaching surface is not rendered by anything, so a wrong type there is invisible to every ' +
      'other check\nin the repo — which is why this is a gate and not a review note. See the header of ' +
      'scripts/check-doc-component-types.mjs (objectui#4823).',
  );
  process.exit(1);
}

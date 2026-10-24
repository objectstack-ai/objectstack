import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here —
// re-adding one is itself an error (TS2578). See objectui#3494.
import { blank, scanSource } from '../js-comment-mask.mjs';

/**
 * ObjectUI — one authority per exported schema name (objectui#6273)
 *
 * ## The ruling this enforces
 *
 * The 2026-08-25 maintainer family ruling (decision 甲/A1 on objectui#6172,
 * verbatim acceptance 「同意」): **every exported schema name has exactly one
 * authority.** objectui#6172 (`FormField`, `MarkdownSchema`, `KanbanSchema`),
 * objectui#6155 (`KanbanCard` ×4) and objectui#6086 are the same defect
 * measured four times — one name, two structurally different declarations, and
 * an IDE auto-import that picks between them by alphabetical order. The wrong
 * pick does not surface as "you imported from the wrong package"; it surfaces
 * as a remote `TS2322` several lines away, which is what
 * `packages/plugin-calendar/src/__tests__/name-collision-5044.test.ts` records
 * for `CalendarEvent`.
 *
 * The cleanup cards fix instances. This file is the recurrence guard the
 * ruling ordered: it re-derives the collision set from source on every test
 * run, so the class cannot silently regrow after they land.
 *
 * ## What counts as an AUTHORITY, and what deliberately does not
 *
 * An authority is a site that gives an exported name its meaning. Two of them
 * in two different files means two meanings for one published name.
 *
 *   - **A declaration** — `export interface X`, `export type X`,
 *     `export enum X` (and their `declare` / `const enum` spellings). This is
 *     the shape every card in the family measured.
 *   - **An aliasing re-export that PUBLISHES a name** —
 *     `export type { A as X } from './a'`. It is not a declaration, but it
 *     puts a second meaning behind the name `X`, which is what the ruling is
 *     about. `packages/plugin-calendar/src/index.tsx` is today's live
 *     instance: it publishes the runtime `CalendarViewEvent` as
 *     `CalendarEvent`, a name `@object-ui/types` already declares.
 *
 * ⛔ **A deliberate re-export is NOT an authority.** `export { X } from './x'`,
 * `export type { X } from './x'`, `export * from './x'` and
 * `export * as ns from './x'` are ONE declaration with many export sites —
 * exactly how this monorepo is meant to fan a type out through barrels. A gate
 * that counted those would red on every package's `src/index.ts`, and an
 * assertion that reds on legitimate code gets deleted by the first person who
 * hits it, which puts the claim back where it started. `X as X` is a plain
 * re-export spelled long, and is skipped for the same reason.
 *
 * ⛔ **Near-spellings and derived names are NOT collisions.** The matcher
 * anchors the name on both ends, so `ConditionalFormattingRule` does not match
 * `KanbanConditionalFormattingRule` (declared in `packages/types/src/objectql.ts`,
 * next to the bare name) or `KanbanNativeConditionalFormattingRule` — a
 * derived name this repository declared there until objectui#11522 retired it,
 * kept below as a synthetic near-spelling.
 *
 * ## Two stated bounds, because a claim must be bounded or derivable
 *
 * (The 2026-08-25 batch-adjudication close-out, decision B1.)
 *
 *  1. **Type-level names only.** `export const`, `export function` and
 *     `export class` are out. The ruling's subject is the schema/type
 *     vocabulary, and the value namespace is a different population with a
 *     different remedy — 66 exported classes and every exported helper would
 *     arrive as noise the same run. Narrowing the claim and narrowing the
 *     population is one change; ⛔ never narrow one alone.
 *  2. **Alias sites are counted only where the alias is TYPE-marked** —
 *     `export type { A as X }` or `export { type A as X }`. This is lossless
 *     rather than a heuristic: the root `tsconfig.json` sets
 *     `"isolatedModules": true` and every package extends it, so a type
 *     re-export MUST carry the `type` marker to compile at all. (This
 *     named the tier base instead until objectui#9330 measured that no
 *     package extends that file — the option is repo-wide all the same,
 *     it just comes from the root config.) It also keeps a VALUE alias
 *     (`export { helper as Grid }`) from reddening against an unrelated
 *     `interface Grid` in the type namespace.
 *
 * A collision additionally requires at least one real DECLARATION among the
 * sites: two aliases publishing one name, with nothing declaring it, is a
 * different (and today empty) shape and is not what the ruling measured.
 *
 * ## ONE mask, and why — this differs from the sibling gate on purpose
 *
 * `scripts/__tests__/unconsumed-widget-option-claim-6186.test.ts` needs TWO
 * masks, because a computed access spells its key AS a string literal
 * (`x['thresholds']`) and blanking literals would erase the thing it looks
 * for. Nothing here has that property: a declaration and an export clause are
 * both CODE in every spelling they have, so this scan reads source with
 * comments AND string literals blanked, and there is no leg that needs
 * literals to survive. That single mask is what lets this file scan a
 * population containing `packages/create-plugin/src/templates.ts`, which
 * writes `export interface ${'$'}{vars.pascalName}Schema extends BaseSchema {`
 * inside a template literal (:417) — content, not a declaration — without
 * reddening on it.
 *
 * It is also the answer to the failure the sibling gate hit the moment it was
 * committed: **it reddened on its own source**, because a tracked-files
 * population first contained its own fixture table. The discriminator here is
 * real rather than a filename exemption, and it is proved twice below:
 * `authoritySites` is run over THIS FILE's own bytes and must find nothing
 * (masking alone is sufficient), and the population is bounded to the
 * published packages' `src/` because that is what the claim is about —
 * `scripts/` publishes nothing.
 *
 * ## What the instrument cannot see — read before trusting a verdict
 *
 *   - **A name assembled at runtime.** This is a text scan; nothing textual
 *     can see a type produced by a mapped/conditional type or a generated
 *     `.d.ts`. Generated output is untracked, so it is out by construction.
 *   - **Whether the two shapes actually disagree.** The card asks for
 *     "declared more than once with disagreeing shapes"; this gate answers
 *     "declared more than once", which is the decidable half. Structural
 *     comparison across two packages needs the type checker, and a name with
 *     two AGREEING declarations is still two authorities that drift
 *     independently — so the stricter reading is also the correct one.
 *   - **Whether a colliding name is reachable from its package's public
 *     entry.** The export graph is not walked. That over-includes a
 *     module-local `export interface` — deliberately, because the family cards
 *     counted exactly that way: objectui#6155's `KanbanCard ×4` includes
 *     `KanbanEnhanced.tsx` and `KanbanImpl.tsx`, neither of which is a barrel.
 *     Population and claim have to stay co-extensive with the cards they guard.
 *
 * ## The baseline is a RATCHET, in both directions
 *
 * `KNOWN_COLLISIONS` is today's measured population, named site by site,
 * taken on `79ebf30d1`. The card allows landing with it and requires it to
 * SHRINK as objectui#6172 / #6169 / #6170 / #6155 land; ⛔ silently exempting
 * these forever is not allowed, so the reconciliation below fails in BOTH
 * directions — a new name or a new site is fresh debt, and a listed site that
 * no longer collides is a stale entry that must be deleted in the same PR that
 * cleaned it. Without that second direction a baseline degrades into a
 * skip-list nobody dares touch (`scripts/check-skills-paths.mjs` and
 * `scripts/check-doc-fence-languages.mjs` carry the same rule).
 *
 * ⛔ Adding a line is not a supported way to make this pass.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ── Population ───────────────────────────────────────────────────────────────

/**
 * The published packages, DERIVED from their manifests rather than listed, so
 * a new package joins the population by existing. `private: true` is what
 * "not published" means to pnpm and to the release pipeline, and it is what
 * takes `@object-ui/test-support` and the VS Code extension out.
 */
function publishedPackageDirs(root: string): string[] {
  const packagesDir = path.join(root, 'packages');
  return fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => {
      const manifest = path.join(packagesDir, name, 'package.json');
      if (!fs.existsSync(manifest)) return false;
      return JSON.parse(fs.readFileSync(manifest, 'utf8')).private !== true;
    })
    .sort();
}

const SOURCE_SUFFIX = /\.(?:[cm]?ts|tsx)$/;

/**
 * Tests, specs and stories declare throwaway types that are never published,
 * and they quote real declarations as fixture text on purpose (three sites do
 * it today — see the negative controls). They are out of the POPULATION; they
 * are still fair game as matcher fixtures.
 */
const NOT_PUBLISHED_SOURCE = /(?:^|\/)__tests__\/|\.(?:test|spec|stories)\.[cm]?tsx?$/;

/**
 * Every tracked TypeScript file under a published package's `src/`.
 *
 * Derived from the same configuration the repo's other whole-tree gates read —
 * `node_modules`, `dist` and every build output are untracked, so they are out
 * by construction. `scripts/check-control-bytes.mjs` reads this repository the
 * same way.
 */
function populationFiles(root: string, published: readonly string[]): string[] {
  const inScope = new Set(published);
  return execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean)
    .filter((rel) => {
      const owner = /^packages\/([^/]+)\/src\//.exec(rel);
      return (
        owner !== null &&
        inScope.has(owner[1]) &&
        SOURCE_SUFFIX.test(rel) &&
        !NOT_PUBLISHED_SOURCE.test(rel)
      );
    })
    .sort();
}

// ── The matcher ──────────────────────────────────────────────────────────────

/**
 * Comment- and literal-blanked source — the repo's ONE answer to "is this span
 * code, or prose?" (`scripts/js-comment-mask.mjs`). Masking only ever REMOVES
 * text, so a site found in the masked code implies the raw file carries it.
 * Regex literals and `${...}` interpolations are flagged literal too, which is
 * what keeps this file's own patterns out of its own scan.
 */
function codeOnly(source: string): string {
  const { comment, literal } = scanSource(source);
  const flags = new Uint8Array(source.length);
  for (let i = 0; i < source.length; i++) flags[i] = comment[i] || literal[i];
  return blank(source, flags);
}

type SiteKind = 'declaration' | 'alias';

interface Site {
  readonly name: string;
  readonly kind: SiteKind;
  /** Human-readable, for the diagnostic. */
  readonly what: string;
  readonly index: number;
}

/**
 * A type-level declaration. The trailing identifier group is what separates
 * `export type X = …` (a declaration) from `export type { X } from './x'` and
 * `export type * from './x'` (re-exports, which open with `{` or `*` and
 * therefore cannot match).
 */
const DECLARATION =
  /(?<![\w$])export\s+(?:declare\s+)?(?:const\s+)?(interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;

/** `export { … }` / `export type { … }`. Group 1 marks a type-only clause. */
const EXPORT_CLAUSE = /(?<![\w$])export\s+(type\s+)?\{([^}]*)\}/g;

/** One `A as B` specifier, with the inline `type` marker if it carries one. */
const ALIAS_SPECIFIER = /^\s*(type\s+)?([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)\s*$/;

/** Every site in `source` that gives an exported type-level name its meaning. */
function authoritySites(source: string): Site[] {
  const code = codeOnly(source);
  const sites: Site[] = [];

  for (const match of code.matchAll(DECLARATION)) {
    sites.push({
      name: match[2],
      kind: 'declaration',
      what: `${match[1]} declaration`,
      index: match.index ?? 0,
    });
  }

  for (const match of code.matchAll(EXPORT_CLAUSE)) {
    const clauseIsTypeOnly = Boolean(match[1]);
    for (const specifier of match[2].split(',')) {
      const alias = ALIAS_SPECIFIER.exec(specifier);
      if (alias === null) continue;
      const [, inlineTypeMarker, from, to] = alias;
      // `X as X` is a plain re-export spelled long — one declaration, one more
      // export site, no new meaning.
      if (from === to) continue;
      // Bound 2: only a TYPE-marked alias publishes into the type namespace,
      // and `isolatedModules` makes the marker mandatory.
      if (!clauseIsTypeOnly && !inlineTypeMarker) continue;
      sites.push({
        name: to,
        kind: 'alias',
        what: `aliasing re-export \`${from} as ${to}\``,
        index: match.index ?? 0,
      });
    }
  }

  return sites;
}

interface Located extends Site {
  readonly rel: string;
  readonly line: number;
}

interface Document {
  readonly rel: string;
  readonly source: string;
}

/**
 * Names carrying an authority in TWO OR MORE files, at least one of which is a
 * real declaration.
 *
 * Distinct FILES, not distinct sites: two `export interface X` in one file is
 * TypeScript declaration merging — legal, one authority, one file's business.
 * Two `export type X` in one file is a compile error `tsc` already owns.
 */
function collisions(corpus: readonly Document[]): Map<string, Located[]> {
  const byName = new Map<string, Located[]>();
  for (const { rel, source } of corpus) {
    for (const site of authoritySites(source)) {
      const line = source.slice(0, site.index).split('\n').length;
      const bucket = byName.get(site.name);
      if (bucket) bucket.push({ ...site, rel, line });
      else byName.set(site.name, [{ ...site, rel, line }]);
    }
  }

  const colliding = new Map<string, Located[]>();
  for (const [name, sites] of byName) {
    if (new Set(sites.map((site) => site.rel)).size < 2) continue;
    if (!sites.some((site) => site.kind === 'declaration')) continue;
    colliding.set(
      name,
      [...sites].sort((a, b) => (a.rel === b.rel ? a.line - b.line : a.rel < b.rel ? -1 : 1)),
    );
  }
  return new Map([...colliding].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

const filesOf = (sites: readonly Located[]): string[] => [
  ...new Set(sites.map((site) => site.rel)),
];

// ── The baseline ─────────────────────────────────────────────────────────────

/**
 * ⛔ SHRINK-ONLY. `name -> the files that carry an authority for it`, measured
 * on `79ebf30d1` (2026-08-25): 46 names.
 *
 * Every line is debt the 2026-08-25 family ruling ordered cleaned. The remedy
 * is the same for all of them and no entry records a judgement anyone has to
 * re-make: pick the ONE authority, delete or re-point the others, and delete
 * the line here in the same PR. objectui#6172 / #6169 / #6170 / #6155 are the
 * batches. `FormField`, which objectui#6172 named, is already gone from this
 * table — it had a single declaration when this was measured.
 *
 * ⚠️ `CalendarEvent` is the one entry whose second authority is an ALIAS
 * rather than a declaration (`packages/plugin-calendar/src/index.tsx` publishes
 * `CalendarViewEvent as CalendarEvent`). It is a deliberate, ruled-on
 * deprecation shim — the 2026-08-19 maintainer ruling on objectui#5044, option
 * A — and it is listed rather than exempted because the alias is still a second
 * meaning behind the name and the ruling that put it there also said it comes
 * off. It is also this table's proof that the alias leg is not vacuous on the
 * real tree.
 */
const KNOWN_COLLISIONS: ReadonlyMap<string, readonly string[]> = new Map([
  // `ActionContext` sat here, colliding between
  // `packages/core/src/actions/ActionRunner.ts` and `packages/types/src/ui-action.ts`.
  // One concept (the runner's execution data bag) whose copies had drifted on
  // three members: `data` existed only on the runner's copy, and `record` /
  // `user` were `any` there and `Record<string, any>` in `@object-ui/types`.
  // `@object-ui/types` is the one authority — it gained `data`, kept the
  // narrower `record` / `user` — and `ActionRunner.ts` now RE-EXPORTS it
  // (objectui#6349, batch 4).
  // `ActionResult` sat here too, same pair of files. One concept (what a
  // handler returns and the runner reads), but the runner's copy carried five
  // members the `@object-ui/types` copy lacked — `reload`, `redirect`, `modal`,
  // `silent` and `undo` — and the types copy carried a `refresh` nothing read
  // or wrote. `@object-ui/types` is the one authority: it took the runner's
  // members, `refresh` was retired, and `UndoableOperation` (which types `undo`)
  // moved down beside it, so `ActionRunner.ts` and `UndoManager.ts` both
  // RE-EXPORT (objectui#6349, batch 4).
  // `AggregationConfig` sat here, colliding between
  // `packages/plugin-grid/src/useGroupedData.ts` and
  // `packages/types/src/data-protocol.ts`. Two meanings that share only `field`:
  // `@object-ui/types`' is the query-AST aggregation `DriverQueryConfig` carries
  // (`function`, `alias`, `distinct`, `separator`) and `@object-ui/core`'s
  // `QueryASTBuilder` compiles; the grid's is one per-group header aggregation
  // (`field`, `type`). RENAME branch: the general name stays on
  // `@object-ui/types`, and the grid's declaration now spells
  // `GroupAggregationConfig` (objectui#6349, batch 7).
  // `AppShellProps` sat here, colliding between `packages/app-shell/src/types.ts`
  // and `packages/layout/src/AppShell.tsx`. Two components, not one drifted
  // shape: app-shell's is the props of its minimal `AppShell` container
  // (`header` and `footer` slots, no routing) and layout's the props of the
  // sidebar shell the console's `ConsoleLayout` composes (`navbar`,
  // `defaultOpen`, `branding`, `rightRail`). app-shell depends on layout, but
  // re-pointing its name at layout's does not compile. RENAME branch: app-shell's
  // declaration now spells `MinimalAppShellProps`, and the app-shell root
  // publishes that name instead; layout is the one authority. The two `AppShell`
  // components keep their names — value names are outside this gate's bound
  // (objectui#6349, batch 9).
  // `ActionSchema` sat here, colliding between `packages/types/src/crud.ts` and
  // `packages/types/src/ui-action.ts`. Structurally unrelated types — 28 members
  // each, 9 shared, `type` the literal `'action'` there and `ActionType` here — so
  // the remedy was the RENAME branch: ui-action's declaration now spells
  // `UIActionSchema`, the name `src/index.ts` always published it under
  // (objectui#6349). `BreadcrumbItem` / `BreadcrumbSchema` sat here too, colliding
  // between `packages/types/src/data-display.ts` and
  // `packages/types/src/navigation.ts`; data-display's were a strict SUBSET copy, so
  // that file re-points at navigation's one authority.
  ['CalendarEvent', ['packages/plugin-calendar/src/index.tsx', 'packages/types/src/complex.ts']], // the ruled-on objectui#5044 alias — see the header
  // `CalendarSchema` sat here, colliding between
  // `packages/plugin-calendar/src/ObjectCalendar.tsx` and
  // `packages/types/src/form.ts`. Two unrelated meanings behind one word: the
  // plugin's was the calendar VIEW's props schema, `@object-ui/types`' is the
  // date-picker primitive reachable at `ui:calendar` only (objectui#8499). The
  // remedy was the DELETE branch — the plugin-local one was absent from that
  // package's barrel, so no importer could name it, and objectui#8651 measured
  // that `ObjectCalendar`'s props belong at the published `ObjectCalendarSchema`
  // instead. One authority remains, in `@object-ui/types`.
  // `ChatMessage` / `ChatToolInvocation` sat here, colliding between
  // `packages/plugin-chatbot/src/ChatbotEnhanced.tsx` and
  // `packages/types/src/complex.ts`. Two meanings, not drift: `@object-ui/types`
  // declares the JSON/SDUI AUTHORING contract (`role` admits `'tool'`, the
  // legacy tool states, no approval states — objectui#10018) and the plugin the
  // RUNTIME shape `<ChatbotEnhanced>` renders (the approval states plus the
  // render-only keys), and `toRuntimeMessages` converts one into the other.
  // RENAME branch: the runtime declarations now spell `ChatbotEnhancedMessage` /
  // `ChatbotEnhancedToolInvocation`, the names the plugin root already published
  // them under, and the plugin root no longer publishes a `ChatMessage` at all
  // (objectui#6349, batch 5).
  // `ComboboxOption` sat here, colliding between
  // `packages/components/src/custom/combobox.tsx` and `packages/types/src/form.ts`.
  // The component's copy was a strict SUBSET (`value`, `label`; the types copy
  // adds `disabled?`), so the component re-points at the one authority in
  // `@object-ui/types` — through the `./form` subpath, since the root barrel
  // does not publish the name (objectui#6349).
  // `ComponentConfig` sat here, colliding between
  // `packages/core/src/registry/Registry.ts` and `packages/types/src/base.ts`.
  // objectui#6298 made `@object-ui/types` the one authority — it gained the
  // defaulted type parameter that was the last real difference between the two
  // — and `Registry.ts` now RE-EXPORTS it, which this gate does not count. The
  // entry would fail the stale-baseline direction.
  //
  // `ComponentMeta` sat here too, same pair of files. PR #6297 converged its
  // SHAPE (`CanonicalComponentMeta & RegistryComponentMetaExtras`) but left a
  // declaration in `Registry.ts`, and a derived declaration is still an
  // authority — which is why #6298 took the re-export route for
  // `ComponentConfig`. The two were different MEANINGS (registration metadata =
  // the general metadata plus five registry-only keys), so the remedy was the
  // RENAME branch: `Registry.ts` declares `RegistryComponentMeta` and
  // re-exports `@object-ui/types`' `ComponentMeta` (objectui#6349, batch 4).
  // `ConditionalFormattingRule` sat here. Its THIRD site,
  // `packages/plugin-kanban/src/KanbanEnhanced.tsx`, left the tree when
  // objectui#8932 deleted that module; the other two were
  // `packages/plugin-kanban/src/KanbanImpl.tsx` and `packages/types/src/objectql.ts`.
  // The board's was an ALIAS of `@object-ui/types`' `KanbanConditionalFormattingRule`,
  // the object-kanban rule, behind the name the grid's and list view's rule carries
  // — the two differ by the retired `expression` key. No package entry reached the
  // alias, so the remedy was the DELETE branch: the board spells the kanban rule
  // by its own name (objectui#6349, batch 7).
  // `ConfirmDialogState` sat here, colliding between
  // `packages/app-shell/src/views/ActionConfirmDialog.tsx` and
  // `packages/plugin-designer/src/hooks/useConfirmDialog.ts`. Two meanings that
  // share only `message`: app-shell's is the DATA its action-confirm dialog
  // renders (`open`, `options`, the promise's `resolve`), the designer's is a
  // hook RESULT (`isOpen`, `title` and the `confirm` / `onConfirm` / `onCancel`
  // functions). Neither package's built entry exports the name. RENAME branch:
  // the designer's declaration now spells `DesignerConfirmDialogState`
  // (objectui#6349, batch 6).
  // `ConnectionState` sat here, colliding between
  // `packages/collaboration/src/useRealtimeSubscription.ts` and
  // `packages/data-objectstack/src/index.ts`. One vocabulary declared twice:
  // the same five states, type-equal on both built entries — the realtime
  // socket's state and the data adapter's. Neither package depends on the
  // other, so neither could re-point at the other without a new dependency.
  // Both depend on `@object-ui/types`, so the ONE declaration moved down there
  // (`data.ts`, beside `DataSource`) and both sites now RE-EXPORT it; both
  // package roots still publish the name (objectui#6349, batch 10).
  // `DataSource` sat here, colliding between `packages/app-shell/src/types.ts`
  // and `packages/types/src/data.ts`. One contract, drifted: app-shell's was an
  // older, looser copy of the adapter contract `@object-ui/types` declares
  // (`any`-typed doors, `delete` resolving `void`, no `getObjectSchema`, an
  // optional `getMetadata` nothing calls, an open index signature), so neither
  // was assignable to the other, and no file imported it and the app-shell
  // entry never published it. app-shell depends on `@object-ui/types`, so that
  // declaration is the one authority and `types.ts` RE-EXPORTS it
  // (objectui#6349, batch 11).
  // `Diagnostic` sat here with THREE sites and three meanings:
  // `packages/sdui-parser/src/types.ts` (a parser finding: `severity`, `code`,
  // `start`, `tag` — published at that package's root and read through it),
  // `packages/app-shell/src/views/metadata-admin/previews/simulator/flow-sim-types.ts`
  // (a flow structural-check finding anchored on a node, edge or cycle) and
  // `packages/cli/src/commands/doctor.ts` (a doctor check result with a stable
  // `id`). Only the first was reachable from its package's built entry, so it
  // keeps the name; RENAME branch for the other two, which now spell
  // `FlowSimDiagnostic` and `DoctorDiagnostic` (objectui#6349, batch 6).
  // `DiagnosticLevel` sat here too, colliding between the same flow-sim and
  // doctor files: `'error' | 'warning'` there, `'ok' | 'warn' | 'error'` here.
  // The flow designer's is the one general level (its structural, server and
  // expression problems all carry it), so it keeps the name and the doctor's
  // now spells `DoctorDiagnosticLevel` (objectui#6349, batch 6).
  // `DomProps` sat here, colliding between `packages/core/src/utils/dom-props.ts`
  // and `packages/fields/src/widgets/toDomProps.ts`. One mechanism, two key
  // sets behind one name: core's is the general "subset of P a whitelist of K
  // forwards", whose default SDUI set forwards `role`; fields' fixed K at its own
  // set, which forwards `name` and `disabled` instead, so the same one-argument
  // spelling meant two things. fields depends on core, but re-pointing its name
  // at core's measured 27 type errors and would silently re-mean it for a reader
  // of the fields root. RENAME branch: fields' declaration now spells
  // `FieldDomProps`, which the fields root publishes instead, after
  // `@object-ui/components`' `FormControlDomProps`; core is the one authority.
  // The two `toDomProps` functions keep their names — value names are outside
  // this gate's bound (objectui#6349, batch 11).
  // `FilterBuilderCondition` / `FilterGroup` sat here, colliding between
  // `packages/components/src/custom/filter-builder.tsx` and
  // `packages/types/src/complex.ts`. Batch 3 parked them; the maintainer's
  // ruling on objectui#9306 (letter A, comment `5857342228`, landed as PR
  // objectui#10823) made `@object-ui/types` the single name authority, and
  // components DERIVED both from it, restating `operator` and `value` on the
  // row as named extensions — but under the same two names, and a derived
  // declaration is still an authority to this gate. Two meanings: the authored
  // row and group, and the rows the shipped builder edits (operator widened by
  // the opt-in `exists` / `notExists`, value required and narrowed), assignable
  // in neither direction. RENAME branch: components' declarations now spell
  // `FilterBuilderRow` / `FilterBuilderRowGroup`, carrying the ruled extensions
  // unchanged, and its three in-repo readers re-point; types is the one
  // authority for both names (objectui#6349, batch 12).
  // `FilterBuilderOperator` sat here too, same pair of files. Two ruled
  // meanings: `@object-ui/types`' was the spec's `ViewFilterOperator` (the
  // protocol's ids) under a second name, components' is the builder's
  // vocabulary, those ids plus the opt-in pair, which the objectui#9306 ruling
  // names as exported by components. types' name had no reader through its
  // entry, so it RETIRED: the authored row types `operator` with the spec's
  // name, and components keeps `FilterBuilderOperator` (objectui#6349, batch 12).
  // `FormFieldSpec` / `FormSectionSpec` / `FormViewSpec` sat here, colliding
  // between `packages/app-shell/src/views/metadata-admin/form-spec.ts` and
  // `packages/react/src/spec-bridge/bridges/form-view.ts` — the second
  // authority left the tree with the spec-bridge retirement (objectui#6366,
  // 2026-08-27 maintainer ruling), so app-shell's `form-spec.ts` is now the
  // one authority and the entries would fail the stale-baseline direction.
  // `KanbanCard` / `KanbanColumn` / `KanbanSchema` sat here. They were the ×4
  // objectui#6155 measured; objectui#6172 converged the THREE in-package copies
  // (`KanbanImpl.tsx` and `KanbanEnhanced.tsx` were strict-SUBSET copies of
  // `./types` — an AST probe found nothing typed differently — so their members
  // moved onto the one in-package declaration and both files re-point at it),
  // leaving the CROSS-package pair. That pair needed an authority ruling the
  // 2026-08-25 family ruling gave only for `FormField`, and the 2026-08-31
  // maintainer ruling (决裁批 #14, option A) gave it: `@object-ui/plugin-kanban`
  // KEEPS the bare names — the dialect all four registered renderers consume —
  // and the `@object-ui/types` trio is renamed `DeclarativeKanbanSchema` /
  // `DeclarativeKanbanColumn` / `DeclarativeKanbanCard`. The deciding axis: the
  // surviving bare name must be the one a renderer honours, because
  // objectui#6086 measured that auto-importing the wrong copy yields a confident
  // EMPTY BOARD rather than an abstention. One authority each now, so all three
  // entries would fail the stale-baseline direction. objectui#7664 (maintainer
  // ruling (a), 2026-09-05) then reversed the "keep both faces" half: the ONE
  // declaration of `KanbanSchema` / `KanbanColumn` / `KanbanCard` (and
  // `CardTemplate` / `ColumnWidthConfig`) moved down to `@object-ui/types`
  // (`complex.ts`), the `DeclarativeKanban*` trio retired, and
  // `plugin-kanban/src/types.ts` re-exports the five — a plain re-export, not
  // an authority, so the entries stay retired.
  // `MarkdownSchema` sat here, colliding between
  // `packages/plugin-markdown/src/types.ts` and `packages/types/src/data-display.ts`.
  // The copies differed on ONE member — `content`, required there and optional here —
  // and that was measured to be DRIFT rather than a semantic difference: the plugin's
  // own registration declares the `content` input `required: true` (pinned by its own
  // test), its `MarkdownImplProps.content` is non-optional, the Zod mirror spells
  // `z.string()`, and every authored `type: 'markdown'` NODE in the repo supplies it.
  // So plugin-markdown re-points at the one authority in `@object-ui/types`
  // (objectui#6172).
  // `MenuItem` sat here, colliding between `packages/types/src/app.ts` and
  // `packages/types/src/overlay.ts`. The two are not one type measured twice:
  // app's is a flat, all-optional `interface` whose `type` is
  // `'item' | 'group' | 'separator'`; overlay's is a discriminated UNION
  // (`MenuCommandItem | MenuDividerItem`) that TOMBSTONES that same key as
  // `type?: never` (objectui#6523), so a re-point would have made an authored
  // `type: 'separator'` legal on one side and a refusal on the other. That is
  // the RENAME branch: app's declaration now spells `AppMenuItem`, the name
  // `src/index.ts` always published it under (objectui#6349).
  // `MetadataTypeStatus` sat here, colliding between
  // `packages/app-shell/src/providers/MetadataProvider.tsx` and
  // `packages/react/src/context/AppShellContext.tsx`. One status, declared
  // twice with the same four words (`'idle' | 'loading' | 'ready' | 'error'`):
  // the provider's per-type cache entries carry it and the context's
  // `getTypeStatus` returns it. app-shell depends on `@object-ui/react`, so
  // react's is the one authority and `MetadataProvider.tsx` RE-EXPORTS it; the
  // app-shell root still publishes the name (objectui#6349, batch 9).
  // `NamedActionDef` sat here — two IDENTICAL declarations inside plugin-grid.
  // `resolveLegacyRowActions.ts` is the one authority; `resolveBulkActions.ts`
  // re-exports it (objectui#6349).
  // `OrgTranslate` sat here — two IDENTICAL declarations inside app-shell's
  // organizations console. `orgErrorMessage.ts` is the one authority;
  // `orgRoleLabel.ts` re-exports it (objectui#6349).
  // `PageHeaderComponentProps` sat here, colliding between
  // `packages/app-shell/src/layout/PageHeader.tsx` and
  // `packages/layout/src/PageHeader.tsx`. Two components, not one drifted
  // shape: layout's is its published `<PageHeader>` (string `title` /
  // `subtitle` with record tokens, `actions` as action definitions, `showBack`,
  // `schema`, every DOM attribute) and app-shell's is the console's own title
  // row (rendered-node `title` / `subtitle` / `actions`, `accentColor`,
  // `sticky`). Neither is the `page:header` renderer, which
  // `@object-ui/components` registers. app-shell depends on layout, but
  // re-pointing its name at layout's does not compile. RENAME branch: the
  // console's declaration now spells `ConsolePageHeaderProps`, and layout is
  // the one authority (objectui#6349, batch 8).
  // `RecordDetailDrawerProps` sat here, colliding between
  // `packages/plugin-dashboard/src/RecordDetailDrawer.tsx` and
  // `packages/plugin-detail/src/RecordDetailDrawer.tsx`. Two drawers, not one:
  // plugin-detail's is the published, editable record drawer (`open`,
  // `recordId`, `dataSource`, save, delete, resize) and plugin-dashboard's is
  // the read-only drill drawer of a table widget (`record` may be `null`,
  // `target` is `'drawer' | 'dialog'`, `fields` whitelists). Neither package
  // depends on the other. RENAME branch: the dashboard's declaration now spells
  // `DashboardRecordDetailDrawerProps` (objectui#6349, batch 8).
  // `SchemaNode` sat here, colliding between `packages/sdui-parser/src/types.ts`
  // and `packages/types/src/base.ts`. Two faces, not one drifted shape:
  // `@object-ui/types`' is the closed AUTHORING union (discriminated on a
  // literal `type`, no index signature, primitive children admitted) and the
  // parser's is its open, as-parsed tree (any `type` string, keys as authored);
  // neither is assignable to the other. sdui-parser has no runtime dependency on
  // `@object-ui/types` — a re-point or a move-down fails `check:phantom-deps` —
  // so neither could converge onto the other. RENAME branch: the parser's
  // declaration now spells `ParsedSchemaNode`, which the sdui-parser root
  // publishes instead; types is the one authority, as objectui#4580 already made
  // it for core (objectui#6349, batch 11).
  // `ThemeProviderProps` sat here, colliding between
  // `packages/providers/src/types.ts` and
  // `packages/react/src/context/ThemeContext.tsx`. Two providers, not one
  // drifted shape: react's is its theme-system `ThemeProvider` (`themes`
  // documents, a theme-NAME `defaultTheme`, `defaultMode`, `persist`,
  // `target`), and providers' a mode-only provider whose `defaultTheme` is the
  // mode itself (a `ThemePreference`). Neither package depends on the other.
  // RENAME branch: providers' declaration now spells
  // `ThemePreferenceProviderProps`, and the providers root publishes that name
  // instead; react keeps the general one. The two `ThemeProvider` components
  // keep their names — value names are outside this gate's bound
  // (objectui#6349, batch 10).
  // `TranslateFn` sat here — i18next's `t` narrowed to `(key, options?) => string`,
  // declared BYTE-IDENTICALLY in three files (one sha256 across the three).
  // objectui#8165 re-pointed `packages/app-shell/src/providers/saveAdvisoryToast.ts`
  // at `writeWarningToast.ts`, but could not do the same for
  // `packages/fields/src/widgets/file-size-guard.ts`: `@object-ui/app-shell`
  // DEPENDS ON `@object-ui/fields`, so that re-export would be a package cycle.
  // The maintainer's ruling on objectui#8165 (option A) moved the ONE declaration
  // DOWN into `@object-ui/i18n` — the `KanbanSchema` route above — and
  // objectui#8261 landed it: `packages/i18n/src/translateFn.ts` declares it, the
  // package entry publishes it, and both former declarations re-export it, which
  // this gate does not count. One authority now, so the entry would fail the
  // stale-baseline direction.
  // `UndoRedoState` sat here, colliding between
  // `packages/plugin-designer/src/hooks/useUndoRedo.ts` and
  // `packages/types/src/ui-action.ts`. Two meanings — the designer's generic hook
  // result versus a non-generic action-history snapshot — but the
  // `@object-ui/types` one had no reader and no writer in the repository and no
  // `@objectstack/spec` counterpart, so it was RETIRED with its two companions
  // (`UndoRedoEntry`, `UndoRedoConfig`) rather than renamed. The designer's
  // declaration is the one authority (objectui#6349, batch 5).
  // `UserDataAdapter` sat here, colliding between
  // `packages/app-shell/src/context/UserStateAdapters.tsx` and
  // `packages/data-objectstack/src/userState.ts`. One contract with identical
  // members (`load()` and `save(items)`, generic over the item): the adapter
  // `createObjectStackUserStateAdapter` builds is the adapter app-shell's
  // registry injects. app-shell depends on `@object-ui/data-objectstack`, so
  // that declaration is the one authority (it took app-shell's contract notes)
  // and `UserStateAdapters.tsx` RE-EXPORTS it; the app-shell root still
  // publishes the name (objectui#6349, batch 9).
  // `ValidationFunction` sat here, colliding between
  // `packages/types/src/data-protocol.ts` and `packages/types/src/field-types.ts`.
  // The two signatures disagree at both ends of the arrow — data-protocol's takes
  // a second `ValidationContext` parameter and returns `boolean | string`, while
  // field-types' takes the value alone and may also return a `Promise` — so
  // field-types' is not assignable to data-protocol's at all, and data-protocol.ts
  // had said so in prose ("may differ from similarly named validation function
  // types in other packages (e.g., in `field-types`)") for as long as both
  // existed. RENAME branch again: field-types' declaration now spells
  // `FieldValidationFunction`, the name `src/index.ts` always published it under
  // (objectui#6349).
  // `VersionEntry` sat here, colliding between
  // `packages/collaboration/src/useConflictResolution.ts` and
  // `packages/plugin-designer/src/components/VersionHistory.tsx`. Two meanings
  // that share `version`, `timestamp`, `userId` and `userName`: collaboration's
  // is a version its conflict-resolution hook RECORDS (an `id` and a per-field
  // `changes` diff that revert and compare replay), the designer's a row its
  // `VersionHistory` timeline DISPLAYS (a prose `description`, `isCurrent`).
  // Neither package depends on the other, and only collaboration's entry
  // exports the name. RENAME branch: the designer's declaration now spells
  // `VersionHistoryEntry` (objectui#6349, batch 10).
  // `ViewSwitcherProps` sat here, colliding between
  // `packages/plugin-list/src/ViewSwitcher.tsx` and
  // `packages/plugin-view/src/ViewSwitcher.tsx`. Two switchers, not one:
  // plugin-view's is the `view-switcher` renderer (a `ViewSwitcherSchema` plus
  // host callbacks, keyed on the whole `ViewType`) and plugin-list's is the list
  // view's visualization switcher (`currentView` / `availableViews`, keyed on
  // `@object-ui/core`'s `ListViewVisualization`). Neither package depends on
  // the other. RENAME branch: plugin-list's declaration now spells
  // `ListViewSwitcherProps`, and the plugin-list root publishes that name
  // instead (objectui#6349, batch 8).
  // `ViewType` sat here, colliding between
  // `packages/plugin-list/src/ViewSwitcher.tsx` and `packages/types/src/views.ts`.
  // Two meanings, not drift: `@object-ui/types`' is the whole view-type
  // vocabulary (the spec's list-view types plus the `list` and `detail`
  // categories), and plugin-list's was an ALIAS of `@object-ui/core`'s
  // `ListViewVisualization` — the drawable subset, without those two arms.
  // The narrower meaning already had its own name, so the alias was deleted:
  // the switcher spells `ListViewVisualization`, and the plugin-list root no
  // longer publishes a `ViewType` (objectui#6349, batch 7).
]);

/**
 * Split the measured collisions against the baseline. Both directions fail.
 *
 * `fresh` — a name, or a site of a known name, the baseline does not list.
 * `stale` — a listed site that no longer carries an authority: the collision
 * shrank (good) and the line must come down with it (owed).
 */
function reconcile(
  observed: ReadonlyMap<string, readonly Located[]>,
  baseline: ReadonlyMap<string, readonly string[]>,
): { fresh: string[]; stale: string[] } {
  const fresh: string[] = [];
  for (const [name, sites] of observed) {
    const allowed = new Set(baseline.get(name) ?? []);
    const surprises = sites.filter((site) => !allowed.has(site.rel));
    if (surprises.length === 0) continue;
    const detail = sites.map((site) => `      ${site.rel}:${site.line} — ${site.what}`).join('\n');
    fresh.push(
      `  ${name} — ${baseline.has(name) ? 'a NEW site for a known collision' : 'a NEW colliding name'}\n${detail}\n` +
        `      baseline line, if this is being accepted as debt: ` +
        `['${name}', [${filesOf(sites).map((rel) => `'${rel}'`).join(', ')}]],`,
    );
  }

  const stale: string[] = [];
  for (const [name, files] of baseline) {
    const seen = new Set((observed.get(name) ?? []).map((site) => site.rel));
    const gone = files.filter((rel) => !seen.has(rel));
    if (gone.length === 0) continue;
    stale.push(
      `  ${name} — no longer collides at:\n${gone.map((rel) => `      ${rel}`).join('\n')}`,
    );
  }

  return { fresh, stale };
}

// ── Controls: the matcher discriminates before it is trusted ─────────────────

describe('objectui#6273 — the matcher discriminates', () => {
  /**
   * ⭐ The POSITIVE control. It proves the assertions further down CAN fail;
   * an assertion that cannot fire is the vacuous-green shape this whole card
   * exists to prevent, reproduced inside the guard. The sibling gate
   * (objectui#6186) shipped a leg that silently never fired, and its positive
   * control is what caught it — so the alias leg gets its own cases here, not
   * just the declaration leg.
   */
  it('fires on every spelling an authority can take', () => {
    for (const [source, expected] of [
      ['export interface KanbanCard { id: string }', 'KanbanCard'],
      ['export type KanbanCard = { id: string };', 'KanbanCard'],
      ['export enum KanbanCard { A }', 'KanbanCard'],
      ['export const enum KanbanCard { A }', 'KanbanCard'],
      ['export declare interface KanbanCard { id: string }', 'KanbanCard'],
      ["export type { CalendarViewEvent as CalendarEvent } from './CalendarView';", 'CalendarEvent'],
      ["export type { A as B, CalendarViewEvent as CalendarEvent } from './x';", 'CalendarEvent'],
      ["export { type CalendarViewEvent as CalendarEvent } from './CalendarView';", 'CalendarEvent'],
      ['export type {\n  CalendarViewEvent as CalendarEvent,\n} from "./CalendarView";', 'CalendarEvent'],
    ] as const) {
      expect(
        authoritySites(source).map((site) => site.name),
        source,
      ).toContain(expected);
    }
  });

  /**
   * ⭐ The load-bearing half. Every negative below is a spelling this
   * repository really writes, cited where it lives. An assertion that redded
   * on any of them would be deleted by the first person who hit it, and the
   * ruling would go back to unguarded — worse than never writing this file.
   */
  it('stays silent on every re-export, near-spelling and quotation this tree really carries', () => {
    for (const source of [
      // Deliberate re-exports — one declaration, many export sites.
      "export type { StatusFieldSource } from './record-semantics.js';", // types/src/index.ts:71
      "export * from './registry/Registry.js';", //                        core/src/index.ts:10
      "export * as urlParams from './urlParams';", //                      the namespace spelling
      "export { ObjectKanban } from './ObjectKanban';", //                 a value re-export
      "export type { KanbanCard as KanbanCard } from './types';", //       `X as X`, spelled long
      // A VALUE alias. `isolatedModules` means a TYPE alias must say so, and
      // this repo's are all `export type { … }` clauses.
      "export { formatTitleTemplate as formatRecordTitle } from './title';", // app-shell/src/utils/index.ts:9
      "export { default as en } from './en';", //                          i18n/src/locales/index.ts:5
      // Value declarations — out of the stated bound.
      'export const KanbanCard = 1;',
      'export function KanbanCard() { return null; }',
      'export class KanbanCard {}',
      // Not exported at all.
      'interface ObjectActionConfig { id: string }', //                    app-shell/src/hooks/useObjectActions.ts:21
      // Imports name types too; naming one is not declaring it.
      "import type { KanbanCard } from '@object-ui/types';",
      // Prose and quotation — the mask's whole job.
      '// export interface KanbanCard is declared in @object-ui/types',
      '/** `export type { X as Y }` publishes a second meaning. */',
      "expect(typesFile).toContain('export interface HeatmapSchema extends BaseSchema {');", // create-plugin/src/__tests__/templates.test.ts:449
      "expect(source).toContain('export type { ChatMessage }');", // plugin-chatbot's chat-message-contract test quoted this until objectui#6349 batch 5
      "expect(typesSrc).toContain('export interface CalendarEvent {');", // plugin-calendar/src/__tests__/name-collision-5044.test.ts:173
      'const tpl = `export interface ${vars.pascalName}Schema extends BaseSchema {`;', // create-plugin/src/templates.ts:417
    ]) {
      expect(authoritySites(source), source).toEqual([]);
    }
  });

  /**
   * ⭐ The self-reference control, and the reason this gate needs no filename
   * exemption. The sibling objectui#6186 gate reddened on its own source the
   * moment it became a tracked file, because its fixture table quotes the very
   * shape it scans for. This table does too — every string in the block above
   * spells a declaration or an export clause. Masking is the real
   * discriminator, and this asserts it directly, independently of the
   * population bound: run the matcher over THIS FILE's own bytes and it must
   * find nothing.
   */
  it('finds no authority in its own source, on masking alone', () => {
    const ownSource = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    expect(ownSource.length, 'the self-scan read an empty file').toBeGreaterThan(1000);
    expect(authoritySites(ownSource)).toEqual([]);
  });

  /**
   * The other half of "discriminates": shapes that DO produce authority sites
   * but must not be reported as collisions.
   */
  it('reports no collision for a re-export fan-out, a fresh alias, or a near-spelling', () => {
    const green: readonly Document[][] = [
      // One declaration, fanned out through two barrels — the monorepo's
      // normal shape, and the thing a naive gate reds on.
      [
        { rel: 'packages/types/src/complex.ts', source: 'export interface KanbanCard { id: string }' },
        { rel: 'packages/types/src/index.ts', source: "export type { KanbanCard } from './complex';" },
        { rel: 'packages/plugin-kanban/src/index.tsx', source: "export type { KanbanCard } from '@object-ui/types';" },
      ],
      // An alias publishing a name nothing else declares — the shape the family
      // cards land on, spelled below as a synthetic corpus. Today's live
      // instances are the `Spec*` family in `packages/types/src/index.ts`
      // (`FormField as SpecFormField`, …), which republishes @objectstack/spec
      // names this package also declares. ⚠️ The two aliases this comment used
      // to point at are gone: objectui#6349 renamed the DECLARATIONS to
      // `AppMenuItem` / `FieldValidationFunction`, which is what actually
      // removed those collisions — an alias alone cures the barrel's ambiguity,
      // not the two authorities behind it. It must stay green or the remedy reds.
      [
        { rel: 'packages/types/src/app.ts', source: 'export interface MenuItem { id: string }' },
        { rel: 'packages/types/src/index.ts', source: "export type { MenuItem as AppMenuItem } from './app';" },
      ],
      // Derived names next to the bare one. `KanbanConditionalFormattingRule`
      // is real (packages/types/src/objectql.ts); the `KanbanNative…` spelling
      // was, until objectui#11522 retired it, and stays as a synthetic one.
      [
        { rel: 'packages/types/src/objectql.ts', source: 'export interface KanbanNativeConditionalFormattingRule { a: 1 }' },
        { rel: 'packages/plugin-kanban/src/x.tsx', source: 'export type ConditionalFormattingRule = { a: 1 };' },
      ],
      // Declaration merging inside ONE file: legal TypeScript, one authority.
      [
        {
          rel: 'packages/types/src/base.ts',
          source: 'export interface ComponentMeta { a: 1 }\nexport interface ComponentMeta { b: 2 }',
        },
      ],
    ];
    for (const corpus of green) {
      expect([...collisions(corpus).keys()], JSON.stringify(corpus)).toEqual([]);
    }
  });

  it('reports a collision when a second declaration, or an aliasing re-export, arrives', () => {
    const declared = [
      { rel: 'packages/types/src/complex.ts', source: 'export interface KanbanCard { id: string }' },
      { rel: 'packages/plugin-kanban/src/types.ts', source: 'export interface KanbanCard { id: number }' },
    ];
    expect([...collisions(declared).keys()]).toEqual(['KanbanCard']);

    const aliased = [
      { rel: 'packages/types/src/complex.ts', source: 'export interface CalendarEvent { id: string }' },
      { rel: 'packages/plugin-calendar/src/index.tsx', source: "export type { CalendarViewEvent as CalendarEvent } from './CalendarView';" },
    ];
    expect([...collisions(aliased).keys()]).toEqual(['CalendarEvent']);
  });
});

// ── Controls: the ratchet moves in both directions ───────────────────────────

describe('objectui#6273 — the baseline is a ratchet, not a skip-list', () => {
  const baseline: ReadonlyMap<string, readonly string[]> = new Map([
    ['KanbanCard', ['packages/plugin-kanban/src/types.ts', 'packages/types/src/complex.ts']],
  ]);
  const at = (rel: string, source: string) => ({ rel, source });
  const twoDeclarations = [
    at('packages/types/src/complex.ts', 'export interface KanbanCard { id: string }'),
    at('packages/plugin-kanban/src/types.ts', 'export interface KanbanCard { id: number }'),
  ];

  it('accepts exactly the population it names', () => {
    const { fresh, stale } = reconcile(collisions(twoDeclarations), baseline);
    expect({ fresh, stale }).toEqual({ fresh: [], stale: [] });
  });

  it('fails on a new site for a known collision', () => {
    const grown = [
      ...twoDeclarations,
      at('packages/plugin-kanban/src/KanbanImpl.tsx', 'export interface KanbanCard { id: symbol }'),
    ];
    const { fresh, stale } = reconcile(collisions(grown), baseline);
    expect(fresh.join('\n')).toContain('packages/plugin-kanban/src/KanbanImpl.tsx');
    expect(stale).toEqual([]);
  });

  it('fails on a collision the baseline never named', () => {
    const other = [
      at('packages/types/src/complex.ts', 'export interface KanbanColumn { id: string }'),
      at('packages/plugin-kanban/src/types.ts', 'export interface KanbanColumn { id: number }'),
    ];
    expect(reconcile(collisions(other), baseline).fresh.join('\n')).toContain('a NEW colliding name');
  });

  /**
   * ⭐ The direction that keeps the table honest. The card requires the
   * baseline to SHRINK as the family cards land, and ⛔ forbids exempting the
   * population forever — so a cleaned collision has to fail until its line
   * comes down.
   */
  it('fails when a listed collision has been cleaned and its line was left behind', () => {
    const cleaned = [
      at('packages/types/src/complex.ts', 'export interface KanbanCard { id: string }'),
      at('packages/plugin-kanban/src/types.ts', "export type { KanbanCard } from '@object-ui/types';"),
    ];
    const { fresh, stale } = reconcile(collisions(cleaned), baseline);
    expect(fresh).toEqual([]);
    expect(stale.join('\n')).toContain('packages/plugin-kanban/src/types.ts');
  });
});

// ── The claim itself, re-derived from source ─────────────────────────────────

describe('objectui#6273 — every exported schema name has exactly one authority', () => {
  const published = publishedPackageDirs(repoRoot);
  const files = populationFiles(repoRoot, published);
  const corpus: Document[] = files.map((rel) => ({
    rel,
    source: fs.readFileSync(path.join(repoRoot, rel), 'utf8'),
  }));

  /**
   * ⚠️ The population refuses to collapse. A scan that finds nothing reads
   * exactly like a scan that found nothing wrong, and every assertion below
   * would be vacuously green forever. Three floors, because three different
   * things can collapse independently: the package derivation, the file walk,
   * and the MATCHER itself — a regex or a mask change that stops matching
   * would otherwise turn this file green while measuring nothing.
   *
   * Measured on `79ebf30d1`: 38 published packages, 1,364 files, 2,158
   * authority sites. The floors sit well below, so ordinary growth and
   * ordinary deletion do not touch them.
   */
  it('scans a population that has not collapsed', () => {
    expect(published.length, 'no published package was derived').toBeGreaterThan(30);
    expect(files.length, 'the source walk found no published TypeScript at all').toBeGreaterThan(1000);
    const sites = corpus.reduce((total, doc) => total + authoritySites(doc.source).length, 0);
    expect(sites, 'the matcher found no authority anywhere — it has stopped matching').toBeGreaterThan(1500);
  });

  it('declares no name twice outside the named, shrinking baseline', () => {
    const { fresh, stale } = reconcile(collisions(corpus), KNOWN_COLLISIONS);

    expect(
      fresh,
      'The 2026-08-25 family ruling (objectui#6172, decision 甲/A1): every exported schema\n' +
        'name has exactly one authority. These names have two or more — a second declaration,\n' +
        'or an aliasing re-export publishing a name something else already declares:\n\n' +
        `${fresh.join('\n\n')}\n\n` +
        '  Remedy: pick the ONE authority, and re-point the others at it —\n' +
        "  `export type { X } from '<the-owner>'` is a re-export, not a second declaration,\n" +
        '  and this gate does not count it. If the two shapes are genuinely different\n' +
        '  things, rename the loser to the name the barrel already publishes it\n' +
        '  under — `UIActionSchema`, `AppMenuItem` and `FieldValidationFunction`\n' +
        '  (objectui#6349) are this repo’s worked examples.\n' +
        '  ⛔ KNOWN_COLLISIONS is SHRINK-ONLY: adding a line is not a supported way\n' +
        '  to make this pass.',
    ).toEqual([]);

    expect(
      stale,
      'KNOWN_COLLISIONS lists collisions that no longer exist. Good news — but the entry\n' +
        'has to come down with the fix, or the baseline turns into a permanent skip-list\n' +
        'and stops meaning anything:\n\n' +
        `${stale.join('\n\n')}`,
    ).toEqual([]);
  });
});

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7559 — THE RELAY RUNG CENSUS.
 *
 * `renderListView` in `./ObjectView.tsx` composes `fullSchema: ListViewSchema`
 * out of the host's list schema and a set of rungs that read the ACTIVE VIEW
 * (`viewDef`). The output is typed; the input is not — `viewDef` is an element
 * of what `buildViewTabs` returns, `Array<Record<string, any> & { id: string }>`,
 * and its own inputs (`definedViews`, `savedViews`, `viewOverrides`) are `any`
 * too. So the compiler checks that a rung's NAME is a legal member, and nothing
 * at all checks the other direction: a `ListViewSchema` member with NO rung is
 * not a type error, not a lint finding and not a test failure. It is silence,
 * and the silence has now produced the same defect three times —
 * objectui#7199 (`description`), objectui#7218 (`rowColor`), objectui#7516
 * (`fieldOrder`). Each of the three now has its rung, and each rung is named
 * by a check below.
 *
 * This file is the ruling on that card: option (b). The census is not a list
 * somebody typed once — it is RE-DERIVED here, at test time, from four sources
 * on disk, and every absence must be DECLARED WITH A REASON in `ABSENCES`
 * below. A member that is neither relayed nor declared fails BY NAME.
 *
 * ## THE READING — what counts as a member, what counts as a rung
 *
 * The card said "47 named keys". Three defensible ways of counting that
 * literal give 48, 36 and 66, and none of them is 47, so the number is not the
 * subject and no number is asserted here. The READING is:
 *
 *   MEMBER (the population, 93 today, derived — never listed):
 *     - every key of the zod mirror's `.shape` (`@object-ui/types/zod`
 *       `ListViewSchema`). That mirror is what the TYPE is made of:
 *       `ListViewSchema = ListViewInferred & ListViewRuntimeProps` and
 *       `ListViewInferred = z.input<typeof ListViewSchema>`, so its shape IS
 *       the serialisable member set, including everything `BaseSchema` and
 *       `@objectstack/spec` contribute by reference.
 *     - plus the members of `ListViewRuntimeProps`, read out of
 *       `packages/types/src/objectql.ts` by the TypeScript parser. They are the
 *       other half of the same intersection; leaving them out would let the
 *       census claim to cover a type it only half enumerates.
 *     A member is a TOP-LEVEL key of the target type. Keys nested inside a
 *     member's own shape (`aria.live`, `kanban.groupByField`) are that member's
 *     business, not this census's: the unit a rung writes is a top-level key.
 *
 *   RUNG (relayed): a property assignment in the `fullSchema` literal whose
 *     value expression references the identifier `viewDef`, or a local computed
 *     from it (`calendarOptions`, derived below rather than allowed by name) —
 *     i.e. the ACTIVE VIEW's value can reach `ListView`. `...listSchema` is
 *     deliberately NOT a rung: it carries the HOST's value, which is exactly
 *     what was on screen in all three defects while the view's own value was
 *     dropped.
 *
 * Every member that is not relayed needs an entry in `ABSENCES` giving a `kind`
 * and a `reason`. The `kind` is not decoration: each one carries a piece of
 * MECHANICAL evidence checked below, so a declaration cannot quietly become
 * false. `relayed-upstream` re-derives the caller's own composition literal in
 * `plugin-view`; `relayed-nested` names the path inside the literal and it must
 * exist; `unread` requires that `ListView` still has no reader for the key;
 * `known-gap` requires that it still HAS one.
 *
 * ⇒ That is what turns "the absences are deliberate" from a whole-literal
 * assumption (the card's option (c)) into a per-key claim anyone can re-read.
 *
 * ## Why the census, and not just a type on `viewDef` (measured)
 *
 * The card's option (a) was to give `viewDef` the view-entry type it actually
 * carries. That was measured before this file was written: annotating it
 * `NamedListView & { id: string }` and running `tsc --noEmit` over the package
 * produces 22 diagnostics, and NOT ONE of them is a missing rung. Every one is
 * the opposite direction — a key the relay READS that the declared view type
 * does not carry (`rowColor`, `appearance`, `chart`, `tree`, `map`, `name`,
 * `editRecordsInline`). That is the sibling finding objectui#7483 owns.
 *
 * ⇒ (a) cannot deliver this card's headline. A type on the read side says what
 * a value IS; nothing about it REQUIRES the literal to write a key it never
 * mentions, so an absent rung stays absent and silent. (a) is necessary for
 * other reasons and not sufficient for this one. Hence (b), here.
 *
 * ## What this file does NOT do
 *
 * ⛔ It does not fill in a missing rung. Each absent rung is its own card
 *    (`fieldOrder` was objectui#7516, and that card added the rung together
 *    with its check below); this file only makes absences visible and keeps
 *    them declared.
 * ⛔ It does not touch `plugin-view`'s `ObjectView` — that host is the
 *    objectui#5043 family, and its own pin
 *    (`plugin-view/src/__tests__/objectViewHostSurface.test.tsx`) is the
 *    same technique pointed the other way. This file only READS its source.
 * ⛔ It asserts no count. Counts drift by construction; the property is what
 *    holds.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
/**
 * Comments are blanked before any text derivation, through the tree's ONE
 * answer to "is this span a comment, or code?". Not tidiness, and not a
 * hand-rolled `stripComments`: this relay documents itself in prose that NAMES
 * keys ("no `config` rung", "NOT `userActions.rowColor`") and both files
 * scanned below carry regex literals and URLs, which is exactly where the naive
 * regex form opens a phantom comment and blanks the real code underneath —
 * reporting a clean sweep over source it never looked at
 * (`scripts/js-comment-mask.mjs`, and the corpus gate that keeps it honest).
 */
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;
import { BaseSchema as BaseNodeMirror, ListViewSchema as ListViewMirror } from '@object-ui/types/zod';

// ---------------------------------------------------------------------------
// Sources. Read from disk, not imported: the claims being pinned are about what
// these files WRITE and READ, which is text, not a value. Both candidate paths
// are covered so the pin holds whether vitest runs from the repo root or from
// the package (the repo-root invocation is the supported one — see AGENTS.md).
// ---------------------------------------------------------------------------

const sourceOf = (fromRoot: string, fromPackage: string): string => {
  const path = [resolve(process.cwd(), fromRoot), resolve(process.cwd(), fromPackage)]
    .find((candidate) => existsSync(candidate));
  if (!path) throw new Error(`objectui#7559 census cannot locate ${fromRoot}`);
  return readFileSync(path, 'utf8');
};

const RELAY_SOURCE = sourceOf('packages/app-shell/src/views/ObjectView.tsx', 'src/views/ObjectView.tsx');
const UPSTREAM_SOURCE = sourceOf('packages/plugin-view/src/ObjectView.tsx', '../plugin-view/src/ObjectView.tsx');
const TYPES_SOURCE = sourceOf('packages/types/src/objectql.ts', '../types/src/objectql.ts');
const LIST_VIEW_SOURCE = sourceOf('packages/plugin-list/src/ListView.tsx', '../plugin-list/src/ListView.tsx');

const parse = (name: string, text: string): ts.SourceFile =>
  ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);


// ---------------------------------------------------------------------------
// 1. THE POPULATION — every member of `ListViewSchema`, derived.
// ---------------------------------------------------------------------------

/** The serialisable half: the zod mirror the TYPE is `z.input` of. */
const MIRROR_MEMBERS: string[] = Object.keys(
  (ListViewMirror as unknown as { shape: Record<string, unknown> }).shape,
).sort();

/** The runtime-only half: `ListViewRuntimeProps`, parsed out of its declaration. */
const RUNTIME_MEMBERS: string[] = (() => {
  const sf = parse('objectql.ts', TYPES_SOURCE);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'ListViewRuntimeProps') {
      for (const member of node.members) {
        if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
          found.push(member.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found.sort();
})();

const MEMBERS: string[] = [...new Set([...MIRROR_MEMBERS, ...RUNTIME_MEMBERS])].sort();

// ---------------------------------------------------------------------------
// 2. THE RELAY — every property the `fullSchema` literal writes, with its path
//    and whether its value reads the active view.
// ---------------------------------------------------------------------------

interface Written {
  /** `rowColor`, `options.kanban` — spreads of object literals are transparent. */
  path: string;
  /** Identifiers appearing anywhere in the value expression. */
  reads: string[];
  /** The value expression's source text, comments stripped. */
  text: string;
}

const collectLiteral = (literal: ts.ObjectLiteralExpression, prefix: string, out: Written[]): void => {
  const handle = (obj: ts.ObjectLiteralExpression): void => {
    for (const property of obj.properties) {
      if (ts.isSpreadAssignment(property)) {
        // `...(cond ? { calendar } : {})` contributes `calendar` at THIS level —
        // the key really is written here, conditionally. `...listSchema` has no
        // object literal inside it and so contributes nothing, which is the
        // intended reading: it carries the host's value, not the view's.
        const inner: ts.ObjectLiteralExpression[] = [];
        const walk = (node: ts.Node): void => {
          if (ts.isObjectLiteralExpression(node)) inner.push(node);
          ts.forEachChild(node, walk);
        };
        walk(property.expression);
        inner.forEach(handle);
        continue;
      }
      const name = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
        ? property.name.text
        : null;
      if (!name) continue;
      const value = ts.isPropertyAssignment(property) ? property.initializer : property;
      const reads = new Set<string>();
      const walkIds = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) reads.add(node.text);
        ts.forEachChild(node, walkIds);
      };
      walkIds(value);
      out.push({
        path: prefix ? `${prefix}.${name}` : name,
        reads: [...reads],
        text: mask(value.getText()),
      });
      if (ts.isPropertyAssignment(property) && ts.isObjectLiteralExpression(property.initializer)) {
        collectLiteral(property.initializer, prefix ? `${prefix}.${name}` : name, out);
      }
    }
  };
  handle(literal);
};

const relayLiteral = ((): ts.ObjectLiteralExpression => {
  const sf = parse('ObjectView.tsx', RELAY_SOURCE);
  let found: ts.ObjectLiteralExpression | null = null;
  const visit = (node: ts.Node): void => {
    if (
      !found
      && ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === 'fullSchema'
      && node.initializer
      && ts.isObjectLiteralExpression(node.initializer)
    ) {
      found = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!found) {
    throw new Error(
      'objectui#7559 census cannot find the relay literal `const fullSchema = { … }` in\n'
      + 'app-shell/src/views/ObjectView.tsx. The census anchors on that name. If the literal was\n'
      + 'renamed or moved, re-point this anchor — ⛔ do not delete the census, which is the only\n'
      + 'thing standing between a dropped rung and silence (objectui#7199, #7218, #7516).',
    );
  }
  return found;
})();

const WRITTEN: Written[] = [];
collectLiteral(relayLiteral, '', WRITTEN);

const writtenAt = (path: string): Written | undefined => WRITTEN.find((w) => w.path === path);

/**
 * Locals the relay computes FROM the active view — `const calendarOptions =
 * calendarViewOptions(viewDef)` and its siblings. A rung reading one of these is
 * relaying the view's value just as directly as a rung naming `viewDef`; the
 * only difference is where the projection was written. Deriving the set (rather
 * than allowing an arbitrary indirection) keeps the reading honest: a rung
 * reading a local that has NOTHING to do with the view still does not count.
 */
const VIEW_DERIVED_LOCALS: string[] = (() => {
  // Scoped to the `renderListView` callback that owns the literal. File-wide
  // collection would sweep in same-named locals from the view-option helpers
  // further down (which take their own `viewDef` parameter), and a census that
  // counts an unrelated `base` or `found` as "the view's value" is not reading
  // the relay any more.
  const scope = ts.findAncestor(
    relayLiteral,
    (node): boolean => ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node),
  );
  if (!scope) throw new Error('objectui#7559 census cannot find the function scope holding the relay literal.');
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      let readsViewDef = false;
      const walk = (n: ts.Node): void => {
        if (ts.isIdentifier(n) && n.text === 'viewDef') readsViewDef = true;
        ts.forEachChild(n, walk);
      };
      walk(node.initializer);
      // `fullSchema` is the literal itself — including it would let the census
      // count a self-reference as a relay.
      if (readsViewDef && node.name.text !== 'fullSchema') names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return [...names].sort();
})();

const readsView = (w: Written | undefined): boolean =>
  !!w && (w.reads.includes('viewDef') || w.reads.some((ident) => VIEW_DERIVED_LOCALS.includes(ident)));

/** Members with a top-level rung whose value reads the active view. */
const RELAYED: string[] = MEMBERS.filter((member) => readsView(writtenAt(member)));

/** Everything the literal writes at top level, member or not. */
const WRITTEN_TOP: string[] = WRITTEN.filter((w) => !w.path.includes('.')).map((w) => w.path);

// ---------------------------------------------------------------------------
// 3. THE UPSTREAM COMPOSITION — the caller's own view-aware literal.
//
// `renderListView` has exactly one supplier: `plugin-view`'s ObjectView, which
// builds the `schema` it hands down out of `activeView` / `currentNamedViewConfig`.
// Keys it supplies arrive here through `...listSchema` and need no rung — but
// that is a claim about ANOTHER file, so it is re-derived rather than asserted.
// ---------------------------------------------------------------------------

const UPSTREAM: Written[] = (() => {
  const sf = parse('plugin-view/ObjectView.tsx', UPSTREAM_SOURCE);
  let literal: ts.ObjectLiteralExpression | null = null;
  const visit = (node: ts.Node): void => {
    if (
      !literal
      && ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'renderListView'
      && node.arguments.length === 1
      && ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      for (const property of (node.arguments[0] as ts.ObjectLiteralExpression).properties) {
        if (
          ts.isPropertyAssignment(property)
          && ts.isIdentifier(property.name)
          && property.name.text === 'schema'
          && ts.isObjectLiteralExpression(property.initializer)
        ) {
          literal = property.initializer;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!literal) {
    throw new Error(
      'objectui#7559 census cannot find the `renderListView({ schema: { … } })` composition in\n'
      + 'plugin-view/src/ObjectView.tsx. Several absences below are declared on the ground that\n'
      + 'THAT literal supplies the key from the active view; with it gone the ground is gone too.\n'
      + 'Re-point this anchor and re-read those entries — ⛔ do not weaken them to prose.',
    );
  }
  const out: Written[] = [];
  collectLiteral(literal, '', out);
  return out;
})();

const upstreamAt = (key: string): Written | undefined => UPSTREAM.find((w) => w.path === key);

// ---------------------------------------------------------------------------
// 4. THE READER PROBE — does `ListView` still read this key off its schema?
//
// The direct consumer of what this relay builds. An absence declared "nothing
// reads it" and an absence declared "a reader is waiting for a value that never
// comes" are opposite claims, and this is what keeps each one honest.
// ---------------------------------------------------------------------------

const LIST_VIEW_CODE = mask(LIST_VIEW_SOURCE);
const listViewReads = (key: string): boolean =>
  new RegExp(String.raw`(?:propSchema|schema)(?:\s+as\s+any)?\)?\??\.${key}\b`).test(LIST_VIEW_CODE);

// ---------------------------------------------------------------------------
// 5. THE LEDGER — every absence, declared, with the reason and the evidence.
//
// ⛔ This is NOT the census. The census is the population above, re-derived
// every run. This is the set of ANSWERS about members the relay does not carry,
// and an answer here is only admitted while its evidence holds.
// ---------------------------------------------------------------------------

type Absence =
  /** The view's value reaches ListView through a nested path in the same literal. */
  | { kind: 'relayed-nested'; path: string; reason: string }
  /** The caller composes it from the active view; it arrives via `...listSchema`. */
  | { kind: 'relayed-upstream'; upstreamReads: string[]; reason: string }
  /** A legacy spelling; the canonical member is carried and the fold runs downstream. */
  | { kind: 'legacy-alias'; canonical: string; mentions?: string; reason: string }
  /** The identity of the NODE the relay composes, not a value a view may override. */
  | { kind: 'node-identity'; reason: string }
  /** A `BaseSchema` node member — page-document vocabulary, not view metadata. */
  | { kind: 'node-level'; reason: string }
  /** Authored on the object-view NODE; the host resolves it, not the view record. */
  | { kind: 'node-authored'; reason: string }
  /** Nothing on the ListView path consumes it, so there is nothing to relay INTO. */
  | { kind: 'unread'; reason: string }
  /** A real absence with a live reader, owned by another card. ⛔ Not fixed here. */
  | { kind: 'known-gap'; card: string; reason: string }
  /** Non-serialisable host runtime prop — a view record cannot carry a function. */
  | { kind: 'host-runtime'; reason: string };

const ABSENCES: Record<string, Absence> = {
  // ── The per-view-type blocks: no entry, they have top-level rungs ─────────
  // `kanban`, `calendar`, `gallery`, `gantt`, `timeline`, `tree`, `map` and
  // `chart` used to sit here as `relayed-nested`: the relay writes each one into
  // `options.KIND`, where `ListView` reads it. objectui#10380 gave each of them a
  // conditional TOP-LEVEL rung as well. When the stored row's legacy `options`
  // bag carries a kind, the view's own block for that kind is written at the top
  // level, so `ListView` lays it over the bag per key. The census therefore
  // counts all eight as relayed, and an entry here would contradict it. Their
  // nested paths are still written for every row and still asserted, by name,
  // in the derivation checks below (`options.kanban`, `options.chart`).

  // ── Supplied by the caller, from the active view, via `...listSchema` ─────
  // `plugin-view`'s ObjectView composes the list schema this relay spreads. For
  // these keys it already reads the active view, so a rung here would be a
  // second, competing source of the same value.
  columns: { kind: 'relayed-upstream', upstreamReads: ['activeView', 'currentNamedViewConfig'], reason: "The view's column set is composed upstream (`currentNamedViewConfig?.columns || activeView?.columns || …`, objectui#5269) and arrives through `...listSchema`." },
  viewType: { kind: 'relayed-upstream', upstreamReads: ['currentViewType'], reason: "The view KIND is resolved upstream into `currentViewType` (it drives which branch runs there) and handed down; the relay must not re-decide it." },
  grouping: { kind: 'relayed-upstream', upstreamReads: ['activeView'], reason: 'Composed upstream as `grouping: activeView?.grouping` and read by ListView from the spread. The relay writes the key only to lay a grouping the URL carries over that value (objectui#11860); it reads no `viewDef`.' },
  compactToolbar: { kind: 'relayed-upstream', upstreamReads: ['activeView'], reason: 'Composed upstream from the active view; no second rung needed.' },
  showDescription: { kind: 'relayed-upstream', upstreamReads: ['activeView'], reason: "Legacy bare flag, composed upstream AND folded on top of the view's `appearance` by this relay's `appearance` rung (ADR-0047)." },

  // ── The node's own identity ───────────────────────────────────────────────
  type: { kind: 'node-identity', reason: "The component discriminator of the node being composed (`'list-view'`, written upstream as a literal). A view record that could set it would re-route its own renderer." },
  objectName: { kind: 'node-identity', reason: 'The object binding, taken from the object-view node upstream. A view is a lens ON an object; it may not rebind which object.' },

  // ── `BaseSchema` node vocabulary ──────────────────────────────────────────
  // Every one of these describes the NODE inside a page document — where it
  // renders, whether it renders, what it is called in the tree. They arrive (or
  // do not) with `...listSchema`, and a view record is not the author of the
  // page. Relaying one would let stored view metadata move or hide the host's
  // component. ⚠️ Two `BaseSchema` members are NOT here: `label` and
  // `description` are per-view TEXT, both relayed, and `description` missing its
  // rung is objectui#7199 itself.
  id: { kind: 'node-level', reason: "The node's DOM/event id in the page document." },
  name: { kind: 'node-level', reason: "The node's name in the page document. The view's own `name` is its API name and is used here to key `viewEmptyState`, not to rename the node." },
  className: { kind: 'node-level', reason: 'Tailwind override for the node; this relay passes the host\'s `className` to `<ListView>` as a prop instead.' },
  style: { kind: 'node-level', reason: 'Inline style bag for the node, owned by the page author. A view record that could set it would style a component it does not own — and this repo bans inline style on components in the first place (AGENTS.md #2).' },
  bind: { kind: 'node-level', reason: 'Data-binding path of the node in the page document.' },
  body: { kind: 'node-level', reason: 'Node content slot in the page document. The list view renders records, not authored children, and a view record has no say in the page tree around it.' },
  children: { kind: 'node-level', reason: 'Node child slot; the list view composes its own subtree.' },
  hidden: { kind: 'node-level', reason: "Node visibility, the page author's decision about the component." },
  hiddenOn: { kind: 'node-level', reason: 'Breakpoint visibility of the node. A stored view deciding at which viewport the host page hides its own list component is the page author\'s call, not a lens setting.' },
  visible: { kind: 'node-level', reason: 'Node visibility expression evaluated against page data; same reason as `hidden` — the page author decides whether the component renders at all.' },
  visibleOn: { kind: 'node-level', reason: 'Breakpoint visibility of the node, the positive spelling of `hiddenOn`; the page author owns it.' },
  visibleWhen: { kind: 'node-level', reason: 'Node visibility expression, the second spelling `BaseSchema` admits; the page author owns it exactly as with `visible`.' },
  disabled: { kind: 'node-level', reason: 'Node interactivity, a page-composition decision. What a view may say about interactivity it says through `userActions` and `inlineEdit`, both relayed.' },
  disabledOn: { kind: 'node-level', reason: 'Breakpoint form of `disabled`; the page author owns it for the same reason.' },
  placeholder: { kind: 'node-level', reason: 'Node-level placeholder text from the shared node vocabulary. The list view\'s own empty-state copy is `emptyState`, which IS relayed and is the key an author reaches for.' },
  ariaLabel: { kind: 'node-level', reason: "Node-level ARIA label. The view's own accessibility bag is `aria`, which IS relayed." },
  testId: { kind: 'node-level', reason: 'Test hook belonging to whoever composed the page; a stored view record renaming a host page\'s test handle would break tests that never mention the view.' },

  // ── Legacy spellings, folded at the ListView boundary ─────────────────────
  // `normalizeListViewSchema` (`@object-ui/core`) is the ONE fold, and it runs
  // inside `ListView` on the schema it receives. The canonical twin of each of
  // these is carried (relayed or upstream), so adding a rung for the legacy
  // spelling would re-seed a vocabulary the fold exists to retire (#2890).
  fields: { kind: 'legacy-alias', canonical: 'columns', reason: 'Legacy alias for `columns`, folded by `normalizeListViewSchema` at the ListView boundary.' },
  filters: { kind: 'legacy-alias', canonical: 'filter', reason: "Legacy alias for `filter`. The view's effective filter is computed ONCE, in the `filter` rung (#2890) — a second rung here is the exact duplication that card removed." },
  showSearch: { kind: 'legacy-alias', canonical: 'userActions', mentions: 'normalizeListViewSchema', reason: "Legacy toolbar flag; the `userActions` rung runs the view through `normalizeListViewSchema` and merges the result over the host's, so the view's flag arrives folded." },
  showSort: { kind: 'legacy-alias', canonical: 'userActions', mentions: 'normalizeListViewSchema', reason: 'Legacy toolbar flag, folded into `userActions` by the same rung.' },
  showFilters: { kind: 'legacy-alias', canonical: 'userActions', mentions: 'normalizeListViewSchema', reason: 'Legacy toolbar flag, folded into `userActions` by the same rung.' },
  showHideFields: { kind: 'legacy-alias', canonical: 'userActions', mentions: 'normalizeListViewSchema', reason: 'Legacy toolbar flag, folded into `userActions` by the same rung.' },
  showGroup: { kind: 'legacy-alias', canonical: 'userActions', mentions: 'normalizeListViewSchema', reason: 'Legacy toolbar flag, folded into `userActions` by the same rung.' },
  showColor: { kind: 'legacy-alias', canonical: 'userActions', mentions: 'normalizeListViewSchema', reason: 'Legacy toolbar flag, folded into `userActions` by the same rung.' },
  showDensity: { kind: 'legacy-alias', canonical: 'userActions', mentions: 'normalizeListViewSchema', reason: 'Legacy toolbar flag, folded into `userActions` by the same rung; the density VALUE has its own `rowHeight` rung, which reads through the same fold.' },
  densityMode: { kind: 'legacy-alias', canonical: 'rowHeight', mentions: 'normalizeListViewSchema', reason: "Legacy spelling of the density VALUE, retired on `NamedListView` (objectui#7924, ruling A′). The `rowHeight` rung runs the view through `normalizeListViewSchema` and relays its `rowHeight`, so a stored view's `densityMode` arrives folded and this relay never names the retired key." },

  // ── Declared on the type, consumed by nobody on this path ─────────────────
  // A rung for one of these would relay a value into a void, and the void is
  // the finding: each is pinned here so that the day a reader appears, this
  // census reddens instead of the value silently not arriving.
  striped: { kind: 'unread', reason: 'Retired by objectstack#7176 (maintainer-ruled 2026-08-10) after every objectui reader was measured as pass-through. Present only as the spec import that carries its tombstone.' },
  bordered: { kind: 'unread', reason: 'Retired by objectstack#7176, as `striped`.' },
  requiredPermissions: { kind: 'unread', reason: 'The ADR-0066 audience gate `@objectstack/spec` 18 adds to a list view (objectui#12030). The SERVER enforces it before the view is served: a user who lacks the capabilities is never listed the view and is refused it by name, so nothing on the ListView path has a value to consume.' },
  virtualScroll: { kind: 'unread', reason: 'Retired by objectstack#7176, as `striped`.' },
  filterableFields: { kind: 'unread', reason: 'Retired by objectstack#24640 (maintainer ruling C, pulled into 18.0): no per-view Filter-panel whitelist replaces it. objectui#13118 removed its one reader, the whitelist branch of `ListView`\'s Filter-panel field list, and this relay\'s rung with it. Present only as the spec import that carries its tombstone from the pin bump that takes the retirement.' },
  responsive: { kind: 'unread', reason: 'Imported from the spec by reference; no objectui renderer reads it.' },
  performance: { kind: 'unread', reason: 'Imported from the spec by reference; no objectui renderer reads it.' },
  pageName: { kind: 'unread', reason: 'Page-context key with no reader on the list path.' },
  tabs: { kind: 'unread', reason: "Spec view-tab list. ListView has no reader — the object page's tab bar is `ViewTabBar`, driven by `buildViewTabs`, and the `tabs` readers in the tree belong to `plugin-detail`'s DetailView." },
  dataSource: { kind: 'unread', reason: "The spec's per-element binding (declared on the list-view arm by objectui#11070). `ListView` has no read of `schema.dataSource`: the binding is resolved one layer up, by the registered `list-view` renderer `ListViewBlock` through `ElementDataSourceGate`, and `renderListView` bypasses that layer. It renders `ListView` directly with `schema={fullSchema}` and takes the ADAPTER as its separate `dataSource` argument (`ds`), not off the node." },

  // ── Read off the view until objectui#11013; no producer writes them ───────
  // Ruling 甲 on objectstack#20051, stage ii: a stored view row is read by the
  // spec's declared spellings, and a read that nothing writes is dropped. These
  // eight had rungs; no console surface writes one onto a view, no view in this
  // repository authors one, and the spec's view schema refuses each by name.
  // The two `ListView` still reads get the HOST's value: `plugin-view` composes
  // each off the object-view node (`(schema as any).KEY`, objectui#5097), and
  // it arrives through `...listSchema`. The other six feed no reader at all.
  allowExport: { kind: 'node-authored', reason: "objectui#11013 dropped the view rung (no producer; the spec refuses it on a view, and the seat's disposition on objectstack#20456 is no declared spelling). `ListView` gates export on `schema.allowExport !== false`, and that value is the object-view node's, composed upstream as `(schema as any).allowExport`." },
  wrapHeaders: { kind: 'node-authored', reason: 'objectui#11013 dropped the view rung: no producer writes it onto a view, and the spec refuses it there. `ListView` still hands `schema.wrapHeaders` to the grid; the value is the object-view node\'s, composed upstream as `(schema as any).wrapHeaders`.' },
  clickIntoRecordDetails: { kind: 'unread', reason: 'objectui#11013 dropped the view rung: no producer writes it onto a view, the spec refuses it there, and ListView has no reader to relay it into. Row-click behaviour is `navigation`, which is relayed.' },
  addRecordViaForm: { kind: 'unread', reason: 'objectui#11013 dropped the view rung: no producer writes it onto a view, the spec refuses it there, and ListView has no reader. Record creation is `addRecord` / `userActions.addRecordForm`.' },
  addDeleteRecordsInline: { kind: 'unread', reason: 'objectui#11013 dropped the view rung: no producer writes it onto a view, the spec refuses it there, and ListView has no reader to relay it into.' },
  collapseAllByDefault: { kind: 'unread', reason: 'objectui#11013 dropped the view rung: no producer writes it onto a view, the spec refuses it there, and ListView has no reader to relay it into.' },
  fieldTextColor: { kind: 'unread', reason: 'objectui#11013 dropped the view rung: no producer writes it onto a view, the spec refuses it there, and ListView has no reader to relay it into.' },
  prefixField: { kind: 'unread', reason: 'objectui#11013 dropped the view rung: no producer writes it onto a view, the spec refuses it there, and ListView has no reader to relay it into.' },

  // ── Authored on the NODE, resolved by the host ────────────────────────────
  operations: { kind: 'node-authored', reason:"Legacy CRUD affordance authored on the object-view node (`examples/.../object-view-record-surface.json`), not on a view record; the host resolves it upstream (`schema.operations || schema.table?.operations || …`). ListView does read `schema.operations?.export`, but what would feed it here is the NODE's value, and forwarding it is the caller's composition to make — objectui#5097's surface, not a per-view rung." },

  // ── The runtime-only half of the intersection ─────────────────────────────
  onNavigate: { kind: 'host-runtime', reason: 'Host callback. This host wires record navigation through the `onRowClick` prop on the `<ListView>` element instead; a view record cannot carry a function.' },
  refreshTrigger: { kind: 'host-runtime', reason: 'Host refresh counter, supplied by the caller; not view metadata.' },
  // ⭐ objectui#7804 declared these three on `ListViewRuntimeProps`, so they
  // entered this census's population with that slice and owe an answer here.
  // All three are host callbacks `ListView` reads off its PROPS bag; this host
  // supplies none of them and a view RECORD cannot carry a function, so there is
  // no rung to add — the absence is the whole of their contract on this path.
  onAddRecord: { kind: 'host-runtime', reason: 'Host callback for the toolbar "+ New" affordance. This host routes record creation through its own action layer rather than through ListView, and a view record cannot carry a function.' },
  onBulkAction: { kind: 'host-runtime', reason: 'Host callback for non-delete bulk actions. This host wires bulk delete through the `onBulkDelete` prop on the `<ListView>` element and offers no other bulk action here; a view record cannot carry a function.' },
  onPageSizeChange: { kind: 'host-runtime', reason: 'Host callback for the pager\'s page-size select. This host lets ListView keep page size as session state rather than persisting it, the same posture as `onFilterChange` (objectui#4155); a view record cannot carry a function.' },
};

// ---------------------------------------------------------------------------
// 6. THE WRITE DIRECTION — keys the relay writes that the target does not declare.
//
// The card assumed the compiler covers this half ("the compiler checks that each
// key this literal WRITES is a legal member"). It does not: `BaseSchema` is
// `.passthrough()`, so the mirror admits unknown keys and `z.input` of it carries
// an index signature — excess-property checking is disarmed on the literal. So
// the write side gets a ledger too, and a typo'd rung shows up here as an
// undeclared key rather than as nothing at all.
// ---------------------------------------------------------------------------

const WRITE_EXCEPTIONS: Record<string, string> = {
  quickFilters: "Deliberate suppression, ADR-0047 (amended, objectui#2338): quick-filter pills are page-surface and stay off the object's default list. Written as an explicit `undefined` so the suppression is visible at the literal rather than being an absence — and it is not a `ListViewSchema` member at all (`quickFilters` is a `GanttConfig` key), so `undefined` here is the whole of its contract.",
  showViewSwitcher: "Declared on `ObjectViewSchema`, not on `ListViewSchema`; `ListView` reads it off the schema as a prop fallback (`propSchema?.showViewSwitcher`). ADR-0047 has the host stamp it when `appearance.allowedVisualizations` whitelists more than one type (objectui#7547).",
  rowActionDefs: 'Resolved `ActionDef` records derived from `objectDef.actions`, read by ListView through `(schema as any).rowActionDefs`. Declared on the data-table surface rather than on `ListViewSchema`; the upstream composition writes the same key.',
  columnState: 'Persisted column order/widths, read by ListView as `schema.columnState` and hydrated into the child grid. Undeclared on both sides — it is host/runtime state, not authored view metadata.',
  onSortChange: 'Callback. ⚠️ Measured: ListView reads only `schema.onDensityChange` and `schema.onNavigate` off the schema; this one it takes as a PROP, and the `<ListView>` element below passes an identical handler. The schema copy is a duplicate, kept because it costs nothing and its absence would read as a removed rung.',
  onHiddenFieldsChange: 'Callback, same shape as `onSortChange` — read as a prop, passed as one too.',
  onColumnStateChange: 'Callback, same shape as `onSortChange` — read as a prop, passed as one too.',
};

// ===========================================================================
// THE CHECKS
// ===========================================================================

describe('objectui#7559 — the population is derived, never written down', () => {
  it('re-derives the member set from the zod mirror and `ListViewRuntimeProps`', () => {
    // No count is asserted (the card's "47" was three different numbers under
    // three readings). What must hold is that the derivation FOUND something:
    // an empty population would make every assertion below vacuously true.
    expect(MIRROR_MEMBERS.length).toBeGreaterThan(50);
    expect(RUNTIME_MEMBERS).toEqual(expect.arrayContaining(['onNavigate', 'onDensityChange', 'refreshTrigger']));
    expect(MEMBERS).toEqual(expect.arrayContaining(['description', 'rowColor', 'fieldOrder', 'columns']));
  });

  it('re-derives the relay rung set from the literal, and finds it reading the active view', () => {
    expect(WRITTEN.length).toBeGreaterThan(40);
    expect(RELAYED.length).toBeGreaterThan(30);
    // The nested paths are part of the reading, so the derivation must reach them.
    expect(WRITTEN.map((w) => w.path)).toEqual(expect.arrayContaining(['options.kanban', 'options.chart']));
  });

  it('collects view-derived locals from the relay callback only', () => {
    // `calendarOptions` is the one the reading needs (`options.calendar` is
    // written from it). `lane` is a local of `kanbanViewOptions`, further down
    // the file, whose own parameter is also called `viewDef` — it must NOT be
    // here, or the census would accept an unrelated local as the view's value.
    expect(VIEW_DERIVED_LOCALS).toContain('calendarOptions');
    expect(VIEW_DERIVED_LOCALS).not.toContain('lane');
  });

  it('re-derives the upstream composition, so "the caller supplies it" is measured', () => {
    expect(UPSTREAM.map((w) => w.path)).toEqual(expect.arrayContaining(['columns', 'grouping']));
  });

  it('the reader probe answers both ways on known keys', () => {
    // Without this control, every `unread` declaration would pass against a
    // probe that answers "no" to everything.
    expect(listViewReads('fieldOrder')).toBe(true);
    expect(listViewReads('zzNotARealKey')).toBe(false);
  });
});

describe('objectui#7559 — every `ListViewSchema` member has a rung or a declared absence', () => {
  it('leaves NO member both unrelayed and undeclared', () => {
    const undeclared = MEMBERS.filter((m) => !RELAYED.includes(m) && !(m in ABSENCES));
    expect(
      undeclared,
      'A `ListViewSchema` member is neither relayed by the `fullSchema` literal nor declared in\n'
      + '`ABSENCES` above. That is the silence objectui#7559 exists to end: the value an author\n'
      + 'writes on the view cannot reach `ListView`, and nothing errors.\n'
      + '\n'
      + 'Two legitimate fixes, and one that is not:\n'
      + '  1. ADD THE RUNG — `key: viewDef.key ?? listSchema.key` — if the view should carry it.\n'
      + '  2. DECLARE THE ABSENCE with a `kind` and a real reason, if it should not.\n'
      + '  ⛔ 3. NOT: deleting the member from the census, or widening this expectation.\n'
      + '\n'
      + 'If the member is new on `ListViewSchema`, (1) or (2) is owed BY THE CHANGE THAT ADDED IT.',
    ).toEqual([]);
  });

  it('objectui#7199 — the per-view `description` rung is present', () => {
    // The first instance of the class. It is named here, not left to the
    // property above, because this is the case a reader looks for when asking
    // "would the census have caught it?" — and the ablation that proves the
    // census can fail removes exactly this rung.
    expect(
      readsView(writtenAt('description')),
      "The `description` rung is gone. A per-view description is authored, validated, built and\n"
      + 'served, then silently dropped — objectui#7199, exactly. Restore\n'
      + '`description: viewDef.description ?? listSchema.description`.',
    ).toBe(true);
  });

  it('objectui#7218 — the per-view `rowColor` rung is present', () => {
    expect(
      readsView(writtenAt('rowColor')),
      'The `rowColor` rung is gone — objectui#7218, the second instance of the same class.\n'
      + 'Restore `rowColor: viewDef.rowColor ?? listSchema.rowColor`. ⚠️ Not `userActions.rowColor`,\n'
      + 'which is the permission toggle sharing the name at another nesting level.',
    ).toBe(true);
  });

  it('objectui#7516 — the per-view `fieldOrder` rung is present', () => {
    // The third instance, carried in `ABSENCES` as a `known-gap` until its card
    // added the rung. The ledger row is gone, so without this rung the key
    // would be neither relayed nor declared and the property above would name
    // it — but the instance is named here too, as the other two are.
    expect(
      readsView(writtenAt('fieldOrder')),
      'The `fieldOrder` rung is gone — objectui#7516, the third instance of the same class.\n'
      + '`ListView` still orders its columns by `schema.fieldOrder`, so a per-view order is\n'
      + 'authored, served and then silently dropped. Restore\n'
      + '`fieldOrder: viewDef.fieldOrder ?? listSchema.fieldOrder` beside the `hiddenFields` rung.',
    ).toBe(true);
    expect(listViewReads('fieldOrder')).toBe(true);
  });

  it('a member with a rung that does NOT read the active view is not counted as relayed', () => {
    // The reading, asserted rather than described: `...listSchema` carries the
    // host's value and cannot stand in for the view's. This is what made all
    // three defects invisible — the screen was never blank, it showed the
    // object-level value.
    const spreadOnly = WRITTEN.find((w) => w.path === 'label');
    expect(spreadOnly?.reads).toContain('viewDef');
    expect(RELAYED.every((m) => readsView(writtenAt(m)))).toBe(true);
  });
});

describe('objectui#7559 — a declared absence keeps its evidence', () => {
  const entries = Object.entries(ABSENCES);

  it('declares nothing that is not a member (a stale entry is a rotting census)', () => {
    const notMembers = entries.map(([key]) => key).filter((key) => !MEMBERS.includes(key));
    expect(
      notMembers,
      'An `ABSENCES` entry names something that is no longer a `ListViewSchema` member. The member\n'
      + 'was renamed or removed; delete the entry in the same change rather than leaving the census\n'
      + 'answering questions nobody asks.',
    ).toEqual([]);
  });

  it('declares nothing that IS relayed (an absence that came back is not an absence)', () => {
    const contradicted = entries.map(([key]) => key).filter((key) => RELAYED.includes(key));
    expect(
      contradicted,
      'An `ABSENCES` entry names a member that now HAS a rung reading `viewDef`. Someone added the\n'
      + 'rung and left the declaration behind, so the census still says the key is deliberately not\n'
      + 'carried while the code carries it. Delete the entry.',
    ).toEqual([]);
  });

  it('gives every entry a reason with actual content', () => {
    for (const [key, absence] of entries) {
      expect(absence.reason.length, `\`${key}\` is declared with a stub reason.`).toBeGreaterThan(40);
    }
  });

  it('`relayed-nested`: the named path exists in the literal and reads the view', () => {
    for (const [key, absence] of entries) {
      if (absence.kind !== 'relayed-nested') continue;
      const written = writtenAt(absence.path);
      expect(written, `\`${key}\` is declared relayed at \`${absence.path}\`, which the literal does not write.`).toBeDefined();
      expect(
        readsView(written),
        `\`${key}\` is declared relayed at \`${absence.path}\`, but that property does not read \`viewDef\` —\n`
        + "so the view's value does not reach ListView through it after all.",
      ).toBe(true);
    }
  });

  it('`relayed-upstream`: the caller still composes the key from the active view', () => {
    for (const [key, absence] of entries) {
      if (absence.kind !== 'relayed-upstream') continue;
      const written = upstreamAt(key);
      expect(
        written,
        `\`${key}\` is declared as supplied by plugin-view's \`renderListView\` composition, which no\n`
        + 'longer writes it. The key now reaches ListView from nowhere: either the caller must carry\n'
        + 'it again, or this relay owes it a rung.',
      ).toBeDefined();
      for (const ident of absence.upstreamReads) {
        expect(
          written!.reads,
          `\`${key}\` is declared as composed upstream from \`${ident}\`, which its upstream value no\n`
          + 'longer reads.',
        ).toContain(ident);
      }
    }
  });

  it('`legacy-alias`: the canonical member is itself carried', () => {
    for (const [key, absence] of entries) {
      if (absence.kind !== 'legacy-alias') continue;
      const canonicalCovered = RELAYED.includes(absence.canonical)
        || (ABSENCES[absence.canonical] && ABSENCES[absence.canonical].kind === 'relayed-upstream');
      expect(
        canonicalCovered,
        `\`${key}\` is declared a legacy alias of \`${absence.canonical}\`, but the canonical key is not\n`
        + 'carried either. An alias declaration is only an answer while its canonical twin is one.',
      ).toBe(true);
      if (absence.mentions) {
        expect(
          writtenAt(absence.canonical)?.text ?? '',
          `\`${key}\`'s fold is declared to happen in the \`${absence.canonical}\` rung through\n`
          + `\`${absence.mentions}\`, which that rung no longer calls.`,
        ).toContain(absence.mentions);
      }
    }
  });

  it('`node-level`: the key really is `BaseSchema` node vocabulary', () => {
    // Derived, not trusted: the node half of the member set is whatever
    // `BaseSchema` contributes, and this asserts each entry sits in it. A
    // per-view key mis-filed here would be an absence hidden behind a class.
    const baseKeys = Object.keys(
      (BaseNodeMirror as unknown as { shape: Record<string, unknown> }).shape,
    );
    for (const [key, absence] of entries) {
      if (absence.kind !== 'node-level') continue;
      expect(
        baseKeys,
        `\`${key}\` is filed as \`BaseSchema\` node vocabulary, and \`BaseSchema\` does not declare it —\n`
        + 'so it is a list-view key wearing a class exemption that does not cover it.',
      ).toContain(key);
      expect(
        RELAYED,
        `\`${key}\` is filed as node vocabulary but the literal now relays it from the view.`,
      ).not.toContain(key);
    }
  });

  it('`unread`: ListView still has no reader for the key', () => {
    for (const [key, absence] of entries) {
      if (absence.kind !== 'unread') continue;
      expect(
        listViewReads(key),
        `\`${key}\` is declared "nothing reads it", and \`ListView\` now reads it off its schema.\n`
        + 'The declaration has flipped into the objectui#7516 shape: a reader waiting for a value no\n'
        + 'rung carries. Re-read the entry — it is now either a rung or a `known-gap` with a card.',
      ).toBe(false);
    }
  });

  it('`known-gap`: the reader that makes it a gap is still there, and the card is named', () => {
    for (const [key, absence] of entries) {
      if (absence.kind !== 'known-gap') continue;
      expect(absence.card, `\`${key}\` is declared a known gap with no card.`).toMatch(/#\d+/);
      expect(
        listViewReads(key),
        `\`${key}\` is declared a known gap — a reader waiting for a value — and \`ListView\` no longer\n`
        + 'reads it. Either the reader moved (re-point this entry) or the gap closed (delete it).',
      ).toBe(true);
    }
  });

  it('`node-authored`: the key has a reader, and the relay still does not carry it', () => {
    for (const [key, absence] of entries) {
      if (absence.kind !== 'node-authored') continue;
      expect(RELAYED).not.toContain(key);
      expect(
        listViewReads(key),
        `\`${key}\` is declared as node-authored surface whose reader is fed from the node path, and\n`
        + 'that reader is gone. Re-read the entry.',
      ).toBe(true);
    }
  });

  it('`host-runtime`: the key is a `ListViewRuntimeProps` member, never authorable', () => {
    for (const [key, absence] of entries) {
      if (absence.kind !== 'host-runtime') continue;
      expect(
        RUNTIME_MEMBERS,
        `\`${key}\` is declared a non-serialisable host prop, but it is not a member of\n`
        + '`ListViewRuntimeProps` — so it IS serialisable view metadata and needs a real answer.',
      ).toContain(key);
    }
  });

  it('CONTROL: a correctly declared absence is not a finding', () => {
    // ⭐ The other half of the ablation, and deliberately NOT a restatement of
    // the property above: this case asserts only that a DECLARED absence stays
    // out of the finding set, so it survives an ablation elsewhere in the
    // literal. A control that reddens whenever anything else reddens says
    // nothing — and the first person to see it red would delete it.
    //
    // `operations` is a real, reader-having absence (`ListView` reads it, and
    // the relay deliberately does not carry it — `node-authored`, objectui#5097's
    // surface) and `quickFilters` is the deliberate suppression the card itself
    // named. Neither is a failure, and neither may become one. (This control
    // used `fieldOrder` until objectui#7516 gave that key its rung.)
    const findings = MEMBERS.filter((m) => !RELAYED.includes(m) && !(m in ABSENCES));
    expect(MEMBERS).toContain('operations');
    expect(RELAYED).not.toContain('operations');
    expect(listViewReads('operations')).toBe(true);
    expect(findings).not.toContain('operations');

    expect(MEMBERS).not.toContain('quickFilters');
    expect(WRITTEN_TOP).toContain('quickFilters');
    expect(Object.keys(WRITE_EXCEPTIONS)).toContain('quickFilters');
  });
});

describe('objectui#7559 — the write direction, which the compiler does not cover', () => {
  it('the target type admits unknown keys, so an undeclared rung is not a type error', () => {
    // The ground for the ledger below, measured rather than assumed: the mirror
    // is `.passthrough()` (via `BaseSchema`), so it keeps a key it never
    // declared — and `z.input` of a passthrough object carries the index
    // signature that disarms excess-property checking on the literal.
    const parsed = ListViewMirror.safeParse({
      type: 'list-view',
      objectName: 'task',
      zzNotAMemberOfListViewSchema: 1,
    });
    expect(parsed.success).toBe(true);
    expect(
      parsed.success && parsed.data,
      'The mirror now rejects (or strips) unknown keys. That is a real contract change: the write\n'
      + 'direction of this relay may now be compiler-checked, and `WRITE_EXCEPTIONS` should be\n'
      + 're-read — several of its entries exist only because it was not.',
    ).toHaveProperty('zzNotAMemberOfListViewSchema');
  });

  it('every key the relay writes is a member or a declared exception', () => {
    const undeclared = WRITTEN_TOP.filter((key) => !MEMBERS.includes(key) && !(key in WRITE_EXCEPTIONS));
    expect(
      undeclared,
      'The `fullSchema` literal writes a key that `ListViewSchema` does not declare and\n'
      + '`WRITE_EXCEPTIONS` does not explain. Most likely a typo — which is invisible to tsc here,\n'
      + 'because the target type admits unknown keys (the assertion above). If the key is real,\n'
      + 'declare it with the reason it is written into a type that does not carry it.',
    ).toEqual([]);
  });

  it('declares no write exception that has become a real member', () => {
    const stale = Object.keys(WRITE_EXCEPTIONS).filter((key) => MEMBERS.includes(key));
    expect(
      stale,
      '`WRITE_EXCEPTIONS` names a key that is now a declared `ListViewSchema` member. The exception\n'
      + 'is spent: delete it, and let the member-side census cover the key.',
    ).toEqual([]);
  });
});

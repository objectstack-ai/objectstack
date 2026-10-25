// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11572 — THE INTERFACE PAGE RELAY CENSUS.
 *
 * `InterfaceListPage` does not hand `ListView` a stored view. It builds ONE list
 * schema itself, in the object literal its `schema` memo returns, out of three
 * sources: the page config (`interfaceConfig`), the view its deprecated
 * `sourceView` resolves to, and defaults derived from the object. A member
 * `ListView` reads that this literal never writes is not a type error (the
 * view is `any`), not a lint finding and not a test failure. It is silence,
 * and the silence produced the same defect twice: objectui#10638
 * (`hiddenFields` / `fieldOrder`) and objectui#11572 (`tree` / `chart`, and the
 * page's own `allowPrinting`).
 *
 * This file is that family's closing pin. The triage ruling: "Every view-level
 * member `ListView` reads is either relayed or named as deliberately not
 * relayed, with its reason. A newly read member that is neither turns the pin
 * red." So:
 *
 *   POPULATION — derived, never listed. Every top-level member `ListView.tsx`
 *     reads off its list schema, found by the TypeScript parser (so a comment
 *     that names a key is never counted). See §1 for the exact reading,
 *     including how the schema may escape whole and what that does to it.
 *
 *   RELAYED — the literal writes the member, and the written value reads the
 *     source view: the identifier `viewDef`, or a local computed from it, to
 *     any depth (`view`, `appearance`, `allowed`, `kanban`, …).
 *
 *   ANSWERED — every other member has an entry in `NOT_RELAYED` below with a
 *     `kind` and a `reason`. Each `kind` carries MECHANICAL evidence, checked
 *     in §5, so a declaration cannot quietly become false: `page-owned` must
 *     still be written from the page config, `not-inherited` must still be a
 *     key the spec lets a stored view carry and the page config does not, and
 *     so on.
 *
 * ## Where the line is drawn, and why (the spec, not this file's taste)
 *
 * `@objectstack/spec`'s `InterfacePageConfigSchema` describes `sourceView` as
 * "@deprecated Back-compat only. Pre-revision pages inherited
 * columns/filter/sort from a named object view; new pages define
 * columns/sort/filterBy directly." The page config is where a page states its
 * own policy (`userActions`, `addRecord`, `recordAction`, `showRecordCount`,
 * `allowPrinting`, …). So a member is relayed from the view when it is part of
 * that inherited data (the column composition, filter, sort), or when it is a
 * visualization binding the page whitelists and has no slot for (`kanban`,
 * `tree`, `chart`, …). A spec view key outside both, with no page slot, is
 * `not-inherited`: the page does not take it from a reference the spec
 * deprecates. ⚠️ The literal also relays view members outside that line:
 * `grouping`, `rowColor`, `pagination` and `searchableFields`, and the view's
 * `appearance` and `emptyState` as the page's fallbacks (the page's own
 * `emptyState` wins since objectui#12270). They predate this
 * census, which counts them as relayed and neither retires nor extends them;
 * the census below, not this sentence, is what says which members are relayed.
 *
 * ## The fold is a boundary, not a second population
 *
 * `ListView` runs its schema through `normalizeListViewSchema` (`@object-ui/core`)
 * before it reads anything. That fold reads LEGACY spellings (`fields`,
 * `densityMode`, `filters`, the bare `show*` flags, …) and writes the
 * canonical members `ListView.tsx` then reads, which are in the population. A
 * relay writes canonical members only (AGENTS.md #0.1), so the fold's
 * legacy-only inputs are not relay targets. The write-direction check in §5
 * keeps the literal from writing one.
 *
 * ## What this file does NOT do
 *
 * ⛔ It does not relay anything. It finds absences and keeps them declared.
 * ⛔ It does not touch `ListView.tsx` or the object page; it only READS sources.
 * ⛔ It asserts no count. Counts drift by construction; the property holds.
 * The object page's own census is `ObjectView.relayRungCensus-7559.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  InterfacePageConfigSchema,
  ListViewSchema as SpecListViewSchema,
} from '@objectstack/spec/ui';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

const LIST_VIEW_FILE = 'packages/plugin-list/src/ListView.tsx';
const RELAY_FILE = 'packages/app-shell/src/views/InterfaceListPage.tsx';

const parse = (rel: string): ts.SourceFile =>
  ts.createSourceFile(
    rel,
    readFileSync(path.join(repoRoot, rel), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

const LIST_VIEW_SF = parse(LIST_VIEW_FILE);
const RELAY_SF = parse(RELAY_FILE);

/** Where a node sits, for a diagnostic computed at run time (never stored). */
const where = (sf: ts.SourceFile, node: ts.Node): string =>
  `${sf.fileName}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1} \`${node
    .getText()
    .replace(/\s+/g, ' ')
    .slice(0, 90)}\``;

const isWrapper = (node: ts.Node): node is
  | ts.ParenthesizedExpression
  | ts.AsExpression
  | ts.NonNullExpression
  | ts.TypeAssertion
  | ts.SatisfiesExpression =>
  ts.isParenthesizedExpression(node)
  || ts.isAsExpression(node)
  || ts.isNonNullExpression(node)
  || ts.isTypeAssertionExpression(node)
  || ts.isSatisfiesExpression(node);

/** The identifier, climbed out of `( … )`, `as`, `!` and `satisfies` wrappers. */
const climb = (node: ts.Node): ts.Node => {
  let top = node;
  while (top.parent && isWrapper(top.parent) && top.parent.expression === top) top = top.parent;
  return top;
};

// ---------------------------------------------------------------------------
// 1. THE POPULATION — every top-level member `ListView.tsx` reads off its schema.
//
// The schema's names in that file are `propSchema` (the prop, as received) and
// `schema` (the same value after the fold, plus the parameter of each helper
// the component hands it to). Every reference to either name is one of:
//
//   - a READ of a member: `schema.X`, `schema?.X`, `(schema as any).X`,
//     `schema['X']`, or a destructuring `const { X } = schema`;
//   - an ESCAPE of the whole value. An escape is where a read could hide, so
//     each must be accounted for, and only three shapes are:
//       · an argument to a function declared in `ListView.tsx` whose parameter
//         in that position is itself named `schema` — its reads are then already
//         in this scan (`resolveListChartBinding`, `resolveListMapConfig`,
//         `resolveTimelineDateBinding`);
//       · the fold, `normalizeListViewSchema(propSchema)` (see the header);
//       · a hook dependency list, which reads identity only.
//     Any other escape — a child `schema={schema}`, `const s = schema`, a
//     spread, a helper with a differently named parameter — fails §5 by name,
//     because the members read behind it would be invisible to this census.
//
// Over-inclusion fails loud, never silent: a future `schema` binding that is
// not the list schema would add members needing answers (red), not hide any.
// ---------------------------------------------------------------------------

const SCHEMA_NAMES = new Set(['schema', 'propSchema']);
const HOOKS = new Set(['useMemo', 'useEffect', 'useLayoutEffect', 'useCallback', 'useImperativeHandle']);
const FOLD = 'normalizeListViewSchema';

/** Parameter names of every function declared in a file, by function name. */
const functionParams = (sf: ts.SourceFile): Map<string, string[]> => {
  const out = new Map<string, string[]>();
  const names = (params: ts.NodeArray<ts.ParameterDeclaration>): string[] =>
    params.map((p) => (ts.isIdentifier(p.name) ? p.name.text : ''));
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) out.set(node.name.text, names(node.parameters));
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      out.set(node.name.text, names(node.initializer.parameters));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
};

const calleeName = (call: ts.CallExpression): string | undefined => {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
};

interface Escape {
  shape: 'helper' | 'fold' | 'deps' | 'unaccounted';
  at: string;
}

/** The §1 reading, as one function — run on `ListView.tsx`, and on a fixture as its own control. */
const scanSchemaReads = (sf: ts.SourceFile): { reads: Map<string, number>; escapes: Escape[] } => {
  const reads = new Map<string, number>();
  const escapes: Escape[] = [];
  const params = functionParams(sf);
  const addRead = (member: string): void => {
    reads.set(member, (reads.get(member) ?? 0) + 1);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && SCHEMA_NAMES.has(node.text)) {
      const top = climb(node);
      const p = top.parent;
      const isName =
        (ts.isParameter(p) && p.name === node)
        || (ts.isVariableDeclaration(p) && p.name === node)
        || (ts.isBindingElement(p) && (p.name === node || p.propertyName === node))
        || (ts.isPropertySignature(p) && p.name === node)
        || (ts.isPropertyAssignment(p) && p.name === node)
        || (ts.isJsxAttribute(p) && p.name === node)
        || (ts.isPropertyAccessExpression(p) && p.name === node);
      if (isName) {
        // A declaration, a key or a member NAME — not a reference to the value.
      } else if (ts.isPropertyAccessExpression(p) && p.expression === top) {
        addRead(p.name.text);
      } else if (
        ts.isElementAccessExpression(p)
        && p.expression === top
        && ts.isStringLiteralLike(p.argumentExpression)
      ) {
        addRead(p.argumentExpression.text);
      } else if (
        ts.isVariableDeclaration(p)
        && p.initializer === top
        && ts.isObjectBindingPattern(p.name)
        && p.name.elements.every((e) => !e.dotDotDotToken)
      ) {
        for (const e of p.name.elements) {
          const key = e.propertyName ?? e.name;
          if (ts.isIdentifier(key) || ts.isStringLiteral(key)) addRead(key.text);
        }
      } else if (ts.isCallExpression(p) && p.arguments.includes(top as ts.Expression)) {
        const name = calleeName(p);
        const index = p.arguments.indexOf(top as ts.Expression);
        if (name === FOLD && node.text === 'propSchema') {
          escapes.push({ shape: 'fold', at: where(sf, p) });
        } else if (name && SCHEMA_NAMES.has(params.get(name)?.[index] ?? '')) {
          escapes.push({ shape: 'helper', at: where(sf, p) });
        } else {
          escapes.push({ shape: 'unaccounted', at: where(sf, p) });
        }
      } else if (
        ts.isArrayLiteralExpression(p)
        && ts.isCallExpression(p.parent)
        && p.parent.arguments[1] === p
        && HOOKS.has(calleeName(p.parent) ?? '')
      ) {
        escapes.push({ shape: 'deps', at: where(sf, p.parent.expression) });
      } else {
        escapes.push({ shape: 'unaccounted', at: where(sf, p ?? node) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { reads, escapes };
};

const { reads: READS, escapes: ESCAPES } = scanSchemaReads(LIST_VIEW_SF);

const POPULATION: string[] = [...READS.keys()].sort();

// ---------------------------------------------------------------------------
// 2. THE RELAY — what the `schema` memo's literal writes, and what each value reads.
// ---------------------------------------------------------------------------

/** References in an expression: identifiers that NAME a value, not a member or a type. */
const refsOf = (root: ts.Node): { refs: Set<string>; members: Set<string> } => {
  const refs = new Set<string>();
  const members = new Set<string>();
  const walk = (node: ts.Node): void => {
    if (ts.isTypeNode(node)) return;
    if (ts.isIdentifier(node)) {
      const p = node.parent;
      if (ts.isPropertyAccessExpression(p) && p.name === node) members.add(node.text);
      else if (ts.isPropertyAssignment(p) && p.name === node) { /* a key */ }
      else if ((ts.isParameter(p) || ts.isBindingElement(p)) && p.name === node) { /* a binding */ }
      else refs.add(node.text);
    }
    ts.forEachChild(node, walk);
  };
  walk(root);
  return { refs, members };
};

/** The arrow function the `const schema = React.useMemo(() => { … })` in `InterfaceListPage` runs. */
const RELAY_CALLBACK: ts.ArrowFunction = (() => {
  let found: ts.ArrowFunction | undefined;
  const visit = (node: ts.Node): void => {
    if (
      !found
      && ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === 'schema'
      && node.initializer
      && ts.isCallExpression(node.initializer)
      && calleeName(node.initializer) === 'useMemo'
      && node.initializer.arguments[0]
      && ts.isArrowFunction(node.initializer.arguments[0])
    ) {
      found = node.initializer.arguments[0] as ts.ArrowFunction;
    }
    ts.forEachChild(node, visit);
  };
  visit(RELAY_SF);
  if (!found) {
    throw new Error(
      'objectui#11572 census cannot find `const schema = React.useMemo(() => { … })` in\n'
      + `${RELAY_FILE}. The census anchors on that name. If the memo was renamed or moved,\n`
      + 're-point this anchor; ⛔ do not delete the census, which is the only thing standing\n'
      + 'between a dropped key and silence (objectui#10638, objectui#11572).',
    );
  }
  return found;
})();

/** The one object literal the callback returns: the schema `ListView` receives. */
const RELAY_LITERAL: ts.ObjectLiteralExpression = (() => {
  const literals: ts.ObjectLiteralExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== RELAY_CALLBACK && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) {
      let expr: ts.Node = node.expression;
      while (isWrapper(expr)) expr = expr.expression;
      if (ts.isObjectLiteralExpression(expr)) literals.push(expr);
    }
    ts.forEachChild(node, visit);
  };
  visit(RELAY_CALLBACK);
  if (literals.length !== 1) {
    throw new Error(
      `objectui#11572 census expected the schema memo to return exactly one object literal, found ${literals.length}.`,
    );
  }
  return literals[0];
})();

interface Written {
  refs: Set<string>;
  members: Set<string>;
  /** The value node(s) — kept so a kind can inspect the expression itself. */
  values: ts.Node[];
}

/** Top-level keys the literal writes. A conditional spread of an object literal writes its keys here. */
const WRITTEN: Map<string, Written> = (() => {
  const out = new Map<string, Written>();
  const record = (key: string, value: ts.Node, refs: Set<string>, members: Set<string>): void => {
    const prior = out.get(key);
    if (prior) {
      refs.forEach((r) => prior.refs.add(r));
      members.forEach((m) => prior.members.add(m));
      prior.values.push(value);
    } else {
      out.set(key, { refs: new Set(refs), members: new Set(members), values: [value] });
    }
  };
  const handle = (obj: ts.ObjectLiteralExpression): void => {
    for (const property of obj.properties) {
      if (ts.isSpreadAssignment(property)) {
        // `...(cond ? { tree: view.tree } : {})` writes `tree` at THIS level.
        // Only the OUTERMOST literals of the spread count; a literal nested in
        // one of their values belongs to that value, not to this level.
        const outer: ts.ObjectLiteralExpression[] = [];
        const walk = (node: ts.Node): void => {
          if (ts.isObjectLiteralExpression(node)) { outer.push(node); return; }
          ts.forEachChild(node, walk);
        };
        walk(property.expression);
        outer.forEach(handle);
        continue;
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        record(property.name.text, property, new Set([property.name.text]), new Set());
        continue;
      }
      if (ts.isPropertyAssignment(property)) {
        const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null;
        if (!name) continue;
        const { refs, members } = refsOf(property.initializer);
        record(name, property.initializer, refs, members);
      }
    }
  };
  handle(RELAY_LITERAL);
  return out;
})();

/**
 * Locals derived, to any depth, from a root identifier — declared inside the
 * memo's callback. `view = viewDef || {}`, then `appearance` reads `view`,
 * `allowed` reads `appearance`, and so on: each carries the source view's value
 * as directly as a rung naming `viewDef` would.
 */
const CALLBACK_DECLS: Array<{ name: string; refs: Set<string> }> = (() => {
  const out: Array<{ name: string; refs: Set<string> }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      out.push({ name: node.name.text, refs: refsOf(node.initializer).refs });
    }
    ts.forEachChild(node, visit);
  };
  visit(RELAY_CALLBACK);
  return out;
})();

const derivedFrom = (root: string): Set<string> => {
  const set = new Set([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const decl of CALLBACK_DECLS) {
      if (!set.has(decl.name) && [...decl.refs].some((r) => set.has(r))) {
        set.add(decl.name);
        grew = true;
      }
    }
  }
  return set;
};

const VIEW_DERIVED = derivedFrom('viewDef');
const PAGE_DERIVED = derivedFrom('cfg');

const readsAny = (w: Written | undefined, set: Set<string>): boolean => !!w && [...w.refs].some((r) => set.has(r));
const readsView = (member: string): boolean => readsAny(WRITTEN.get(member), VIEW_DERIVED);

const RELAYED: string[] = POPULATION.filter(readsView);

// ---------------------------------------------------------------------------
// 3. WHAT ELSE THE PAGE SAYS — facts the ledger's evidence is checked against.
// ---------------------------------------------------------------------------

/** Member names read off an identifier anywhere in `InterfaceListPage.tsx` (`cfg.X`, `page.X`). */
const membersReadOff = (ident: string): Set<string> => {
  const out = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) {
      let inner: ts.Node = node.expression;
      while (isWrapper(inner)) inner = inner.expression;
      if (ts.isIdentifier(inner) && inner.text === ident) out.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(RELAY_SF);
  return out;
};

const CFG_READS = membersReadOff('cfg');
const PAGE_READS = membersReadOff('page');

/** Attributes on the `<ListView …>` element this page renders. */
const LIST_VIEW_PROPS: Set<string> = (() => {
  const out = new Set<string>();
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText() === 'ListView') {
      for (const attr of node.attributes.properties) {
        if (ts.isJsxAttribute(attr)) out.add(attr.name.getText());
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(RELAY_SF);
  return out;
})();

/** Keys a stored view row may carry: the spec's list view, which is closed (`strictObject`). */
const SPEC_VIEW_KEYS = new Set(Object.keys((SpecListViewSchema as unknown as { shape: object }).shape));
/** Keys the page itself declares. */
const PAGE_CONFIG_KEYS = new Set(Object.keys((InterfacePageConfigSchema as unknown as { shape: object }).shape));

// ---------------------------------------------------------------------------
// 4. THE LEDGER — every member that is not relayed from the view, answered.
//
// ⛔ This is NOT the census. The census is the population above, re-derived on
// every run. This is the set of ANSWERS, and each is admitted only while its
// evidence holds (§5).
// ---------------------------------------------------------------------------

type NotRelayed =
  /** Written from the page config's key `from`; the view's copy does not stand in. */
  | { kind: 'page-owned'; from: string; reason: string }
  /** The page config's `from` decides it, wired through the `<ListView>` prop `prop` instead. */
  | { kind: 'page-prop'; from: string; prop: string; reason: string }
  /** The page's own data binding (`from`) decides it; a view may not rebind the page. */
  | { kind: 'page-binding'; from: string; reason: string }
  /** The page renders its own `page.<pageKey>` for this role, in its header. */
  | { kind: 'page-text'; pageKey: string; reason: string }
  /** Written as a fixed literal: a policy of this surface, not a value from anywhere. */
  | { kind: 'page-constant'; reason: string }
  /** Feeds an affordance this surface closes; `gate` is written `false`. */
  | { kind: 'closed-surface'; gate: string; reason: string }
  /** A spec view key outside the deprecated `sourceView` fallback, with no page slot. */
  | { kind: 'not-inherited'; reason: string }
  /** Not a key the spec lets a stored view row carry, so no view can supply it. */
  | { kind: 'off-spec'; reason: string }
  /** A host callback or counter; a stored record cannot carry it. */
  | { kind: 'host-runtime'; reason: string };

const NOT_RELAYED: Record<string, NotRelayed> = {
  // ── The page config states it (ADR-0047: the page layer owns presentation) ──
  addRecord: { kind: 'page-owned', from: 'addRecord', reason: "The page config's add-record entry point. The page states its own; the referenced view's would add a button the page author never configured." },
  showRecordCount: { kind: 'page-owned', from: 'showRecordCount', reason: "The page config's record-count toggle, page presentation policy; the referenced view's toggle does not stand in for it." },
  allowPrinting: { kind: 'page-owned', from: 'allowPrinting', reason: "The page config's \"Allow users to print the page\". It went unwritten until objectui#11572, so the declared toggle drew no print button; the page's value only, like its siblings." },
  userActions: { kind: 'page-owned', from: 'userActions', reason: "The page config's toolbar toggles, with interface-mode defaults (closed unless opted in, #2890). The view's toolbar vocabulary is the object page's policy, not this page's." },
  inlineEdit: { kind: 'page-owned', from: 'userActions', reason: "Read from the page's `userActions.editInline` (default on since objectstack#22605; `editInline: false` opts out). Whether this page's cells are editable is the page author's decision, not the referenced view's." },
  navigation: { kind: 'page-prop', from: 'recordAction', prop: 'onRowClick', reason: "The page config's `recordAction` (drawer / page / modal / none) decides how a record opens, wired through `onRowClick` to this page's own overlay. The view's `navigation` would be a second, competing answer." },

  // ── The page's own binding and text ──────────────────────────────────────
  objectName: { kind: 'page-binding', from: 'source', reason: "The object this page binds is its `source`, resolved to `objectDef`. A view is a lens on an object; it may not rebind which object the page shows." },
  data: { kind: 'page-binding', from: 'source', reason: "The spec's per-view data provider. This page binds its data through `source`; a view's provider (an `api` read, say) would rebind the page's data behind the page author's back." },
  label: { kind: 'page-text', pageKey: 'label', reason: "`ListView` uses it for its own record-detail title and the export filename. This page titles its header and its record overlay with `page.label`, and export is closed here." },
  description: { kind: 'page-text', pageKey: 'description', reason: "This page renders `page.description` under its title. A view's caveat relayed into the list would put a second description, about a different thing, on the same page." },

  // ── Fixed policy of this surface ─────────────────────────────────────────
  allowExport: { kind: 'page-constant', reason: 'Export is off on an interface page (ADR-0047: the surface is closed by default), written as a literal. The spec refuses `allowExport` on a view by name, so no view could supply it anyway.' },
  exportOptions: { kind: 'closed-surface', gate: 'allowExport', reason: 'Export formats feed an export button this surface never draws (`allowExport: false`), so there is nothing for the view\'s options to configure.' },

  // ── Spec view keys the deprecated fallback does not carry ───────────────
  // The spec scopes `sourceView` to "columns/filter/sort", and the page config
  // declares none of these. Each also has a page-layer reason of its own.
  aria: { kind: 'not-inherited', reason: "Accessible naming of the list region. The page owns the region it renders; the referenced view's label would name the region after a view the page only borrows columns from." },
  compactToolbar: { kind: 'not-inherited', reason: 'Toolbar layout. The toolbar on this surface is page policy (`userActions`, closed by default), and the page config has no compact-toolbar key to set.' },
  conditionalFormatting: { kind: 'not-inherited', reason: "Row styling rules, outside the spec's columns/filter/sort inheritance. ⚠️ `rowColor` IS relayed: a pre-existing relay outside the line, recorded in this file's header and not extended here." },
  // `filterableFields` was answered here (`not-inherited`) until objectui#13118:
  // the spec retires it (objectstack#24640, ruling C) and `ListView` reads it
  // no longer, so it left the population and its entry left with it.
  resizable: { kind: 'not-inherited', reason: 'Column-resize chrome on the grid. This page persists only its column order, as its own `columns`, and takes no other column chrome from the view.' },
  rowHeight: { kind: 'not-inherited', reason: "Row density. Whether users may change density is the page's `userActions.rowHeight`; the starting density is not part of the spec's columns/filter/sort inheritance, and the page config has no density key." },
  selection: { kind: 'not-inherited', reason: "Row selection mode, which exists to feed bulk actions. Actions on this surface are the page's `buttons`, so there is no bulk affordance for a selection to drive." },
  rowActions: { kind: 'not-inherited', reason: "Per-row action names. Actions on this surface are the page config's `buttons`, object actions the page author chose (ADR-0047); the view's action set is the object page's." },
  bulkActions: { kind: 'not-inherited', reason: "Selection-bar action names. Actions on this surface are the page config's `buttons`; the view's bulk actions are the object page's." },
  bulkActionDefs: { kind: 'not-inherited', reason: "Selection-bar action definitions, the resolved twin of `bulkActions`. Not taken here for the same reason: the page's actions are its `buttons`." },
  sharing: { kind: 'not-inherited', reason: "The stored view record's own visibility, shown as a badge. The audience of THIS page is the page's; a badge describing the referenced view's sharing would mislabel it." },

  // ── Keys a stored view row cannot carry ─────────────────────────────────
  groupBy: { kind: 'off-spec', reason: "An objectui shorthand for the primary group. The spec's view refuses it by name; its grouping key is `grouping`, which IS relayed." },
  groupBy2: { kind: 'off-spec', reason: "An objectui shorthand for a secondary group, refused on a spec view like `groupBy`. Grouping travels as `grouping`, relayed." },
  columnState: { kind: 'off-spec', reason: "The object page's persisted column widths and order. The spec's view refuses it by name; this page persists its column order as its own `columns` instead." },
  wrapHeaders: { kind: 'off-spec', reason: "A renderer flag authored on the object-view node (objectui#11013). The spec's view refuses it by name, so no stored view supplies it." },
  operations: { kind: 'off-spec', reason: 'A legacy CRUD affordance authored on the object-view node, not on a view; the spec has no such view key. Export, its one read here, is closed on this surface.' },
  rowActionDefs: { kind: 'off-spec', reason: "Row action definitions the object page composes from `objectDef.actions`; not a spec view key. This page's actions are its `buttons`." },
  id: { kind: 'off-spec', reason: "The node's own id, used by `ListView` to key its storage. A spec view is named by `name`, not `id`; there is nothing for a view to relay into it." },

  // ── Host runtime ─────────────────────────────────────────────────────────
  onDensityChange: { kind: 'host-runtime', reason: 'Host callback the object page uses to persist density onto its view. This page persists no density, and a stored record cannot carry a function.' },
  onNavigate: { kind: 'host-runtime', reason: 'Host callback. This page wires record opening through the `onRowClick` prop instead, and a stored record cannot carry a function.' },
  refreshTrigger: { kind: 'host-runtime', reason: 'Host refresh counter, supplied by whoever renders the list; not metadata a view or a page config states.' },
};

// ---------------------------------------------------------------------------
// 5. THE CHECKS
// ---------------------------------------------------------------------------

describe('objectui#11572 — the population is derived, never written down', () => {
  it('re-derives the members `ListView` reads, and finds them', () => {
    // No count is asserted; what must hold is that the derivation FOUND
    // something, or every check below would be vacuously true. These are
    // members the file plainly reads, through each read shape: a plain access,
    // an `as any` cast, a helper that takes the schema whole, the prop alias.
    expect(POPULATION).toEqual(
      expect.arrayContaining(['columns', 'kanban', 'tree', 'chart', 'grouping', 'rowColor', 'pagination', 'options', 'showViewSwitcher']),
    );
  });

  it('the reading answers both ways: the §1 scan, run on a fixture, sees code and not prose, and flags an unfollowable escape', () => {
    // Without this control, a scan that answered nothing (or everything) would
    // pass every check below. The fixture exercises each shape §1 names.
    const fixture = ts.createSourceFile(
      'fixture.tsx',
      [
        '// schema.ghostInComment is prose, and must not count',
        'function helper(schema: any) { return schema.viaHelper; }',
        'function other(cfg: any) { return cfg.hidden; }',
        'export const C = ({ schema: propSchema }: any) => {',
        '  const schema = React.useMemo(() => normalizeListViewSchema(propSchema), [propSchema]);',
        '  const { destructured } = schema;',
        "  const a = (schema as any).cast ?? schema?.optional ?? schema['quoted'];",
        '  helper(schema);',
        '  other(schema);',
        '  return <Child schema={schema} />;',
        '};',
      ].join('\n'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const { reads, escapes } = scanSchemaReads(fixture);
    expect([...reads.keys()].sort()).toEqual(['cast', 'destructured', 'optional', 'quoted', 'viaHelper']);
    expect(escapes.map((e) => e.shape).sort()).toEqual(['deps', 'fold', 'helper', 'unaccounted', 'unaccounted']);
    // The two that must fail: a helper whose parameter is not named `schema`
    // (its reads are invisible here), and a child handed the schema whole.
    const unaccounted = escapes.filter((e) => e.shape === 'unaccounted').map((e) => e.at);
    expect(unaccounted.some((at) => at.includes('other(schema)'))).toBe(true);
    expect(unaccounted.some((at) => at.includes('{schema}'))).toBe(true);
  });

  it('accounts for every place the schema escapes whole, so no read hides behind one', () => {
    const unaccounted = ESCAPES.filter((e) => e.shape === 'unaccounted').map((e) => e.at);
    expect(
      unaccounted,
      'The list schema leaves `ListView.tsx` whole somewhere this census cannot follow. Whatever\n'
      + 'is read behind it is invisible to the population, so the pin would stay green over a\n'
      + 'dropped key. Read the member at the call site, name the receiving parameter `schema`\n'
      + 'so its reads join this scan, or extend §1 to follow the new shape.',
    ).toEqual([]);
    // The three accounted shapes are all present today; if one vanishes the
    // reading above still holds, but this records what the reading relied on.
    expect(ESCAPES.some((e) => e.shape === 'fold')).toBe(true);
    expect(ESCAPES.some((e) => e.shape === 'helper')).toBe(true);
  });

  it('re-derives the relay literal, and finds it reading both the view and the page', () => {
    expect([...WRITTEN.keys()]).toEqual(expect.arrayContaining(['columns', 'kanban', 'options', 'userActions']));
    expect([...VIEW_DERIVED]).toEqual(expect.arrayContaining(['view', 'appearance', 'allowed', 'kanban', 'columns']));
    // `userActions` is the page's, and must not be taken for the view's.
    expect([...PAGE_DERIVED]).toContain('userActions');
    expect(VIEW_DERIVED.has('userActions')).toBe(false);
  });
});

describe('objectui#11572 — every member `ListView` reads is relayed or answered', () => {
  it('leaves NO member both unrelayed and unanswered', () => {
    const silent = POPULATION.filter((m) => !RELAYED.includes(m) && !(m in NOT_RELAYED));
    expect(
      silent,
      '`ListView` reads a member that `InterfaceListPage` neither relays from its source view nor\n'
      + 'answers in `NOT_RELAYED`. That is the silence objectui#10638 and objectui#11572 were: the\n'
      + 'value is declared, served, and dropped at this page with nothing erroring.\n'
      + '\n'
      + 'Two legitimate fixes, and one that is not:\n'
      + '  1. RELAY IT — write the key in the schema memo from `view` (or the page config).\n'
      + '  2. ANSWER IT — a `NOT_RELAYED` entry whose `kind` evidence holds and whose reason is real.\n'
      + '  ⛔ 3. NOT: an entry written only to make this green when the honest answer is (1).\n'
      + '\n'
      + 'If `ListView` started reading the member just now, the change that added the read owes it.',
    ).toEqual([]);
  });

  it("objectui#11572 — the view's declared `tree` and `chart` blocks are relayed", () => {
    for (const member of ['tree', 'chart']) {
      expect(
        readsView(member),
        `The \`${member}\` relay is gone. A whitelisted ${member} reaches \`ListView\` with no block, so its\n`
        + 'binding is dropped and one stored view renders two ways (objectui#11572). Restore\n'
        + `\`...(view.${member} !== undefined ? { ${member}: view.${member} } : {})\`.`,
      ).toBe(true);
    }
  });

  it("objectui#10638 — the view's `hiddenFields` and `fieldOrder` are relayed", () => {
    for (const member of ['hiddenFields', 'fieldOrder']) {
      expect(readsView(member), `The \`${member}\` relay is gone — objectui#10638.`).toBe(true);
    }
  });

  it('writes nothing the renderer does not read, bar the node discriminator (the write direction)', () => {
    // A typo'd or legacy key in the literal is not a type error either: the
    // view is `any`. So a written key must be a member `ListView` reads.
    const WRITE_EXCEPTIONS: Record<string, string> = {
      type: "The node's component discriminator (`'list-view'`). `ListView.tsx` does not read it; the registry routes on it, and the fold reads a view kind there only when `viewType` is absent.",
    };
    const stray = [...WRITTEN.keys()].filter((k) => !POPULATION.includes(k) && !(k in WRITE_EXCEPTIONS));
    expect(
      stray,
      'The schema memo writes a key `ListView` does not read. It is a typo, a legacy spelling the\n'
      + 'fold exists to retire (AGENTS.md #0.1), or a value with no consumer. Fix the key or remove it.',
    ).toEqual([]);
  });
});

describe('objectui#11572 — an answer keeps its evidence', () => {
  const entries = Object.entries(NOT_RELAYED);

  it('answers nothing `ListView` no longer reads (a stale entry is a rotting census)', () => {
    const stale = entries.map(([k]) => k).filter((k) => !POPULATION.includes(k));
    expect(stale, '`ListView` no longer reads these. Delete their entries in the same change.').toEqual([]);
  });

  it('answers nothing that IS relayed (an absence that came back is not an absence)', () => {
    const contradicted = entries.map(([k]) => k).filter((k) => RELAYED.includes(k));
    expect(contradicted, 'These now have a rung reading the view. Delete their entries.').toEqual([]);
  });

  it('gives every entry a reason with actual content', () => {
    for (const [key, answer] of entries) {
      expect(answer.reason.length, `\`${key}\` is answered with a stub reason.`).toBeGreaterThan(40);
    }
  });

  it('`page-owned`: still written, from the page config key it names', () => {
    for (const [key, a] of entries) {
      if (a.kind !== 'page-owned') continue;
      const w = WRITTEN.get(key);
      expect(w, `\`${key}\` is answered page-owned, but the schema memo no longer writes it.`).toBeDefined();
      expect(PAGE_CONFIG_KEYS.has(a.from), `\`${key}\` names page key \`${a.from}\`, which the page config does not declare.`).toBe(true);
      expect(readsAny(w, PAGE_DERIVED), `\`${key}\` no longer reads the page config.`).toBe(true);
      expect(
        w!.refs.has(a.from) || w!.members.has(a.from),
        `\`${key}\` is answered as written from the page's \`${a.from}\`, which its value no longer names.`,
      ).toBe(true);
    }
  });

  it('`page-prop`: the page reads its config key and wires the named `<ListView>` prop', () => {
    for (const [key, a] of entries) {
      if (a.kind !== 'page-prop') continue;
      expect(WRITTEN.has(key), `\`${key}\` is now written by the memo; re-answer it.`).toBe(false);
      expect(PAGE_CONFIG_KEYS.has(a.from) && CFG_READS.has(a.from), `\`${key}\`: the page no longer reads \`cfg.${a.from}\`.`).toBe(true);
      expect(LIST_VIEW_PROPS.has(a.prop), `\`${key}\`: the \`<ListView>\` element no longer carries \`${a.prop}\`.`).toBe(true);
    }
  });

  it('`page-binding`: the page still binds through its config key', () => {
    for (const [key, a] of entries) {
      if (a.kind !== 'page-binding') continue;
      expect(PAGE_CONFIG_KEYS.has(a.from) && CFG_READS.has(a.from), `\`${key}\`: the page no longer binds through \`cfg.${a.from}\`.`).toBe(true);
    }
  });

  it('`page-text`: the page still renders its own text for the role', () => {
    for (const [key, a] of entries) {
      if (a.kind !== 'page-text') continue;
      expect(WRITTEN.has(key), `\`${key}\` is now written by the memo; re-answer it.`).toBe(false);
      expect(PAGE_READS.has(a.pageKey), `\`${key}\`: the page no longer reads \`page.${a.pageKey}\`.`).toBe(true);
    }
  });

  it('`page-constant` / `closed-surface`: the policy literal is still written', () => {
    const isFalseLiteral = (member: string): boolean => {
      const w = WRITTEN.get(member);
      return !!w && w.refs.size === 0 && w.values.every((v) => v.kind === ts.SyntaxKind.FalseKeyword);
    };
    for (const [key, a] of entries) {
      if (a.kind === 'page-constant') {
        const w = WRITTEN.get(key);
        expect(w && w.refs.size === 0, `\`${key}\` is no longer a fixed literal on this page.`).toBe(true);
      }
      if (a.kind === 'closed-surface') {
        expect(isFalseLiteral(a.gate), `\`${key}\` relies on \`${a.gate}: false\`, which the page no longer writes.`).toBe(true);
      }
    }
  });

  it('`not-inherited`: a key a stored view may carry, which the page config does not declare', () => {
    for (const [key, a] of entries) {
      if (a.kind !== 'not-inherited') continue;
      expect(SPEC_VIEW_KEYS.has(key), `\`${key}\` is no longer a spec view key; re-answer it.`).toBe(true);
      expect(PAGE_CONFIG_KEYS.has(key), `\`${key}\` is now a page config key — the page owes it a rung from \`cfg\`.`).toBe(false);
      expect(WRITTEN.has(key), `\`${key}\` is now written by the memo; re-answer it.`).toBe(false);
    }
  });

  it('`off-spec` / `host-runtime`: no stored view row can carry the key', () => {
    for (const [key, a] of entries) {
      if (a.kind !== 'off-spec' && a.kind !== 'host-runtime') continue;
      expect(SPEC_VIEW_KEYS.has(key), `\`${key}\` is now a spec view key, so a stored view CAN carry it; re-answer it.`).toBe(false);
      expect(WRITTEN.has(key), `\`${key}\` is now written by the memo; re-answer it.`).toBe(false);
    }
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11583 — THE WRITE-REFUSAL CENSUS over `packages/app-shell/src/views/`.
 *
 * The family: a metadata write under the console's views is refused, the catch
 * logs it, and the UI looks saved. objectui#11578 closed the two Create View
 * doors one at a time; objectui#11583 closed the rest and is the family's
 * closing card. Its ruling (triage `5975148557`), verbatim: "every call under
 * `packages/app-shell/src/views/` to `createRuntimeMetadata`,
 * `persistRuntimeMetadata`, `publishRuntimeMetadata`, `discardRuntimeDraft` or
 * `dataSource.updateView` either surfaces a refusal or is ledgered with its
 * reason. A new write site with no row turns the census red." So:
 *
 *   POPULATION — derived, never listed. Every call, in every non-test source
 *     file under this directory (recursively), whose callee is named by
 *     `WRITE_NAMES` below, or by a `relays` row's symbol, found by the
 *     TypeScript parser, so a comment or doc that names a write is never
 *     counted. The callee is matched by NAME in any spelling: a bare call, a
 *     method call, `?.`, `(x as any).name(…)`. The population is the ruling's
 *     five names plus two of the same family: `deleteView` (`updateView`'s
 *     sibling on the adapter), and any symbol a `relays` row names (a helper
 *     that hands the write's promise back to its callers, whose own calls are
 *     then the rows that answer). It counted a third, `updateViewConfig` (the
 *     toolbar toggles' write, the site triage named beyond the card's table),
 *     until objectui#12504 retired that method and its one call site; its
 *     absence is pinned by `ObjectView.overlayPatchOnly.test.ts`.
 *
 *   SITE KEY — `file › enclosing symbol › callee`, never a line address
 *     (AGENTS.md #11: a stored line number is a ledger key that rots). The
 *     enclosing symbol is the nearest named function: a function declaration,
 *     or a variable whose initializer is a function or wraps one
 *     (`const handlePinView = useCallback(async (…) => …)`).
 *
 *   ANSWERED — every site key has exactly one `LEDGER` row, with the number of
 *     calls under it, and every row matches the tree. Each row's `kind` carries
 *     MECHANICAL evidence, checked below, so a row cannot quietly become false:
 *       `surfaces` — a `toast.error(…)` call sits on the refusal path of the
 *         enclosing symbol (inside a `catch` clause or a `.catch(…)` callback),
 *         and the row names a pin: a test file in this directory that exists
 *         and names the symbol.
 *       `relays` — the write's promise leaves the symbol unswallowed (no
 *         `catch` between the call and the symbol), and the symbol is itself a
 *         census callee, so each of its calls is a row that must answer.
 *
 *   DETACHED — reading an adapter write off its object without calling it
 *     (`const updateView = dataSource.updateView`) is refused outright: it is
 *     how objectui#4463 lost `this`, and a detached write is a call this census
 *     cannot name. So is importing a seam write under another name. `typeof
 *     x.updateView` (a capability probe) is not a read of the write.
 *
 * ⛔ It asserts no total. The ledger's per-row `calls` is a declaration the
 *   tree is compared with, not a reading copied from it: a new call under an
 *   existing row turns it red as surely as a new row would.
 * ⛔ A row that says only "out of scope" is refused: each reason says why.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const VIEWS_DIR = 'packages/app-shell/src/views';

/** The seam's four writes (`runtime-metadata-persistence.ts`). */
const SEAM_WRITES = ['createRuntimeMetadata', 'persistRuntimeMetadata', 'publishRuntimeMetadata', 'discardRuntimeDraft'];
/** The adapter's view writes. */
const ADAPTER_WRITES = ['updateView', 'deleteView'];
const WRITE_NAMES = [...SEAM_WRITES, ...ADAPTER_WRITES];

type Row =
  | { file: string; symbol: string; callee: string; calls: number; kind: 'surfaces'; pin: string; reason: string }
  | { file: string; symbol: string; callee: string; calls: number; kind: 'relays'; reason: string };

/** One row per site key. `file` is relative to `VIEWS_DIR`. */
const LEDGER: Row[] = [
  {
    file: 'ObjectDataPage.tsx', symbol: 'handleSaveAsView', callee: 'createRuntimeMetadata', calls: 1,
    kind: 'surfaces', pin: 'ObjectDataPage.saveAsViewRefusal-11578.test.tsx',
    reason: '"Save as view": the refusal is a toast with the door\'s message, and the dialog stays open (objectui#11578).',
  },
  {
    file: 'ObjectView.tsx', symbol: 'dispatchViewPatches', callee: 'updateView', calls: 1,
    kind: 'relays',
    reason: 'Issues one `updateView` per patch and hands every promise back; set-as-default and reorder await them and answer for the refusal.',
  },
  {
    file: 'ObjectView.tsx', symbol: 'handleViewConfigSave', callee: 'persistRuntimeMetadata', calls: 1,
    kind: 'surfaces', pin: 'ObjectView.viewWriteRefusal-11583.test.tsx',
    reason: 'The view-config panel\'s edit Save: a toast with the door\'s message, and the panel is told the save failed, so it stays dirty (objectui#11583).',
  },
  {
    file: 'ObjectView.tsx', symbol: 'handleViewCreate', callee: 'createRuntimeMetadata', calls: 1,
    kind: 'surfaces', pin: 'ObjectView.createViewRefusal-11578.test.tsx',
    reason: 'Create View: a toast with the door\'s message, and the dialog stays open (objectui#11578).',
  },
  {
    file: 'ObjectView.tsx', symbol: 'handleRenameView', callee: 'updateView', calls: 1,
    kind: 'surfaces', pin: 'ObjectView.viewWriteRefusal-11583.test.tsx',
    reason: 'Rename: the translated `objectViewActions.renameFailed` title, with the door\'s message as the description (objectui#12417).',
  },
  {
    file: 'ObjectView.tsx', symbol: 'handleDeleteView', callee: 'deleteView', calls: 1,
    kind: 'surfaces', pin: 'ObjectView.viewWriteRefusal-11583.test.tsx',
    reason: 'Delete: the translated `objectViewActions.deleteFailed` title, with the door\'s message as the description (objectui#12398).',
  },
  {
    file: 'ObjectView.tsx', symbol: 'handlePinView', callee: 'updateView', calls: 1,
    kind: 'surfaces', pin: 'ObjectView.viewWriteRefusal-11583.test.tsx',
    reason: 'Pin and unpin: a toast with the door\'s message (objectui#11583).',
  },
  {
    file: 'ObjectView.tsx', symbol: 'handleSetDefaultView', callee: 'dispatchViewPatches', calls: 1,
    kind: 'surfaces', pin: 'ObjectView.viewWriteRefusal-11583.test.tsx',
    reason: 'Set as default: a toast with the door\'s message; it was a bare untranslated literal with no description until the objectui#11583 patch round.',
  },
  {
    file: 'ReportView.tsx', symbol: 'saveSchema', callee: 'persistRuntimeMetadata', calls: 1,
    kind: 'surfaces', pin: 'ReportView.saveRefusal-11583.test.tsx',
    reason: 'The report editor\'s Save (once per press, not per edit): a toast with the door\'s message, and the editor is told the save failed, so it stays open with the edit (objectui#11583).',
  },
  {
    file: 'RuntimeDraftBar.tsx', symbol: 'handlePublish', callee: 'publishRuntimeMetadata', calls: 1,
    kind: 'surfaces', pin: 'RuntimeDraftBar.refusal-11583.test.tsx',
    reason: 'Publish: a toast with the door\'s message; the draft stays announced (objectui#11583).',
  },
  {
    file: 'RuntimeDraftBar.tsx', symbol: 'handleDiscard', callee: 'discardRuntimeDraft', calls: 1,
    kind: 'surfaces', pin: 'RuntimeDraftBar.refusal-11583.test.tsx',
    reason: 'Discard draft: a toast with the door\'s message; the draft stays announced (objectui#11583).',
  },
];

const CALLEES = new Set([...WRITE_NAMES, ...LEDGER.filter((r) => r.kind === 'relays').map((r) => r.symbol)]);

const isTestFile = (name: string) => /\.test\.tsx?$/.test(name) || name.endsWith('.d.ts');

/** Every non-test `.ts` / `.tsx` source under `VIEWS_DIR`, relative to it. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const pending = [''];
  while (pending.length > 0) {
    const relDir = pending.shift()!;
    for (const entry of readdirSync(path.join(repoRoot, VIEWS_DIR, relDir)).sort()) {
      const rel = relDir ? `${relDir}/${entry}` : entry;
      if (statSync(path.join(repoRoot, VIEWS_DIR, rel)).isDirectory()) {
        if (entry !== '__tests__' && entry !== 'node_modules') pending.push(rel);
      } else if (/\.tsx?$/.test(entry) && !isTestFile(entry)) {
        out.push(rel);
      }
    }
  }
  return out;
}

const parse = (rel: string): ts.SourceFile =>
  ts.createSourceFile(
    rel,
    readFileSync(path.join(repoRoot, VIEWS_DIR, rel), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

/** Where a node sits, for a diagnostic computed at run time (never stored). */
const where = (sf: ts.SourceFile, node: ts.Node): string =>
  `${VIEWS_DIR}/${sf.fileName}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1} \`${node
    .getText()
    .replace(/\s+/g, ' ')
    .slice(0, 90)}\``;

const isFunctionNode = (node: ts.Node): boolean =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node);

/** A variable initializer that is a function, or a call that wraps one (`useCallback(fn, deps)`). */
const isFunctionInitializer = (init: ts.Expression | undefined): boolean =>
  !!init && (isFunctionNode(init) || (ts.isCallExpression(init) && init.arguments.some(isFunctionNode)));

/** The nearest named function enclosing `node`: its name, and the node that bounds it. */
function enclosingSymbol(node: ts.Node): { name: string; scope: ts.Node } | undefined {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) return { name: n.name.getText(), scope: n };
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && isFunctionInitializer(n.initializer)) {
      return { name: n.name.text, scope: n };
    }
  }
  return undefined;
}

/** The callee's name, in any spelling: `f(…)`, `o.f(…)`, `o?.f(…)`, `(o as any).f(…)`. */
function calleeName(call: ts.CallExpression): string | undefined {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
}

/** Whether `node` sits on a refusal path below `scope`: a `catch` clause, or a `.catch(…)` callback. */
function onRefusalPath(node: ts.Node, scope: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n && n !== scope; n = n.parent) {
    if (ts.isCatchClause(n)) return true;
    if (
      isFunctionNode(n)
      && n.parent
      && ts.isCallExpression(n.parent)
      && ts.isPropertyAccessExpression(n.parent.expression)
      && n.parent.expression.name.text === 'catch'
    ) return true;
  }
  return false;
}

/** Whether a rejection of `call` is caught between it and `scope`. */
function caughtBelow(call: ts.Node, scope: ts.Node): boolean {
  for (let n: ts.Node | undefined = call.parent; n && n !== scope; n = n.parent) {
    if (ts.isTryStatement(n) && n.catchClause) return true;
    if (
      ts.isPropertyAccessExpression(n)
      && n.name.text === 'catch'
      && n.parent
      && ts.isCallExpression(n.parent)
      && n.parent.expression === n
    ) return true;
  }
  return false;
}

/** Every `toast.error(…)` call under `scope`. */
function toastErrors(scope: ts.Node): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isCallExpression(n)
      && ts.isPropertyAccessExpression(n.expression)
      && n.expression.name.text === 'error'
      && ts.isIdentifier(n.expression.expression)
      && n.expression.expression.text === 'toast'
    ) out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(scope);
  return out;
}

interface Site { key: string; file: string; symbol: string; callee: string; scope: ts.Node; node: ts.CallExpression; sf: ts.SourceFile }

const FILES = sourceFiles();
const SITES: Site[] = [];
const DETACHED: string[] = [];
const ORPHANS: string[] = [];

for (const rel of FILES) {
  const sf = parse(rel);
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = calleeName(node);
      if (callee && CALLEES.has(callee)) {
        const owner = enclosingSymbol(node);
        if (!owner) ORPHANS.push(where(sf, node));
        else {
          SITES.push({
            key: `${rel} › ${owner.name} › ${callee}`,
            file: rel, symbol: owner.name, callee, scope: owner.scope, node, sf,
          });
        }
      }
    }
    // An adapter write read off its object as a value that escapes: stored,
    // assigned, passed or returned. A probe (`typeof o.updateView`,
    // `!o?.deleteView`) reads no write and is not this.
    if (ts.isPropertyAccessExpression(node) && ADAPTER_WRITES.includes(node.name.text)) {
      let up: ts.Node = node;
      while (
        up.parent
        && (ts.isParenthesizedExpression(up.parent) || ts.isNonNullExpression(up.parent) || ts.isAsExpression(up.parent))
      ) up = up.parent;
      const p = up.parent;
      const escapes =
        (ts.isVariableDeclaration(p) && p.initializer === up)
        || (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.right === up)
        || (ts.isCallExpression(p) && p.arguments.includes(up as ts.Expression))
        || (ts.isPropertyAssignment(p) && p.initializer === up)
        || ts.isReturnStatement(p)
        || ts.isArrayLiteralExpression(p)
        || (ts.isArrowFunction(p) && p.body === up);
      if (escapes) DETACHED.push(where(sf, node));
    }
    // An adapter write destructured off its object.
    if (ts.isBindingElement(node)) {
      const key = (node.propertyName ?? node.name).getText();
      if (ADAPTER_WRITES.includes(key)) DETACHED.push(where(sf, node));
    }
    // A seam write imported under another name.
    if (ts.isImportSpecifier(node) && node.propertyName && SEAM_WRITES.includes(node.propertyName.getText())) {
      DETACHED.push(where(sf, node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

const rowKey = (r: Row) => `${r.file} › ${r.symbol} › ${r.callee}`;
const ROWS = new Map(LEDGER.map((r) => [rowKey(r), r]));

describe('the write-refusal census over app-shell views (objectui#11583)', () => {
  it('the census reads a real population (non-vacuity)', () => {
    expect(FILES.length).toBeGreaterThan(0);
    expect(LEDGER.length).toBeGreaterThan(0);
    // Every write name the ruling enumerates resolves to a call somewhere, so
    // a parser that matched nothing could not pass the row checks below.
    for (const name of SEAM_WRITES) expect(SITES.some((s) => s.callee === name), name).toBe(true);
    expect(SITES.some((s) => s.callee === 'updateView'), 'updateView').toBe(true);
  });

  it('every write site has a ledger row: a new site with no row is red', () => {
    const unanswered = [...new Set(SITES.filter((s) => !ROWS.has(s.key)).map((s) => `${s.key}  (${where(s.sf, s.node)})`))];
    expect(
      unanswered,
      'A metadata write under app-shell views with no LEDGER row. Raise its refusal through `toast.error` with '
        + '`formatMetadataError` (objectui#11583), then add a `surfaces` row naming its pin.',
    ).toEqual([]);
    expect(ORPHANS, 'A write outside any named function: name the handler, so the census can key it.').toEqual([]);
  });

  it('every ledger row matches the tree, call for call: no stale or under-counted row', () => {
    const drift = LEDGER.flatMap((r) => {
      const found = SITES.filter((s) => s.key === rowKey(r)).length;
      return found === r.calls ? [] : [`${rowKey(r)}: the ledger declares ${r.calls} call(s), the tree has ${found}`];
    });
    expect(drift).toEqual([]);
    expect(LEDGER.length, 'one row per site key').toBe(ROWS.size);
  });

  it('every row carries a reason, and none is only "out of scope"', () => {
    for (const r of LEDGER) {
      expect(r.reason.trim().length, rowKey(r)).toBeGreaterThan(20);
      expect(r.reason, rowKey(r)).not.toMatch(/^\s*out of scope\W*$/i);
    }
  });

  it('a `surfaces` row raises `toast.error` on the refusal path, and names a pin that names it', () => {
    const findings: string[] = [];
    for (const r of LEDGER) {
      if (r.kind !== 'surfaces') continue;
      const site = SITES.find((s) => s.key === rowKey(r));
      if (!site) continue; // the drift check above already reds a missing site
      if (!toastErrors(site.scope).some((call) => onRefusalPath(call, site.scope))) {
        findings.push(`${rowKey(r)}: no \`toast.error\` inside a catch of \`${r.symbol}\` (${where(site.sf, site.node)})`);
      }
      const pin = path.join(repoRoot, VIEWS_DIR, r.pin);
      if (!existsSync(pin)) findings.push(`${rowKey(r)}: pin ${r.pin} does not exist`);
      else if (!readFileSync(pin, 'utf8').includes(r.symbol)) findings.push(`${rowKey(r)}: pin ${r.pin} never names ${r.symbol}`);
    }
    expect(findings).toEqual([]);
  });

  it('a `relays` row hands the write back unswallowed, and its own calls are census rows', () => {
    const findings: string[] = [];
    for (const r of LEDGER) {
      if (r.kind !== 'relays') continue;
      for (const site of SITES.filter((s) => s.key === rowKey(r))) {
        if (caughtBelow(site.node, site.scope)) findings.push(`${rowKey(r)}: the write is caught inside ${r.symbol}`);
      }
      if (!SITES.some((s) => s.callee === r.symbol)) findings.push(`${r.symbol}: relays to no caller the census sees`);
    }
    expect(findings).toEqual([]);
  });

  it('no adapter write is detached, and no seam write is imported under another name', () => {
    expect(
      DETACHED,
      'A write read off its object, destructured, or renamed is a call this census cannot see '
        + '(and a detached adapter method loses `this`, objectui#4463). Call it as a method.',
    ).toEqual([]);
  });
});

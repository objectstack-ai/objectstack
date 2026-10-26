// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `DatasourcePreview` reads no key `DatasourceSchema` rejects (objectui#4131).
 *
 * This is the third time one file has drifted the same way. objectui#3275
 * deleted three reads (`d.type`, `isDefault ?? default`, the `Array.isArray`
 * capabilities branch); objectui#3143 deleted the read-replica pill; and
 * objectui#4131 deleted the `Retry Policy` / `Health Check` SideBlocks and the
 * `Capabilities` chip strip after objectstack#4583 removed all three key groups
 * from a `.strict()` `DatasourceSchema`. That last one sat in `main` for eight
 * days: the schema moved in the framework repo, and nothing here noticed.
 *
 * Nothing here could notice, because the two halves of the contract were only
 * ever compared by a human reading both. So this file compares them
 * mechanically, and it does so by DERIVING both sides — neither is written down
 * as a list that can go stale next to the thing it describes:
 *
 *  • the READ set comes from `DatasourcePreview.tsx`'s own AST — every key
 *    reached off the `draft` prop, however it is spelled (`d.pool`, `d?.pool`,
 *    `d['pool']`, `const { pool } = d`);
 *  • the ACCEPTED set comes from the schema object itself (`.keyof()`), so a
 *    key added or removed in `@objectstack/spec` moves this test with it on the
 *    next dependency bump.
 *
 * The AST matters rather than a grep: this preview's header comment names
 * `d.retryPolicy`, `d.healthCheck`, `d.capabilities` and `d.type` in prose, to
 * record why they are gone. A text scan of the file reports four violations
 * that do not exist; the compiler sees a comment.
 *
 * Two things the pin deliberately also asserts about ITSELF, because a
 * derivation that quietly returns nothing would pass the subset check forever:
 * that it still finds this file's known reads (`live file, non-vacuity`), and
 * that every mention of the draft binding is a read form it understands, so it
 * fails loudly instead of going blind if the preview is refactored into a shape
 * it cannot follow.
 *
 * Scope note: this is a TOP-LEVEL key pin, matching what `.strict()` rejects by
 * name on the datasource document. It says nothing about nested value shapes.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { DatasourceSchema } from '@objectstack/spec/data';

const PREVIEW_PATH = fileURLToPath(new URL('./DatasourcePreview.tsx', import.meta.url));
const PREVIEW_SOURCE = readFileSync(PREVIEW_PATH, 'utf8');

/** A draft key the preview reads, with the 1-based line it was read on. */
interface DraftRead {
  key: string;
  line: number;
}

interface Derivation {
  /** Local names that hold the draft object (`draft`, and aliases of it). */
  bindings: Set<string>;
  reads: DraftRead[];
  /**
   * Uses of a draft binding this walker could NOT resolve to a key read —
   * e.g. the whole object handed to a helper. Non-empty means the derivation
   * has a blind spot and the subset check below is no longer complete.
   */
  opaqueUses: { text: string; line: number }[];
}

/** Peel `(x)`, `x!`, `x as T`, `x satisfies T` down to the value underneath. */
function unwrap(node: ts.Expression): ts.Expression {
  let cur = node;
  for (;;) {
    if (ts.isParenthesizedExpression(cur) || ts.isNonNullExpression(cur)) cur = cur.expression;
    else if (ts.isAsExpression(cur) || ts.isSatisfiesExpression(cur)) cur = cur.expression;
    else return cur;
  }
}

function propertyNameText(name: ts.PropertyName | undefined): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return undefined;
}

/**
 * The draft keys a preview module reads, derived from its source.
 *
 * Seeded from the component's `draft` prop (by name, so a destructuring rename
 * is followed too), extended across simple aliases (`const d = draft as …`),
 * then every property/element access and destructure off one of those bindings
 * is collected.
 */
function deriveDraftReads(source: string, fileName = 'DatasourcePreview.tsx'): Derivation {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lineOf = (node: ts.Node): number =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  const bindings = new Set<string>();

  // Seed: the `draft` prop, however the component destructures it.
  const seed = (node: ts.Node): void => {
    if (ts.isParameter(node)) {
      if (ts.isIdentifier(node.name) && node.name.text === 'draft') bindings.add('draft');
      else if (ts.isObjectBindingPattern(node.name)) {
        for (const el of node.name.elements) {
          const from = propertyNameText(el.propertyName) ?? propertyNameText(el.name as ts.PropertyName);
          if (from === 'draft' && ts.isIdentifier(el.name)) bindings.add(el.name.text);
        }
      }
    }
    ts.forEachChild(node, seed);
  };
  seed(sf);

  // Aliases: `const d = draft as Record<string, unknown>` — to a fixpoint, so a
  // chain of aliases is followed rather than only the first hop.
  const aliasDecls = new Set<ts.Node>();
  for (let pass = 0; pass < 8; pass++) {
    const before = bindings.size;
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
        const init = unwrap(node.initializer);
        if (ts.isIdentifier(init) && bindings.has(init.text)) {
          bindings.add(node.name.text);
          aliasDecls.add(init);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    if (bindings.size === before) break;
  }

  const reads: DraftRead[] = [];
  const accounted = new Set<ts.Node>(aliasDecls);

  const collect = (node: ts.Node): void => {
    // `d.pool`, `d?.pool`
    if (ts.isPropertyAccessExpression(node)) {
      const target = unwrap(node.expression);
      if (ts.isIdentifier(target) && bindings.has(target.text)) {
        accounted.add(target);
        if (ts.isIdentifier(node.name)) reads.push({ key: node.name.text, line: lineOf(node) });
      }
    }
    // `d['pool']`
    if (ts.isElementAccessExpression(node)) {
      const target = unwrap(node.expression);
      if (ts.isIdentifier(target) && bindings.has(target.text)) {
        accounted.add(target);
        const arg = unwrap(node.argumentExpression);
        if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
          reads.push({ key: arg.text, line: lineOf(node) });
        } else {
          // A computed key cannot be derived — record it as a blind spot
          // rather than silently dropping it.
          reads.push({ key: `<computed:${arg.getText(sf)}>`, line: lineOf(node) });
        }
      }
    }
    // `const { pool, ssl: tls } = d`
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isObjectBindingPattern(node.name)) {
      const init = unwrap(node.initializer);
      if (ts.isIdentifier(init) && bindings.has(init.text)) {
        accounted.add(init);
        for (const el of node.name.elements) {
          const key = propertyNameText(el.propertyName) ?? propertyNameText(el.name as ts.PropertyName);
          if (key) reads.push({ key, line: lineOf(el) });
        }
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);

  // Anything left over is a use of the draft this walker cannot see through.
  const opaqueUses: { text: string; line: number }[] = [];
  const audit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && bindings.has(node.text) && !accounted.has(node)) {
      const p = node.parent;
      const isDeclarationName =
        (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p)) && p.name === node;
      const isPropertyName = ts.isPropertyAccessExpression(p) && p.name === node;
      const isBindingPropertyName = ts.isBindingElement(p) && p.propertyName === node;
      if (!isDeclarationName && !isPropertyName && !isBindingPropertyName) {
        opaqueUses.push({ text: `${node.text} (in ${ts.SyntaxKind[p.kind]})`, line: lineOf(node) });
      }
    }
    ts.forEachChild(node, audit);
  };
  audit(sf);

  return { bindings, reads, opaqueUses };
}

/** Every top-level key `DatasourceSchema` declares, from the schema itself. */
function acceptedKeys(): Set<string> {
  const keyof = (DatasourceSchema as { keyof?: () => { options: string[] } }).keyof;
  if (typeof keyof === 'function') return new Set(DatasourceSchema.keyof().options);
  return new Set(Object.keys(DatasourceSchema.shape));
}

/** A datasource draft that parses clean — the control for the strictness probe. */
const DECLARED_ONLY_DRAFT = {
  name: 'warehouse',
  label: 'Analytics Warehouse',
  description: 'Read-only Postgres replica for reporting.',
  driver: 'postgres',
  active: true,
  ssl: { enabled: true, rejectUnauthorized: true },
  config: { host: 'db.internal', port: 5432, database: 'analytics' },
  pool: { min: 2, max: 10 },
} satisfies Record<string, unknown>;

function rejectedKeysIn(draft: Record<string, unknown>): string[] {
  const parsed = DatasourceSchema.safeParse(draft);
  if (parsed.success) return [];
  return parsed.error.issues.flatMap((issue) =>
    issue.code === 'unrecognized_keys' ? ((issue as { keys: string[] }).keys ?? []) : [],
  );
}

describe('DatasourceSchema is the strict contract this pin leans on', () => {
  it('accepts a draft of declared keys only', () => {
    const parsed = DatasourceSchema.safeParse(DECLARED_ONLY_DRAFT);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });

  it('rejects an undeclared key BY NAME — the pin is meaningless without this', () => {
    // Scanner control, in the shape objectui#4131's triage used: the accepted
    // draft above is the same object plus one key. If strictness were dropped
    // upstream, this goes red and the subset check below stops meaning
    // anything — better to learn it here than from a user's unsaveable draft.
    expect(rejectedKeysIn({ ...DECLARED_ONLY_DRAFT, notADatasourceKey: 1 })).toContain(
      'notADatasourceKey',
    );
  });

  it('rejects the three key groups objectstack#4583 removed', () => {
    expect(
      rejectedKeysIn({
        ...DECLARED_ONLY_DRAFT,
        retryPolicy: { maxAttempts: 3 },
        healthCheck: { enabled: true, intervalMs: 60000 },
        capabilities: { readOnly: true },
      }).sort(),
    ).toEqual(['capabilities', 'healthCheck', 'retryPolicy']);
  });

  it('still declares the two this preview keeps', () => {
    const accepted = acceptedKeys();
    expect(accepted.has('pool')).toBe(true);
    expect(accepted.has('ssl')).toBe(true);
  });
});

describe('DatasourcePreview reads no key DatasourceSchema rejects', () => {
  it('every derived read is an accepted key', () => {
    const accepted = acceptedKeys();
    const { reads } = deriveDraftReads(PREVIEW_SOURCE);
    const offenders = reads.filter((r) => !accepted.has(r.key));
    expect(
      offenders.map((r) => `${r.key} (DatasourcePreview.tsx:${r.line})`),
      `DatasourcePreview reads ${offenders.length} key(s) DatasourceSchema rejects. ` +
        `A preview that paints a rejected key makes an unsaveable draft look correct ` +
        `(AGENTS.md #0.1) — delete the read, do not widen the schema to match it. ` +
        `Accepted keys: ${[...accepted].sort().join(', ')}`,
    ).toEqual([]);
  });

  it('live file, non-vacuity: the derivation sees the reads that are really there', () => {
    // Without this, a walker that returned an empty array would satisfy the
    // subset check above forever.
    const { bindings, reads } = deriveDraftReads(PREVIEW_SOURCE);
    const keys = new Set(reads.map((r) => r.key));
    expect(bindings.has('draft')).toBe(true);
    expect([...keys].sort()).toEqual(
      expect.arrayContaining(['active', 'config', 'driver', 'label', 'name', 'pool', 'ssl']),
    );
    expect(keys.size).toBeGreaterThanOrEqual(8);
  });

  it('live file: the derivation has no blind spot it is not reporting', () => {
    const { opaqueUses } = deriveDraftReads(PREVIEW_SOURCE);
    expect(
      opaqueUses.map((u) => `${u.text} at line ${u.line}`),
      'The draft object is used in a way this derivation cannot follow, so the ' +
        'subset check above is no longer complete. Either express the read as a ' +
        'property access / destructure, or teach deriveDraftReads() the new form.',
    ).toEqual([]);
  });

  it('the keys objectstack#4583 removed are named in prose only, never read', () => {
    // The header comment records all three by name; the compiler sees comments,
    // a grep does not. This is the assertion objectui#4131 exists to make.
    const { reads } = deriveDraftReads(PREVIEW_SOURCE);
    const keys = new Set(reads.map((r) => r.key));
    for (const gone of ['retryPolicy', 'healthCheck', 'capabilities']) {
      expect(keys.has(gone), `${gone} is read again — see objectui#4131`).toBe(false);
    }
    // …and the #3275 wave stays deleted too.
    for (const gone of ['type', 'isDefault', 'default', 'readReplicas']) {
      expect(keys.has(gone), `${gone} is read again — see objectui#3275 / #3143`).toBe(false);
    }
  });
});

describe('the derivation itself is honest', () => {
  /** A preview-shaped module carrying a planted read of each rejected key. */
  const PLANTED = `
    export function P({ name, draft }: MetadataPreviewProps) {
      const d = draft as Record<string, unknown>;
      const pool = d.pool;
      const retry = d.retryPolicy as Record<string, unknown> | undefined;
      const health = d?.healthCheck;
      const caps = d['capabilities'];
      const { autoConnect } = d;
      return <div>{String(pool ?? retry ?? health ?? caps ?? autoConnect ?? name)}</div>;
    }
  `;

  it('a planted read of a rejected key turns the pin RED, naming the key', () => {
    const accepted = acceptedKeys();
    const { reads } = deriveDraftReads(PLANTED, 'planted.tsx');
    const offenders = reads.filter((r) => !accepted.has(r.key)).map((r) => r.key);
    expect(offenders.sort()).toEqual(['capabilities', 'healthCheck', 'retryPolicy']);
    // The declared keys in the same fixture are NOT flagged — the guard
    // separates the two, it does not just fail on everything.
    expect(reads.map((r) => r.key)).toEqual(
      expect.arrayContaining(['pool', 'autoConnect']),
    );
  });

  it('reads through every spelling: dot, optional chain, bracket, destructure', () => {
    const keys = deriveDraftReads(PLANTED, 'planted.tsx').reads.map((r) => r.key);
    expect(keys).toContain('retryPolicy'); // d.retryPolicy
    expect(keys).toContain('healthCheck'); // d?.healthCheck
    expect(keys).toContain('capabilities'); // d['capabilities']
    expect(keys).toContain('autoConnect'); // const { autoConnect } = d
  });

  it('follows a renamed prop and an alias chain', () => {
    const renamed = `
      export function P({ draft: raw }: MetadataPreviewProps) {
        const mid = raw;
        const d = mid as Record<string, unknown>;
        return <div>{String(d.retryPolicy)}</div>;
      }
    `;
    const { bindings, reads } = deriveDraftReads(renamed, 'renamed.tsx');
    expect([...bindings].sort()).toEqual(['d', 'mid', 'raw']);
    expect(reads.map((r) => r.key)).toEqual(['retryPolicy']);
  });

  it('a rejected key named in a comment or a string is not a read', () => {
    const prose = `
      /** Deleted in #4131: d.retryPolicy, d.healthCheck, d.capabilities. */
      export function P({ draft }: MetadataPreviewProps) {
        const d = draft as Record<string, unknown>;
        // d.capabilities was a chip strip here; see also d.type.
        const label = 'd.healthCheck';
        return <div>{String(d.pool) + label}</div>;
      }
    `;
    expect(deriveDraftReads(prose, 'prose.tsx').reads.map((r) => r.key)).toEqual(['pool']);
  });

  it('reports an unfollowable use instead of silently missing it', () => {
    const opaque = `
      export function P({ draft }: MetadataPreviewProps) {
        const d = draft as Record<string, unknown>;
        return <div>{JSON.stringify(Object.entries(d))}</div>;
      }
    `;
    const { opaqueUses } = deriveDraftReads(opaque, 'opaque.tsx');
    expect(opaqueUses.length).toBeGreaterThan(0);
  });
});

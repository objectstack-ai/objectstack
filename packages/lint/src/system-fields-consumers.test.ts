// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Consumer census for the blanket `SYSTEM_FIELDS` union (#8999) — enumerated by
// walking the module graph, never by grepping for a call shape.
//
// ── The defect class ──────────────────────────────────────────────────────
//
// `system-fields.ts` exports ONE object-independent union (#4330). A rule that
// consults it is deciding "could this name be a system column anywhere", and
// that decision carries obligations — most importantly the #8116 provenance
// question (`unprovisionedInjectedColumnsFor`): a name the union told the rule
// NOT to flag may still be an anchor with no storage behind it on an ADR-0015
// external object, where a predicate over it degrades to constant-false.
//
// Every sweep that tried to enumerate the rules carrying that obligation was
// scoped by a grep for `SYSTEM_FIELDS.has`. That shape structurally cannot see
// a consumer that LAUNDERS the union into a rule-local set:
//
//     const IMPLICIT_FIELDS = new Set([...SYSTEM_FIELDS, '_id', 'name', 'space'])
//
// and it certainly cannot see a consumer that imports that laundered set from
// another rule file — such a file contains the token `SYSTEM_FIELDS` zero
// times. Measured on `origin/main` at the time of writing: `grep -c
// SYSTEM_FIELDS packages/lint/src/validate-flow-node-writes.ts` -> 0, and the
// same for `validate-action-body-writes.ts`. Both consume the union.
//
// ── The measurement that justifies a check rather than a fourth sweep ─────
//
// Taken 2026-08-20 by running this file's analyzer over seven historical refs
// of `packages/lint/src` (`git archive <ref> packages/lint/src`), against the
// `SYSTEM_FIELDS.has` grep on the identical trees:
//
//   ref (PR)                     rule-file consumers   `.has` grep sees   blind
//   d4a687a66^  (pre-#8340)               9                   4             5
//   d4a687a66   (post-#8340)              9                   4             5
//   b849e6911   (post-#8404)              9                   4             5
//   192213f66^  (pre-#8996)               9                   4             5
//   192213f66   (post-#8996)              9                   4             5
//   42d899071   (post-#9314)             10                   5             5
//   origin/main (2026-08-20)             10                   5             5
//
// The blind fraction is not a historical accident that #8996 closed: it has
// been FIVE on every ref since the union was created (2026-07-31, #4330 /
// #4339), i.e. half the consumer population, and it is invisible to the one
// instrument three separate sweeps reached for. Two of those five files carry
// no occurrence of the token at all, so no textual search of any spelling can
// reach them — only the module graph can.
//
// Arrival rate, same method: the family was born at 9 consumers and has taken
// exactly one new one in the 20 days since (`validate-sortable-fields.ts`,
// 2026-08-17, #9314). So the ledger below costs roughly one line per three
// weeks, and this file adds no CI job — it runs inside the package's existing
// `pnpm test`.
//
// ── What this file refuses, and how it proves it can ──────────────────────
//
// A census whose only evidence is "green on the current tree" has not been
// tested: a matcher that stopped matching yields the same green (#8892). So
// the analyzer is exercised against synthetic fixtures FIRST, and those
// fixtures pin the two shapes the real sweeps missed — the spread form and a
// re-export chain whose consumer never names the union. Those tests also
// assert, positively, that a `SYSTEM_FIELDS.has` grep finds zero of the
// fixture's transitive consumers, so the blindness this file exists to close
// is stated as an executable claim rather than as prose.
//
// ── Boundary: what the analyzer does NOT see ──────────────────────────────
//
// It reads static ESM syntax under `src/`. A dynamic `await import()`, a
// binding reached through a runtime indirection (stored in an object literal,
// passed through a function and returned), or a consumer OUTSIDE this package
// would all escape it. The last of those is closed structurally rather than by
// hope: `SYSTEM_FIELDS` is re-exported from neither published barrel, and
// `the union stays off the published surface` fails if that ever changes —
// because the day it becomes importable, scanning `src/` stops being a census
// and this file would under-count in silence. The first two are recorded as
// known limits; both are shapes no consumer uses today, and both would be
// caught by the ledger the moment the importing file is touched.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A value import, not the `import type` the rule files use: those lazy-load
// `typescript` through `createRequire` so a pruned deployment can drop it
// (`lint-startup-registry-verdict.ts`). A test never ships — `tsup.config.ts`
// builds only `src/index.ts` and `src/runtime.ts` — so it can import it plainly.
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const srcDir = dirname(fileURLToPath(import.meta.url));

/** The module that declares the union, and the export that IS the union. */
const ORIGIN = 'system-fields.ts';
const ORIGIN_EXPORT = 'SYSTEM_FIELDS';

/**
 * How a file reaches the union. The first two are what a `.has` grep can see
 * on a good day; the last three are the laundering paths it cannot.
 *
 * - `direct`    — imports {@link ORIGIN_EXPORT} from {@link ORIGIN}.
 * - `derived`   — declares a local set/array built from a binding that already
 *                 holds the union. THE SPREAD FORM.
 * - `transitive`— imports a derived binding from some module other than the
 *                 origin. The file may never name the union at all.
 * - `barrel`    — re-exports a tainted binding onward (`export { X } from`),
 *                 lengthening the chain for everyone downstream.
 * - `namespace` — `import * as ns` plus a `ns.<tainted>` property read.
 */
type Reach = 'direct' | 'derived' | 'transitive' | 'barrel' | 'namespace';

interface Binding {
  readonly name: string;
  readonly reach: Reach;
  readonly line: number;
  /** Human-readable provenance: which module/binding handed it over. */
  readonly via: string;
}

interface Consumer {
  readonly file: string;
  readonly bindings: readonly Binding[];
  /** Distinct reaches, sorted — the ledger column. */
  readonly reach: readonly Reach[];
}

interface Census {
  /**
   * Did the origin module actually export the union?
   *
   * The seed is the one thing a taint analysis cannot infer from its own
   * output: seed a name that does not exist and every import of that name
   * still matches, so the census reports a confident population for a union
   * that is not there — which is the #8999 failure mode one level up. Returned
   * rather than assumed so `the census is anchored to a real export` can say so
   * out loud, and so a rename reds instead of quietly emptying the population.
   */
  readonly seeded: boolean;
  readonly consumers: readonly Consumer[];
}

/** Unwrap `as`/`satisfies`/parenthesised wrappers around an initializer. */
function unwrap(node: ts.Expression): ts.Expression {
  let cur = node;
  for (;;) {
    if (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isSatisfiesExpression(cur)) {
      cur = cur.expression;
      continue;
    }
    return cur;
  }
}

/**
 * Is this initializer a SET-VALUED construction — i.e. does the binding it
 * creates hold the union (or a superset of it) as a value?
 *
 * Deliberately narrow. Propagating through arbitrary expressions — a function
 * that merely READS the union, say — taints the whole package transitively
 * (measured: 44 of 151 files) and destroys the signal. What matters here is
 * the value lineage: the bindings a rule can ask `.has()` of.
 */
function setValued(init: ts.Expression | undefined): boolean {
  if (!init) return false;
  const e = unwrap(init);
  if (ts.isIdentifier(e)) return true; // `const X = TAINTED` — a plain alias
  if (ts.isArrayLiteralExpression(e)) return true; // `[...TAINTED]`
  return ts.isNewExpression(e) && ts.isIdentifier(e.expression) && (e.expression.text === 'Set' || e.expression.text === 'Map');
}

/** Every identifier referenced anywhere inside `node`. */
function identifiersIn(node: ts.Node): string[] {
  const out: string[] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) out.push(n.text);
    else ts.forEachChild(n, walk);
  };
  ts.forEachChild(node, walk);
  return out;
}

/**
 * Enumerate every file holding a binding whose VALUE is the union or something
 * built from it, by fixed-point propagation over the static import/export graph.
 *
 * Takes its sources as a map so the positive-control tests can hand it a
 * synthetic module set — the analyzer must be provable against a tree whose
 * answer is known, not only against the tree it is judging.
 */
function censusUnionConsumers(sources: ReadonlyMap<string, string>): Census {
  const names = [...sources.keys()].sort();
  const parsed = new Map<string, ts.SourceFile>(
    names.map((f) => [f, ts.createSourceFile(f, sources.get(f) ?? '', ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)]),
  );
  const lineOf = (f: string, n: ts.Node): number =>
    (parsed.get(f) as ts.SourceFile).getLineAndCharacterOfPosition(n.getStart()).line + 1;

  // Anchor check, before anything propagates.
  const originSf = parsed.get(ORIGIN);
  const seeded =
    originSf !== undefined &&
    originSf.statements.some(
      (st) =>
        ts.isVariableStatement(st) &&
        st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true &&
        st.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === ORIGIN_EXPORT),
    );
  if (!seeded) return { seeded: false, consumers: [] };

  /** `'./system-fields.js'` from `<f>` -> `'system-fields.ts'`, or null if outside the set. */
  const resolveSpec = (from: string, spec: string): string | null => {
    if (!spec.startsWith('.')) return null;
    const rel = resolve('/', dirname(from), spec).slice(1);
    for (const c of [rel.replace(/\.js$/, '.ts'), `${rel}.ts`, `${rel}/index.ts`]) if (sources.has(c)) return c;
    return null;
  };

  // `<file>::<exportedName>` for every export that hands the union onward.
  const taintedExports = new Set<string>([`${ORIGIN}::${ORIGIN_EXPORT}`]);
  const bindings = new Map<string, Map<string, Binding>>();

  for (let changed = true; changed; ) {
    changed = false;
    for (const f of names) {
      const sf = parsed.get(f) as ts.SourceFile;
      const mine = bindings.get(f) ?? new Map<string, Binding>();
      const hold = (b: Binding): void => {
        if (!mine.has(b.name)) {
          mine.set(b.name, b);
          changed = true;
        }
      };
      const publish = (name: string): void => {
        if (!taintedExports.has(`${f}::${name}`)) {
          taintedExports.add(`${f}::${name}`);
          changed = true;
        }
      };

      for (const st of sf.statements) {
        if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
          const target = resolveSpec(f, st.moduleSpecifier.text);
          if (!target) continue;
          const nb = st.importClause?.namedBindings;
          if (nb && ts.isNamedImports(nb)) {
            for (const el of nb.elements) {
              const imported = (el.propertyName ?? el.name).text;
              if (!taintedExports.has(`${target}::${imported}`)) continue;
              hold({
                name: el.name.text,
                reach: target === ORIGIN && imported === ORIGIN_EXPORT ? 'direct' : 'transitive',
                line: lineOf(f, el),
                via: `${target}::${imported}`,
              });
            }
          } else if (nb && ts.isNamespaceImport(nb)) {
            // `import * as ns` only counts once the file actually reads a
            // tainted property off it — the alias alone launders nothing.
            const alias = nb.name.text;
            const reads = identifiersIn(sf).length; // touch, keeps the walk cheap below
            void reads;
            const used = new Set<string>();
            const walk = (n: ts.Node): void => {
              if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === alias) {
                used.add(n.name.text);
              }
              ts.forEachChild(n, walk);
            };
            ts.forEachChild(sf, walk);
            for (const prop of used) {
              if (!taintedExports.has(`${target}::${prop}`)) continue;
              hold({ name: `${alias}.${prop}`, reach: 'namespace', line: lineOf(f, nb), via: `${target}::${prop}` });
            }
          }
        } else if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
          for (const el of st.exportClause.elements) {
            const imported = (el.propertyName ?? el.name).text;
            if (st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
              const target = resolveSpec(f, st.moduleSpecifier.text);
              if (!target || !taintedExports.has(`${target}::${imported}`)) continue;
              hold({ name: el.name.text, reach: 'barrel', line: lineOf(f, el), via: `${target}::${imported}` });
              publish(el.name.text);
            } else if (mine.has(imported)) {
              publish(el.name.text);
            }
          }
        } else if (ts.isExportDeclaration(st) && !st.exportClause && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
          // `export * from './x.js'` — every tainted export of x travels on.
          const target = resolveSpec(f, st.moduleSpecifier.text);
          if (!target) continue;
          for (const key of [...taintedExports]) {
            const [owner, name] = key.split('::');
            if (owner !== target) continue;
            hold({ name, reach: 'barrel', line: lineOf(f, st), via: key });
            publish(name);
          }
        } else if (ts.isVariableStatement(st)) {
          const exported = st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true;
          for (const d of st.declarationList.declarations) {
            if (!ts.isIdentifier(d.name) || !setValued(d.initializer)) continue;
            const from = [...new Set(identifiersIn(d).filter((r) => mine.has(r)))];
            if (from.length === 0) continue;
            hold({ name: d.name.text, reach: 'derived', line: lineOf(f, d), via: from.join(', ') });
            if (exported) publish(d.name.text);
          }
        }
      }
      if (mine.size > 0) bindings.set(f, mine);
    }
  }

  const consumers = [...bindings]
    .filter(([f]) => f !== ORIGIN)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, m]) => {
      const bs = [...m.values()].sort((a, b) => a.line - b.line);
      return { file, bindings: bs, reach: [...new Set(bs.map((b) => b.reach))].sort() };
    });
  return { seeded: true, consumers };
}

/** Read `src/` off disk into the shape the analyzer takes. */
function liveSources(): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of readdirSync(srcDir, { recursive: true })) {
    const rel = String(entry).split('\\').join('/');
    if (!rel.endsWith('.ts')) continue;
    out.set(rel, readFileSync(join(srcDir, rel), 'utf8'));
  }
  return out;
}

/**
 * The #8116 provenance API — the question a consumer of the blanket union may
 * owe once it decides NOT to flag a name. Pinned as a list because
 * `asksProvenance` below is judged by reference to it; `the provenance API this
 * ledger judges against still exists` fails if one is renamed, so a rename can
 * never quietly turn every ledger row into "does not ask".
 */
const PROVENANCE_API = ['unprovisionedInjectedColumnsFor', 'indexUnprovisionedAnchors', 'unprovisionedAnchorCause'] as const;

interface LedgerRow {
  readonly kind: 'rule' | 'test';
  readonly reach: readonly Reach[];
  /**
   * Does this consumer ask the #8116 provenance question after the union tells
   * it to stay silent? Verified mechanically against {@link PROVENANCE_API};
   * `false` is a legitimate answer and `why` must say why.
   */
  readonly asksProvenance: boolean;
  readonly why: string;
}

/**
 * ⚠️ THE LEDGER. A new consumer of the union fails `the live consumer
 * population matches the ledger` and lands here, which is the only moment the
 * provenance judgement is cheap to make. Adding a row is the whole obligation —
 * one line, and the `why` when `asksProvenance` is false.
 *
 * `reach` is not decoration: a row reading `['transitive']` is a file with no
 * occurrence of `SYSTEM_FIELDS` in it, and is the shape three sweeps missed.
 */
const LEDGER: Record<string, LedgerRow> = {
  'system-fields.test.ts': {
    kind: 'test',
    reach: ['direct'],
    asksProvenance: true,
    why: 'The union\'s own derivation test — it pins membership, and covers unprovisionedInjectedColumnsFor alongside it.',
  },
  'validate-action-body-writes.test.ts': {
    kind: 'test',
    reach: ['transitive'],
    asksProvenance: false,
    why: 'Test. Reaches the union only to build the exempt-field fixture for the rule it covers.',
  },
  'validate-action-body-writes.ts': {
    kind: 'rule',
    reach: ['transitive'],
    asksProvenance: true,
    why: 'Wired by #8996. Reaches the union with ZERO occurrences of the token — it imports IMPLICIT_FIELDS from validate-hook-body-writes.ts.',
  },
  'validate-flow-node-writes.test.ts': {
    kind: 'test',
    reach: ['transitive'],
    asksProvenance: false,
    why: 'Test. Builds a write-every-implicit-field fixture from the re-exported set.',
  },
  'validate-flow-node-writes.ts': {
    kind: 'rule',
    reach: ['transitive'],
    asksProvenance: true,
    why: 'THE POSITIVE CONTROL (#8999). The third miss: reached by re-export, token count zero, invisible to all three sweeps. Wired by #8996.',
  },
  'validate-flow-template-paths.ts': {
    kind: 'rule',
    reach: ['derived', 'direct'],
    asksProvenance: true,
    why: 'Spreads the union into rule-local IMPLICIT_HEADS. Provenance wired by #8340.',
  },
  'validate-hook-body-writes.ts': {
    kind: 'rule',
    reach: ['derived', 'direct'],
    asksProvenance: true,
    why: 'Spreads the union into IMPLICIT_FIELDS and EXPORTS it — the laundering source for the two write rules above. Wired by #8996.',
  },
  'validate-page-field-bindings.ts': {
    kind: 'rule',
    reach: ['direct'],
    asksProvenance: true,
    why: 'Blanket .has read site. Provenance wired by #8340.',
  },
  'validate-react-page-props.ts': {
    kind: 'rule',
    reach: ['direct'],
    asksProvenance: true,
    why: 'Blanket .has read site. Provenance wired by #8340.',
  },
  'validate-searchable-fields.ts': {
    kind: 'rule',
    reach: ['direct'],
    asksProvenance: true,
    why: 'Blanket .has read site. Provenance wired by #8404.',
  },
  'validate-sortable-fields.ts': {
    kind: 'rule',
    reach: ['direct'],
    asksProvenance: false,
    why:
      'Landed 2026-08-17 (#9314), after the #8996 sweep — it is the arrival that released this card\'s hold. ' +
      'Recorded as NOT asking: the rule returns before the union branch for any object with no authored field ' +
      'map (skip ②), which is where an ADR-0015 external object normally lands, so today there is no path on ' +
      'which the warning could fire. Whether an external object that DOES declare a mapped field map should ' +
      'get the sort-axis warning is a rule-shape question, not this census\'s to decide — filed separately.',
  },
  'validate-translation-references.ts': {
    kind: 'rule',
    reach: ['derived', 'direct'],
    asksProvenance: false,
    why:
      'Spreads the union into its own rule-local IMPLICIT_FIELDS, and has done since before #8340 — a spread ' +
      'consumer no sweep ever listed. Recorded as NOT asking on purpose: a translation bundle supplies a LABEL ' +
      'for a column, and never reads the value, so "this anchor has no storage" says nothing about whether the ' +
      'label resolves. The #8116 warning is about predicates and pointers over the value.',
  },
  'validate-widget-bindings.ts': {
    kind: 'rule',
    reach: ['direct'],
    asksProvenance: true,
    why: 'Blanket .has read site. Provenance wired by #8340.',
  },
};

// ── Fixtures: a module set whose right answer is known ────────────────────
//
// Every shape below is one a real consumer uses. `transitive-consumer.ts` and
// `two-hop-consumer.ts` are the point of the whole file: neither contains the
// string `SYSTEM_FIELDS`, so no grep of any spelling can reach them.
const FIXTURES = new Map<string, string>([
  [ORIGIN, `export const ${ORIGIN_EXPORT}: ReadonlySet<string> = new Set(['created_at', 'owner_id']);\n`],
  [
    'spread-consumer.ts',
    `import { ${ORIGIN_EXPORT} } from './system-fields.js';\n` +
      `export const IMPLICIT_FIELDS = new Set([...${ORIGIN_EXPORT}, '_id', 'name', 'space']);\n` +
      `export function exempt(n: string): boolean { return IMPLICIT_FIELDS.has(n); }\n`,
  ],
  [
    'transitive-consumer.ts',
    `import { IMPLICIT_FIELDS } from './spread-consumer.js';\n` +
      `export function exempt(n: string): boolean { return IMPLICIT_FIELDS.has(n); }\n`,
  ],
  ['barrel-fixture.ts', `export { IMPLICIT_FIELDS } from './spread-consumer.js';\n`],
  [
    'two-hop-consumer.ts',
    `import { IMPLICIT_FIELDS } from './barrel-fixture.js';\n` +
      `const WIDER = new Set([...IMPLICIT_FIELDS, 'record_type']);\n` +
      `export function exempt(n: string): boolean { return WIDER.has(n); }\n`,
  ],
  [
    'namespace-consumer.ts',
    `import * as shared from './system-fields.js';\n` +
      `export function exempt(n: string): boolean { return shared.${ORIGIN_EXPORT}.has(n); }\n`,
  ],
  ['innocent.ts', `export const UNRELATED = new Set(['a', 'b']);\n`],
  [
    'decoy.ts',
    `// Mentions ${ORIGIN_EXPORT} in prose only, and imports nothing from it.\n` +
      `export const NOT_A_CONSUMER = new Set(['x']);\n`,
  ],
]);

const fileOf = (c: Census): string[] => c.consumers.map((x) => x.file);

describe('SYSTEM_FIELDS consumer census (#8999)', () => {
  // ── Positive controls. These run FIRST and on synthetic input, because a
  //    matcher that stopped matching produces the same clean green as a clean
  //    tree, and this whole card exists because an instrument could not see
  //    what it was looking for.
  describe('the analyzer can see what it claims to see', () => {
    it('finds the SPREAD form — a rule-local set built from the union', () => {
      const found = censusUnionConsumers(FIXTURES);
      const spread = found.consumers.find((c) => c.file === 'spread-consumer.ts');
      expect(spread, `spread consumer not found; census named ${JSON.stringify(fileOf(found))}`).toBeDefined();
      expect(spread?.reach).toEqual(['derived', 'direct']);
      expect(spread?.bindings.map((b) => b.name)).toContain('IMPLICIT_FIELDS');
    });

    it('finds a RE-EXPORT consumer that never names the union', () => {
      const found = censusUnionConsumers(FIXTURES);
      for (const f of ['transitive-consumer.ts', 'two-hop-consumer.ts']) {
        expect(fileOf(found), `${f} escaped the census`).toContain(f);
        // The claim that makes this the load-bearing case: the file has no
        // occurrence of the token, at any hop count.
        expect((FIXTURES.get(f) as string).includes(ORIGIN_EXPORT)).toBe(false);
      }
      expect(found.consumers.find((c) => c.file === 'two-hop-consumer.ts')?.reach).toEqual(['derived', 'transitive']);
    });

    it('finds a namespace-import consumer', () => {
      expect(fileOf(censusUnionConsumers(FIXTURES))).toContain('namespace-consumer.ts');
    });

    it('the grep every previous sweep used finds ZERO of the transitive consumers', () => {
      // Not prose: the executable statement of the blindness. Run the old
      // instrument over the same fixture set and watch it come up empty on the
      // three files the module graph names.
      const hasGrep = [...FIXTURES]
        .filter(([f, src]) => f !== ORIGIN && src.includes(`${ORIGIN_EXPORT}.has`))
        .map(([f]) => f);
      const graph = fileOf(censusUnionConsumers(FIXTURES));
      for (const invisible of ['transitive-consumer.ts', 'two-hop-consumer.ts', 'barrel-fixture.ts']) {
        expect(hasGrep, `${invisible} should be invisible to the .has grep`).not.toContain(invisible);
        expect(graph, `${invisible} should be visible to the module graph`).toContain(invisible);
      }
    });

    it('does not mistake prose or an unrelated set for a consumer', () => {
      const found = fileOf(censusUnionConsumers(FIXTURES));
      expect(found).not.toContain('innocent.ts');
      expect(found).not.toContain('decoy.ts');
    });

    it('reports nothing when the union is not there — so a green means something', () => {
      // A census that returns the same answer on a tree with no union at all is
      // not measuring the tree. Delete the origin's export and the population
      // must collapse to empty.
      const blank = new Map(FIXTURES);
      blank.set(ORIGIN, `export const SOMETHING_ELSE: ReadonlySet<string> = new Set(['x']);\n`);
      expect(censusUnionConsumers(blank)).toEqual({ seeded: false, consumers: [] });
    });
  });

  // ── The census itself.
  describe('the live population', () => {
    it('is anchored to a real export, so an empty answer cannot be a false green', () => {
      expect(
        censusUnionConsumers(liveSources()).seeded,
        `${ORIGIN} no longer exports ${ORIGIN_EXPORT}. Every assertion below judges a population seeded from ` +
          'that name; unseeded, they would all pass on an empty set. Repoint the seed, do not delete this file.',
      ).toBe(true);
    });

    it('matches the ledger', () => {
      const found = censusUnionConsumers(liveSources());
      const undeclared = found.consumers.filter((c) => !(c.file in LEDGER));
      expect(
        undeclared.map((c) => `${c.file} [${c.reach.join('+')}] via ${c.bindings.map((b) => `${b.name}@${b.line} <- ${b.via}`).join('; ')}`),
        'A new consumer of the blanket SYSTEM_FIELDS union appeared. Add it to LEDGER in this file and, ' +
          'if it decides NOT to flag a name, say whether it asks the #8116 provenance question (see the ' +
          'header). Reaching the union by `transitive` means the file never names it — that is the shape ' +
          'three sweeps missed, and the reason this ledger exists.',
      ).toEqual([]);

      const stale = Object.keys(LEDGER).filter((f) => !fileOf(found).includes(f));
      expect(stale, 'LEDGER rows for files that no longer consume the union — delete them.').toEqual([]);
    });

    it('records how each consumer reaches the union', () => {
      for (const c of censusUnionConsumers(liveSources()).consumers) {
        // An un-ledgered file is already named, with its full path to the
        // union, by `matches the ledger`. Skipping it here keeps that one
        // actionable message from being buried under TypeErrors from the
        // assertions that index the ledger by name.
        const row = LEDGER[c.file];
        if (!row) continue;
        expect(c.reach, `${c.file}: reach drifted from the ledger`).toEqual([...row.reach]);
      }
    });

    it('still contains the consumer three sweeps missed', () => {
      // The card's named control, on real data. `validate-flow-node-writes.ts`
      // reaches the union purely by re-export and has never contained the
      // token. If this file ever stops being in-scope, the census is broken —
      // not fixed.
      const control = 'validate-flow-node-writes.ts';
      const found = censusUnionConsumers(liveSources()).consumers.find((c) => c.file === control);
      expect(found, `${control} is the #8999 positive control and must be in scope`).toBeDefined();
      expect(found?.reach).toEqual(['transitive']);
      expect(readFileSync(join(srcDir, control), 'utf8')).not.toContain(ORIGIN_EXPORT);
    });

    it('covers all three laundering shapes, so a half-broken analyzer cannot pass', () => {
      const reaches = new Set(censusUnionConsumers(liveSources()).consumers.flatMap((c) => c.reach));
      for (const shape of ['direct', 'derived', 'transitive'] as const) {
        expect(reaches, `no consumer reached the union by '${shape}' — the analyzer lost a propagation path`).toContain(shape);
      }
    });
  });

  // ── The obligation the census exists to make visible.
  describe('the provenance judgement is recorded, not assumed', () => {
    it('the provenance API this ledger judges against still exists', () => {
      const origin = readFileSync(join(srcDir, ORIGIN), 'utf8');
      for (const fn of PROVENANCE_API) {
        expect(origin, `${fn} is gone from ${ORIGIN}; asksProvenance below is judging against a dead name`).toContain(
          `export function ${fn}`,
        );
      }
    });

    it('each consumer asks it, or the ledger says why not', () => {
      for (const c of censusUnionConsumers(liveSources()).consumers) {
        const row = LEDGER[c.file]; // see `records how each consumer reaches the union`
        if (!row) continue;
        const src = readFileSync(join(srcDir, c.file), 'utf8');
        const asks = PROVENANCE_API.some((fn) => src.includes(fn));
        expect(
          asks,
          `${c.file}: LEDGER.asksProvenance is ${row.asksProvenance} but the file ${asks ? 'does' : 'does not'} ` +
            'reference the #8116 provenance API',
        ).toBe(row.asksProvenance);
        if (!row.asksProvenance) {
          expect(row.why.length, `${c.file}: a consumer that does not ask must record why`).toBeGreaterThan(40);
        }
      }
    });
  });

  it('the union stays off the published surface', () => {
    // The census scans `src/`. That is a complete population ONLY while the
    // union is unreachable from outside the package — the day a barrel
    // re-exports it, a consumer can live in any package and this file would go
    // on reporting a confident, wrong number.
    for (const barrel of ['index.ts', 'runtime.ts']) {
      const src = readFileSync(join(srcDir, barrel), 'utf8');
      expect(src, `${barrel} publishes ${ORIGIN_EXPORT}: the census in this file is no longer a census`).not.toMatch(
        /export\s*\{[^}]*\bSYSTEM_FIELDS\b/,
      );
      expect(src, `${barrel} re-exports ${ORIGIN}: the census in this file is no longer a census`).not.toContain(
        './system-fields.js',
      );
    }
  });
});

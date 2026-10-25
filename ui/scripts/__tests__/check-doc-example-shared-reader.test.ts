import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import {
  KNOWN_HAND_SPELLINGS,
  analyze,
  canonical,
  canonicalContains,
  docBlocks,
  exampleFences,
  inline,
  rungsOf,
} from '../check-doc-example-shared-reader.mjs';

/**
 * objectui#7652 — a doc comment must not prescribe a call-site spelling that a
 * published shared reader already owns.
 *
 * A JSDoc `@example` is copied. When the ruling it encoded moves, the prose stays
 * and seeds every later copy, so fixing the call sites without fixing the prose
 * re-seeds them. That cost two cards and three copied call sites
 * (objectui#7627 `useSettledSchema`, objectui#7638 `useNavigationOverlay`), and
 * objectui#7617's `check-spec-symbol-derivation` was credited with covering the
 * class twice — in #7638's card body, then in the dispatch that repeated it —
 * while its rule 4 judges `@objectstack/spec` citations at MEMBER granularity and
 * has nothing to say about prose prescribing a local spelling.
 *
 * What this file pins, in the order the gate can go wrong:
 *
 *  1. **A zero from this gate is a reading, not a dead instrument.** The lit
 *     control plants an instance in the very doc block whose zero the gate
 *     reports and requires exit-1 behaviour naming that file — and then a control
 *     ON that control: a NEAR-MISS plant, an ordinary example spelling that is
 *     not a rung of the reader, must stay green. Without the second half "the
 *     plant reddens it" only proves the gate reacts to edits.
 *  2. **The historical instance, on the real tree that carried it.** The
 *     `useNavigationOverlay` shape as it stood between PR #7637 and PR #7648,
 *     rebuilt as a fixture: the reader exists, a call site delegates to it, the
 *     doc comment still writes the rung.
 *  3. **The narrowing holds in both directions.** A literal, a placeholder and a
 *     locally-named variable in an example are all legal; only the reader's own
 *     return expression or one of its rungs is not.
 *  4. **The trigger is a real call site, not a helper's existence.** A reader
 *     nobody calls says nothing about any doc comment.
 *  5. **The scan cannot collapse quietly** — a green over an empty population is
 *     the failure this whole gate family exists to prevent.
 *  6. **This repository is green**, and the exemption ledger stays empty.
 *  7. **The gate is wired** where the sibling parse-based gates run, and the page
 *     that inventories them names it.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const fixtures: string[] = [];
afterAll(() => {
  for (const dir of fixtures) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A throwaway tree in the shape the gate walks: `packages/<name>/src/<file>`.
 * Written to disk rather than parsed from strings because the population walk —
 * which directories are read, which files are skipped as tooling — is half of
 * what can go wrong, and a string-fed test would never exercise it.
 */
function tree(label: string, files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `doc-example-${label}-`));
  fixtures.push(root);
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return root;
}

/** The shared reader, verbatim in shape from `packages/core/src/utils/record-source.ts`. */
const READER = `
export function resolveRecordSourceObjectName(
  schema: { objectName?: string } | null | undefined,
  dataConfig: { provider?: string; object?: string } | null | undefined,
): string | undefined {
  return dataConfig?.provider === 'object' ? dataConfig.object : schema?.objectName;
}
`;

/** The hook, with whatever its `@example` prescribes for `objectName`. */
function hook(exampleSpelling: string): string {
  return `
/**
 * Hook for NavigationConfig-driven navigation overlay.
 *
 * @example
 * \`\`\`tsx
 * const nav = useNavigationOverlay({
 *   navigation: schema.navigation,
 *   objectName: ${exampleSpelling},
 * });
 * \`\`\`
 */
export function useNavigationOverlay(options: { navigation?: unknown; objectName?: string }) {
  return options;
}
`;
}

/** A caller that resolves the slot through the shared reader, as the fix left them. */
const DELEGATING_CALLER = `
import { resolveRecordSourceObjectName } from '@object-ui/core';
import { useNavigationOverlay } from '@object-ui/react';

export function ObjectTree(props: any) {
  const dataConfig = props.dataConfig;
  const schema = props.schema;
  const navigation = useNavigationOverlay({
    navigation: schema.navigation,
    objectName: resolveRecordSourceObjectName(schema, dataConfig),
  });
  return navigation;
}
`;

function reseedingTree(exampleSpelling: string, label: string): string {
  return tree(label, {
    'packages/core/src/utils/record-source.ts': READER,
    'packages/react/src/hooks/useNavigationOverlay.ts': hook(exampleSpelling),
    'packages/plugin-tree/src/ObjectTree.tsx': DELEGATING_CALLER,
  });
}

describe('check-doc-example-shared-reader — the instrument', () => {
  /**
   * The lit control. Every "no doc comment hand-spells a reader" reading this gate
   * produces is worth exactly as much as its ability to say the opposite, and a
   * scan that silently walked nothing would report the same zero. This is
   * objectui#7638's shape rebuilt: reader present, one call site delegating, the
   * `@example` still writing the rung.
   */
  it('reports the planted instance (lit control)', () => {
    const { findings, counters } = analyze(reseedingTree('schema.objectName', 'lit'));

    expect(counters.documented, 'the walk must have found the documented hook').toBe(1);
    expect(counters.callSites, 'the walk must have found the delegating call site').toBe(1);
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('packages/react/src/hooks/useNavigationOverlay.ts');
    expect(findings[0].symbol).toBe('useNavigationOverlay');
    expect(findings[0].slot).toBe('objectName');
    expect(findings[0].reader).toBe('resolveRecordSourceObjectName');
    expect(findings[0].handSpelled).toBe('schema.objectName');
  });

  /**
   * The control ON the lit control, and the reason the one above is not vacuous.
   *
   * "A plant reddens it" proves only that the gate reacts to an edit. These three
   * plants are edits to the same line in the same doc block, differing only in
   * WHAT the example prescribes — and all three must stay green, because a
   * literal, a placeholder and a locally-named variable are exactly what an
   * example is for. A gate that reddened on these would be a gate over prose
   * style, and it would be switched off rather than fixed.
   */
  it.each([
    ["'Accounts'", 'a literal'],
    ['props.objectName', 'a placeholder the caller supplies'],
    ['myResolvedName', 'a locally-named variable'],
  ])('stays green when the example prescribes %s (%s)', (spelling) => {
    const { findings, counters } = analyze(reseedingTree(spelling, 'nearmiss'));

    // Same population as the lit control — so a green here cannot be a walk that
    // found nothing, which is the way this control could itself go vacuous.
    expect(counters.documented).toBe(1);
    expect(counters.callSites).toBe(1);
    expect(findings).toEqual([]);
  });

  /** The other rung of the same reader — the objectui#7627 spelling. */
  it('reports a hand copy of the whole reader body, not only a single rung', () => {
    const { findings } = analyze(
      reseedingTree("dataConfig?.provider === 'object' ? dataConfig.object : schema.objectName", 'body'),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].handSpelled).toBe("dataConfig.provider === 'object' ? dataConfig.object : schema.objectName");
  });

  /**
   * An example that already delegates is the fixed state, and it is what both
   * cards landed. If this reddened, the gate would be unfixable.
   */
  it('stays green once the example points at the reader', () => {
    const { findings } = analyze(reseedingTree('resolveRecordSourceObjectName(schema, dataConfig)', 'fixed'));
    expect(findings).toEqual([]);
  });

  /**
   * The trigger is a call site, not a helper. A shared reader published this
   * morning with no consumer says nothing about any doc comment, and a gate that
   * fired on the reader's mere existence would accuse every example in the tree
   * that mentions an object name.
   */
  it('says nothing when no call site delegates', () => {
    const root = tree('nodelegate', {
      'packages/core/src/utils/record-source.ts': READER,
      'packages/react/src/hooks/useNavigationOverlay.ts': hook('schema.objectName'),
      'packages/plugin-tree/src/ObjectTree.tsx': `
import { useNavigationOverlay } from '@object-ui/react';
export function ObjectTree(props: any) {
  return useNavigationOverlay({ navigation: props.schema.navigation, objectName: props.schema.objectName });
}
`,
    });

    const { findings, counters } = analyze(root);
    expect(counters.callSites, 'the call site must still have been walked').toBe(1);
    expect(findings).toEqual([]);
  });

  /**
   * The alias leg, which is where the objectui#7627 instance hides: both sides
   * wrap the resolution in a local `const`, and a whole-expression substitution
   * sees `schemaKey ?? ''`, finds no binding for it, and reports nothing.
   */
  it('sees through a local const on both sides', () => {
    const root = tree('alias', {
      'packages/core/src/utils/record-source.ts': READER,
      'packages/react/src/hooks/useSettledSchema.ts': `
/**
 * Settle a schema read.
 *
 * @example
 * \`\`\`tsx
 * const schemaKey = dataConfig?.provider === 'object' ? dataConfig.object : schema.objectName;
 * const { ready } = useSettledSchema(schemaKey ?? '', dataSource);
 * \`\`\`
 */
export function useSettledSchema(key: string, dataSource: unknown) {
  return { key, dataSource };
}
`,
      'packages/plugin-tree/src/ObjectTree.tsx': `
import { resolveRecordSourceObjectName } from '@object-ui/core';
import { useSettledSchema } from '@object-ui/react';
export function ObjectTree(props: any) {
  const schemaKey = resolveRecordSourceObjectName(props.schema, props.dataConfig);
  return useSettledSchema(schemaKey ?? '', props.dataSource);
}
`,
    });

    const { findings } = analyze(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].slot).toBe('#0');
    expect(findings[0].handSpelled).toBe("dataConfig.provider === 'object' ? dataConfig.object : schema.objectName");
  });

  /**
   * Tooling files are not documentation anyone copies from, and a test fixture
   * legitimately hand-spells whatever it is pinning. Reading them would make the
   * gate accuse the pins that hold the readers still.
   */
  /**
   * The widening that the first run made non-optional. A JSDoc block attached to
   * NO declaration — a file header — teaching a call to a symbol declared in a
   * different package is the shape `navigation-overlay.tsx` carries, and a gate
   * that only read JSDoc attached to the symbol it documents would report a clean
   * tree over it.
   */
  it('reads a file-header block that documents a different symbol', () => {
    const root = tree('header', {
      'packages/core/src/utils/record-source.ts': READER,
      'packages/react/src/hooks/useNavigationOverlay.ts': hook('resolveRecordSourceObjectName(schema, dataConfig)'),
      'packages/components/src/custom/navigation-overlay.tsx': `
/**
 * NavigationOverlay
 *
 * Works in conjunction with useNavigationOverlay from @object-ui/react.
 *
 * @example
 * \`\`\`tsx
 * const nav = useNavigationOverlay({ navigation: schema.navigation, objectName: schema.objectName });
 * \`\`\`
 */
import React from 'react';
export function NavigationOverlay() {
  return React.createElement('div');
}
`,
      'packages/plugin-tree/src/ObjectTree.tsx': DELEGATING_CALLER,
    });

    const { raw } = analyze(root);
    expect(raw.map((f) => f.file)).toEqual(['packages/components/src/custom/navigation-overlay.tsx']);
  });

  /**
   * The other half of that widening. Once every block comment is read, an example
   * calling `useMemo`, `useEffect` or `fetch` becomes a comparison against every
   * reader in the tree — hundreds of meaningless pairs and a latent false
   * positive. Only what this repository exports is compared.
   */
  it('does not compare a call to something this repository does not export', () => {
    const root = tree('foreign', {
      'packages/core/src/utils/record-source.ts': READER,
      'packages/react/src/hooks/useThing.ts': `
/**
 * @example
 * \`\`\`tsx
 * const value = useMemo(() => schema.objectName, [schema]);
 * \`\`\`
 */
export function useThing() {
  return null;
}
`,
      'packages/plugin-tree/src/ObjectTree.tsx': `
import { resolveRecordSourceObjectName } from '@object-ui/core';
export function ObjectTree(props: any) {
  return useMemo(() => resolveRecordSourceObjectName(props.schema, props.dataConfig), [props]);
}
`,
    });

    const { raw, counters } = analyze(root);
    expect(counters.documented, '`useMemo` is not first-party, so no example call is comparable').toBe(0);
    expect(raw).toEqual([]);
  });

  it('does not read test files as call sites', () => {
    const root = tree('tooling', {
      'packages/core/src/utils/record-source.ts': READER,
      'packages/react/src/hooks/useNavigationOverlay.ts': hook('schema.objectName'),
      'packages/plugin-tree/src/__tests__/ObjectTree.test.tsx': DELEGATING_CALLER,
    });

    const { findings, counters } = analyze(root);
    expect(counters.callSites).toBe(0);
    expect(findings).toEqual([]);
  });
});

describe('check-doc-example-shared-reader — the parts', () => {
  it('erases optional chaining, which is what makes the copy comparable', () => {
    // The reader returns `schema?.objectName`; every copy of it in the tree wrote
    // `schema.objectName`. Treating those as different expressions is the one
    // normalisation choice that would make the gate blind to its own instance.
    expect(canonical('schema?.objectName')).toBe(canonical('schema.objectName'));
    expect(canonical('a  ??\n  b')).toBe('a ?? b');
  });

  it('reads the alternatives a reader resolves between as its rungs', () => {
    const source = `const x = dataConfig?.provider === 'object' ? dataConfig.object : schema?.objectName;`;
    const sf = ts.createSourceFile('r.ts', source, ts.ScriptTarget.Latest, true);
    const statement = sf.statements[0];
    if (!ts.isVariableStatement(statement)) throw new Error('fixture must parse to a variable statement');
    const expression = statement.declarationList.declarations[0].initializer;
    if (!expression) throw new Error('fixture must carry an initializer');

    expect(rungsOf(expression)).toEqual(
      expect.arrayContaining([
        "dataConfig.provider === 'object' ? dataConfig.object : schema.objectName",
        'dataConfig.object',
        'schema.objectName',
      ]),
    );
  });

  it('matches a rung structurally, never by substring', () => {
    // `otherSchema.objectName` CONTAINS the text `schema.objectName`. A substring
    // test would fire on it, which is the cheap implementation of this gate and
    // the one that would cry wolf.
    expect(canonicalContains('schema.objectName', 'schema.objectName')).toBe(true);
    expect(canonicalContains("schemaKey ?? ''", 'schema.objectName')).toBe(false);
    expect(canonicalContains('otherSchema.objectName', 'schema.objectName')).toBe(false);
  });

  it('does not substitute a binding that is being called', () => {
    // `const getDataConfig = ...` is a function, and inlining its body where the
    // example CALLS it would fabricate an expression nothing in the tree wrote.
    const bindings = new Map([['getDataConfig', 'schema.data ?? null']]);
    expect(inline('getDataConfig(schema)', bindings)).toBe('getDataConfig(schema)');
    expect(inline('getDataConfig', bindings)).toBe('(schema.data ?? null)');
  });

  it('finds block comments through the shared scanner, not a regex', () => {
    // A block-comment OPENER inside a string literal is what breaks the naive
    // regex: it opens a phantom comment that runs to the next real terminator,
    // swallowing the real doc block below it.
    const source = ["const glob = '/*.ts';", '/** @example real */', 'export const x = 1;'].join('\n');
    expect(docBlocks(source)).toEqual(['/** @example real */']);
  });

  it('strips the JSDoc line prefix so the fence parses', () => {
    const fences = exampleFences(['/**', ' * @example', ' * ```tsx', ' * const a = 1;', ' * ```', ' */'].join('\n'));
    expect(fences).toEqual(['const a = 1;\n']);
  });
});

describe('check-doc-example-shared-reader — this repository', () => {
  const result = analyze(repoRoot);

  /**
   * The size guard. A refactor that emptied the walk would satisfy every
   * assertion above — they all run on throwaway trees — while this repository's
   * run silently checked nothing and reported a pass.
   */
  it('walks a population, and compares something in it', () => {
    expect(result.counters.files).toBeGreaterThan(200);
    expect(result.counters.readers).toBeGreaterThan(5);
    expect(result.counters.documented).toBeGreaterThan(5);
    expect(result.counters.callSites).toBeGreaterThan(50);
    expect(
      result.counters.compared,
      'no slot in this repository has a call site delegating to a shared reader, so the ' +
        'gate compared nothing here and its green says nothing',
    ).toBeGreaterThan(0);
  });

  it('is green, with the two symbols the cards named among the pairs compared', () => {
    expect(
      result.findings.map((f) => `${f.file} ${f.symbol}.${f.slot} -> ${f.reader}`),
      'a doc comment in this repository prescribes a spelling a shared reader owns',
    ).toEqual([]);

    // Named rather than counted: these two are the reason the gate exists, and a
    // refactor that stopped comparing them would leave the green above intact.
    const pairs = result.compared.map((c) => `${c.symbol}.${c.slot}`);
    expect(pairs).toContain('useNavigationOverlay.objectName');
    expect(pairs).toContain('useSettledSchema.#0');
  });

  /**
   * The ledger is an allowlist that only shrinks. Two directions are pinned,
   * because a waiver can go wrong both ways: a row whose defect is gone reads as
   * a live waiver for nothing, and a row with no reason is indistinguishable
   * from switching the gate off for that file.
   */
  it('keeps every exemption honest — no stale row, and a reason on each', () => {
    expect(
      result.stale,
      'a KNOWN_HAND_SPELLINGS row names a doc comment this gate no longer finds — the defect ' +
        'it waives is fixed, so the row is a live waiver for nothing. Delete it.',
    ).toEqual([]);

    for (const [key, reason] of KNOWN_HAND_SPELLINGS) {
      expect(reason.length, `KNOWN_HAND_SPELLINGS[${key}] must carry a real justification`).toBeGreaterThan(40);
      expect(reason, `KNOWN_HAND_SPELLINGS[${key}] must name the card that decides the prose`).toMatch(
        /objectui#\d+/,
      );
    }
  });

  /**
   * The gate's first run over this repository found exactly one instance, and it
   * was a real one rather than a false positive: `navigation-overlay.tsx`'s
   * file-header `@example` taught objectui#7638's spelling, one file over from
   * the doc block PR #7648 fixed. objectui#7652 fenced the prose fixes out of the
   * gate's own PR, so it landed carried as the ledger's only row.
   *
   * objectui#7787 then fixed that example and deleted the row in the same change,
   * so BOTH directions are pinned here by name rather than by count: the ledger
   * is empty, and the instance it named is gone from the raw findings — not
   * merely waived out of them. A count would let either be swapped for something
   * else without anyone noticing, and `result.raw` is read (not `result.findings`)
   * precisely because an empty ledger makes the two identical: reading the
   * pre-waiver list is what keeps this assertion honest if a row is ever added
   * back.
   *
   * That the gate still REACHES this pair is asserted above, where
   * `useNavigationOverlay.objectName` is named among the compared pairs — without
   * it, a scan that stopped looking at this file would satisfy everything here.
   */
  it('has drained its ledger: no waived instance, and objectui#7787 is really gone', () => {
    expect([...KNOWN_HAND_SPELLINGS.keys()]).toEqual([]);
    expect(result.raw.map((f) => f.key)).not.toContain(
      'packages/components/src/custom/navigation-overlay.tsx::useNavigationOverlay::objectName',
    );
  });

  it('is wired where the sibling parse-based gates run', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(manifest.scripts['check:doc-example-readers']).toBe('node scripts/check-doc-example-shared-reader.mjs');

    const ci = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
    expect(ci, 'the gate must run in CI, next to the other source-parsing gates').toContain(
      'run: pnpm check:doc-example-readers',
    );

    // The page that inventories the gates is pinned by command (objectui#3653), so
    // this would fail there too — asserted here as well because a reader looking
    // for this gate looks at this file first.
    const page = fs.readFileSync(path.join(repoRoot, 'content/docs/guide/ci-cd-pipeline.md'), 'utf8');
    expect(page).toContain('check:doc-example-readers');
  });
});

/**
 * objectui#9331 — an `@example` fence ends where CommonMark ends it
 *
 * ## The defect
 *
 * `exampleFences` matched with a non-greedy
 * `/```(?:tsx?|jsx?|typescript)\n([\s\S]*?)```/g`. Non-greedy means the block
 * ended at the FIRST run of three backticks anywhere after the opener — so an
 * example written inside a LONGER wrapper, which is how a docblock legitimately
 * quotes a fence, ended at the quoted INNER marker and this gate parsed a
 * TRUNCATED example. That is the quiet kind of wrong answer: half an example is
 * still valid TSX, so it parses clean, finds no hand-spelled reader in the half
 * it never saw, and the gate reports OK.
 *
 * ## Why these cases and not the live corpus
 *
 * Measured on this card's base over the gate's real population — 1439 source
 * files, 16511 JSDoc blocks, 135 extracted fences — the repair is byte-identical
 * (both sides hash to 0fe1e95e…). The single 4-backtick construct on that
 * surface is an inline code SPAN on a prose line, not an opener. So the defect
 * is LATENT and only a case built here can fail before the repair and pass after.
 */
describe('an @example fence inside a longer wrapper (objectui#9331)', () => {
  // ⛔ Fixtures are arrays of string literals, never raw fences in this file: a
  // backtick run at the start of a line here would open a fence in the gates
  // this suite drives, and would be swept by greps over this tree.
  const block = (...body: string[]) => ['/**', ' * @example', ...body.map((l) => ` * ${l}`), ' */'].join('\n');

  it('reads a four-backtick example whole, not truncated at the quoted marker', () => {
    // Before the repair this returned only 'const md = `code`;\n' — everything
    // from the quoted marker onward, `more();` included, was silently dropped.
    const fences = exampleFences(block('````tsx', 'const md = `code`;', '```', 'more();', '````'));
    expect(fences).toHaveLength(1);
    expect(fences[0]).toContain('more();');
    expect(fences[0]).toBe(['const md = `code`;', '```', 'more();', ''].join('\n'));
  });

  it('does not lift a tsx block quoted inside a markdown wrapper', () => {
    // Before the repair this returned BOTH — the quoted example was extracted as
    // if it were the documented one, and then judged.
    const fences = exampleFences(
      block('````md', '```tsx', 'quoted(1);', '```', '````', '', '```tsx', 'real(2);', '```'),
    );
    expect(fences).toEqual(['real(2);\n']);
  });

  it('ignores a fence whose language is not a code language — the other control', () => {
    expect(exampleFences(block('```md', 'not code;', '```'))).toEqual([]);
  });

  it('still reads an ordinary three-backtick example — the lit control', () => {
    // Guards against a walk that simply returns nothing: without this, both
    // cases above would pass on an extractor that had stopped extracting.
    expect(exampleFences(block('```tsx', 'const a = 1;', '```'))).toEqual(['const a = 1;\n']);
  });

  it('yields nothing for an unterminated fence, as the replaced regex did', () => {
    expect(exampleFences(block('```tsx', 'const a = 1;'))).toEqual([]);
  });
});

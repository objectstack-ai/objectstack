// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// The read-side leg of the `allowOrgOverride` → `allowEnvironmentOverlay`
// rename; the parse, registry and registration legs are
// `metadata-type-registry-allow-org-override-retirement.test.ts`, which says
// why this one exists. It reads outside `packages/spec`, so it is listed in
// `vitest.repo-tests.json` and runs under `test:repo`.

// ─── Tree-scoped absence of a CODE reference, with a DECLARED radius ─────────
//
// The walk reads `packages/**/*.ts` and `examples/*/src/**/*.ts`, both declared
// for `@objectstack/spec#test:repo` in `scripts/cross-package-test-inputs.mjs`
// and mirrored in `turbo.json`, so a reader of the old key anywhere in the
// radius puts this suite into `turbo ls --affected`. `.tsx` is not scanned and
// not declared, for the reason the compliance-families pin records (no
// cross-package hint may reach a `.tsx` test); a `.tsx` reader belongs to the
// sibling Studio repository, which declares its own response type.
//
// What counts is an IDENTIFIER, or a quoted property key / element access,
// read off the TypeScript AST — never a comment or a string, which record the
// key's history (CHANGELOG-shaped prose, quoted former refusal sentences, the
// tombstone's own prescription, the retired-keys entry). One reference is
// legitimate by SHAPE, not by site: the tombstone declaration itself, a
// property whose initializer is a `retiredKey(...)` call. One file is
// legitimate by PURPOSE: the sibling refusal pin, which authors the old key to
// prove the parse refuses it. It is not skipped — its references are counted
// apart and REQUIRED, which makes it this leg's live positive control: the
// walker reached it and the matcher saw real code.
describe('tree-scoped absence: no TypeScript source in the declared radius reads or writes `allowOrgOverride`', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');
  /** The refusal pin: authors the old key on purpose (see above). Counted apart, never skipped. */
  const REFUSAL_PIN = THIS_FILE.replace(/-absence\.test\.ts$/, '-retirement.test.ts');
  const OLD = 'allowOrgOverride';
  const NEW = 'allowEnvironmentOverlay';

  /** The walked roots — declared in `scripts/cross-package-test-inputs.mjs` under `@objectstack/spec`. */
  const WALK_ROOTS = ['packages', 'examples'];
  const IN_RADIUS = (rel: string) =>
    (rel.startsWith('packages/') && rel.endsWith('.ts'))
    || /^examples\/[^/]+\/src\/.+\.ts$/.test(rel);
  /** Build, SCM and cache state — not authored sources. */
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  /** The tombstone declaration: `allowOrgOverride: retiredKey(...)`. Exempt by shape. */
  const isTombstoneDeclaration = (node: ts.Node): boolean =>
    ts.isPropertyAssignment(node.parent)
    && node.parent.name === node
    && ts.isCallExpression(node.parent.initializer)
    && ts.isIdentifier(node.parent.initializer.expression)
    && node.parent.initializer.expression.text === 'retiredKey';

  /**
   * Every CODE reference to each of `names` in `text`, as `line:col` per name —
   * identifiers and quoted keys, never comments or prose strings. One parse
   * serves every name: the walk below asks two names of the same file, and the
   * files holding both are the largest in the radius (megabytes each).
   */
  const codeReferencesByName = (fileName: string, text: string, names: readonly string[]): Map<string, string[]> => {
    const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const found = new Map(names.map((name) => [name, [] as string[]]));
    const at = (name: string, node: ts.Node) => {
      const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      found.get(name)!.push(`${line + 1}:${character + 1}`);
    };
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node) && found.has(node.text) && !isTombstoneDeclaration(node)) at(node.text, node);
      else if (ts.isStringLiteral(node) && found.has(node.text) && node.parent) {
        const p = node.parent;
        // A quoted key or an element access is a reference; any other string is prose.
        if ((ts.isPropertyAssignment(p) && p.name === node)
          || (ts.isElementAccessExpression(p) && p.argumentExpression === node)
          || (ts.isPropertySignature(p) && p.name === node)) at(node.text, node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return found;
  };
  /** Every CODE reference to `name` in `text`, as `line:col`. */
  const codeReferences = (fileName: string, text: string, name: string): string[] =>
    codeReferencesByName(fileName, text, [name]).get(name)!;

  it('the matcher sees a code reference and ignores a mention (anti-vacuity)', () => {
    const refs = (src: string) => codeReferences('probe.ts', src, OLD);
    expect(refs('const open = types.filter((e) => e.allowOrgOverride);')).toHaveLength(1);
    expect(refs('if (!entry?.allowOrgOverride) continue;')).toHaveLength(1);
    expect(refs("expect(e).toMatchObject({ allowOrgOverride: true });")).toHaveLength(1);
    expect(refs("const v = e['allowOrgOverride'];")).toHaveLength(1);
    expect(refs("const { allowOrgOverride } = entry;")).toHaveLength(1);
    expect(refs('// the registry declared `allowOrgOverride: true` before 18')).toHaveLength(0);
    expect(refs("const s = 'renamed from allowOrgOverride';")).toHaveLength(0);
    expect(refs("expect(e).not.toHaveProperty('allowOrgOverride');")).toHaveLength(0);
    expect(refs('const t = `kernel/MetadataTypeRegistryEntry:allowOrgOverride`;')).toHaveLength(0);
    // The one legitimate reference, exempt by shape — and only that shape.
    expect(refs("const S = z.object({ allowOrgOverride: retiredKey('…') });")).toHaveLength(0);
    expect(refs("const S = z.object({ allowOrgOverride: z.boolean() });")).toHaveLength(1);
  });

  it('no code reference survives inside the declared radius', () => {
    const offenders: string[] = [];
    const refusalPinReferences: string[] = [];
    const newReaders = new Set<string>();
    let visited = 0;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
        if (entry.isDirectory()) {
          if (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
          walk(full);
          continue;
        }
        if (!entry.isFile() || !IN_RADIUS(rel) || rel === THIS_FILE) continue;
        visited += 1;
        let text: string;
        try {
          text = fs.readFileSync(full, 'utf-8');
        } catch (err) {
          // A path that vanished mid-walk (tsup's transient bundled config)
          // cannot be a reference that survives; every other fault is real.
          if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') continue;
          throw err;
        }
        const names = [NEW, OLD].filter((name) => text.includes(name));
        if (names.length === 0) continue;
        const refs = codeReferencesByName(rel, text, names);
        if ((refs.get(NEW)?.length ?? 0) > 0) newReaders.add(rel);
        for (const where of refs.get(OLD) ?? []) {
          (rel === REFUSAL_PIN ? refusalPinReferences : offenders).push(`${rel}:${where}`);
        }
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));

    // Anti-vacuity: the walk covered the tree, and it SEES code references —
    // the hand-renamed readers outside this package are found by the same
    // matcher under the new name.
    expect(visited).toBeGreaterThan(1000);
    expect(REFUSAL_PIN).not.toBe(THIS_FILE);
    expect(fs.existsSync(path.join(REPO_ROOT, REFUSAL_PIN)), `${REFUSAL_PIN} exists`).toBe(true);
    // Live positive control: the refusal pin's deliberate `allowOrgOverride: true`
    // and `: false` are real code references, and the walk found them.
    expect(refusalPinReferences.length).toBeGreaterThanOrEqual(2);
    expect([...newReaders]).toEqual(expect.arrayContaining([
      'packages/metadata-protocol/src/protocol.ts',
      'packages/metadata-protocol/src/sys-metadata-repository.ts',
      'packages/spec/src/kernel/metadata-plugin.zod.ts',
    ]));
    expect(
      offenders,
      'a code reference to `allowOrgOverride` reads `undefined` against the tombstone and closes every type — read `allowEnvironmentOverlay`',
    ).toEqual([]);
  });
});

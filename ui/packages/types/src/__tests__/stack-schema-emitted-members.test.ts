// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every `LayoutSchema` member SHIPS the members it declares (objectui#6151).
 *
 * ## The defect
 *
 * `StackSchema` was declared `extends Omit<FlexSchema, 'type'>` — "everything
 * `FlexSchema` has, with a different `type`". The shipped declaration carried
 * only `type`.
 *
 * `Omit<T, K>` is `Pick<T, Exclude<keyof T, K>>`, and `keyof T` on a type
 * carrying a string index signature is `string | number` — the literal member
 * names are ABSORBED. `FlexSchema` inherited `BaseSchema`'s `[key: string]: any`
 * (objectui#5155) until objectui#8347, so `Exclude<string | number, 'type'>` is still
 * `string | number`, and the `Pick` reconstructed a type with the index
 * signature and none of the named members. Measured on the emitted
 * `dist/layout.d.ts` before the fix:
 *
 *   FlexSchema  -> 25 declared properties
 *   StackSchema ->  1 declared property: type
 *
 * `gap`, `children`, `align`, `justify`, `direction`, `wrap` and all 19 other
 * `BaseSchema` members were absent. Nothing errored — the index signature kept
 * every absent key assignable and readable as `any` — so the only symptom was
 * in the tools that READ the declaration: editor completion on a `stack` node
 * offered `type` and nothing else, and objectui#6143's docs-vs-type sweep read
 * `stack.mdx`'s `gap` / `children` / `className` as documenting keys that do not
 * exist. The docs were right; the type was wrong.
 *
 * ## Why this reads the EMITTED declaration and not the source
 *
 * ⚠️ This is the load-bearing part of the guard. A source-level type assertion
 * (`Expect<Equal<StackSchema['gap'], number | undefined>>`) passed on the broken
 * code: the index signature answered for `gap` with `any`, and `any` satisfies
 * everything. The gap between "what the source says" and "what the `.d.ts`
 * declares" IS this bug, so a guard that never opens the `.d.ts` cannot see it.
 *
 * ## Why it emits its own declarations instead of reading `dist/`
 *
 * This repo's per-PR `test` job runs `pnpm test` with NO build step ahead of it
 * (turbo's `test` task only `dependsOn: ["^build"]` — the DEPENDENCY closure,
 * never the package's own build), and `packages/types` has no workspace
 * dependencies, so nothing builds it. A guard that read `dist/layout.d.ts` would
 * be absent-or-stale on a cold CI cache — vacuous exactly where it is needed.
 * The same trap is recorded in `package-exports-manifest.test.ts`'s header.
 *
 * So this file runs the package's OWN tsconfig through the compiler API and
 * emits declarations to a scratch directory, then measures the result with the
 * checker. That is the artifact a consumer resolves, derived deterministically
 * and with no dependence on CI job ordering.
 *
 * ## What each assertion catches
 *
 *   1. non-vacuity — the emit really produced a declaration the checker can
 *      read, and `FlexSchema` in it carries its six flex members. Without this,
 *      a broken emit would make every assertion below pass over an empty set.
 *   2. the measurement — `StackSchema` declares EXACTLY what `FlexSchema`
 *      declares. Set equality, not a spot check: it fails both when a member is
 *      erased again and when the two drift apart.
 *   3. the class tripwire — every member of the `LayoutSchema` union declares
 *      all of `BaseSchema`'s named members. Each one extends `BaseSchema`, so
 *      any future heritage clause that crosses a mapped type over an
 *      index-signature-bearing type reds here, not only the one this card fixed.
 *      Sixteen union members satisfy it today; `StackSchema` was the one that
 *      did not.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Emit declarations with the package's OWN build settings, into a scratch dir
 * under `node_modules/` — which is gitignored, and from which Node's module
 * resolution still walks up to `packages/types/node_modules`, so the emitted
 * `import type … from '@objectstack/spec/ui'` still resolves.
 */
function emitDeclarations(): { dir: string; layout: string } {
  const configPath = join(packageRoot, 'tsconfig.json');
  const readConfig = ts.readConfigFile(configPath, ts.sys.readFile);
  if (readConfig.error) {
    throw new Error(ts.flattenDiagnosticMessageText(readConfig.error.messageText, '\n'));
  }
  const parsed = ts.parseJsonConfigFileContent(readConfig.config, ts.sys, packageRoot);

  const dir = mkdtempSync(join(packageRoot, 'node_modules', '.stack-schema-pin-'));
  const program = ts.createProgram([join(packageRoot, 'src', 'layout.ts')], {
    ...parsed.options,
    outDir: dir,
    declaration: true,
    emitDeclarationOnly: true,
    declarationMap: false,
    noEmit: false,
    // The real build is `composite`/incremental; neither is meaningful for a
    // one-shot emit into a scratch dir, and both would write build info next to
    // the package's real artifacts.
    composite: false,
    incremental: false,
    tsBuildInfoFile: undefined,
  });
  const emitted = program.emit();
  const layout = join(dir, 'layout.d.ts');
  if (!existsSync(layout)) {
    const diagnostics = [...emitted.diagnostics, ...program.getSemanticDiagnostics()]
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
      .slice(0, 10);
    throw new Error(`declaration emit produced no layout.d.ts:\n${diagnostics.join('\n')}`);
  }
  return { dir, layout };
}

const { dir: scratchDir, layout: emittedLayout } = emitDeclarations();
afterAll(() => rmSync(scratchDir, { recursive: true, force: true }));

const program = ts.createProgram([emittedLayout], {
  noEmit: true,
  skipLibCheck: true,
  strict: true,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
});
const checker = program.getTypeChecker();

function moduleExports(file: string): Map<string, ts.Symbol> {
  const sourceFile = program.getSourceFile(file);
  const moduleSymbol = sourceFile && checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) throw new Error(`no module symbol for ${file}`);
  return new Map(checker.getExportsOfModule(moduleSymbol).map((s) => [s.getName(), s]));
}

/** The property names the EMITTED declaration of `name` declares. */
function declaredMembers(name: string): string[] {
  const symbol = moduleExports(emittedLayout).get(name);
  if (!symbol) throw new Error(`${name} is not exported from the emitted layout.d.ts`);
  return checker
    .getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol))
    .map((p) => p.getName())
    .sort();
}

/** `BaseSchema`'s named members, read from the emitted `base.d.ts` beside it. */
function baseSchemaMembers(): string[] {
  const base = join(scratchDir, 'base.d.ts');
  const symbol = moduleExports(base).get('BaseSchema');
  if (!symbol) throw new Error('BaseSchema is not exported from the emitted base.d.ts');
  return checker
    .getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol))
    .map((p) => p.getName())
    .sort();
}

/** The member interfaces of the emitted `LayoutSchema` union, by name. */
function layoutUnionMembers(): { name: string; members: string[] }[] {
  const symbol = moduleExports(emittedLayout).get('LayoutSchema');
  if (!symbol) throw new Error('LayoutSchema is not exported from the emitted layout.d.ts');
  const union = checker.getDeclaredTypeOfSymbol(symbol);
  const parts = union.isUnion() ? union.types : [union];
  return parts.map((t) => ({
    name: t.symbol?.getName() ?? '<anonymous>',
    members: checker.getPropertiesOfType(t).map((p) => p.getName()).sort(),
  }));
}

/* ── 1. Non-vacuity ──────────────────────────────────────────────────────── */

describe('the emitted declaration is readable (guards every assertion below)', () => {
  it('emits a layout.d.ts whose FlexSchema carries its six flex members', () => {
    const flex = declaredMembers('FlexSchema');
    // If the emit collapsed or the checker read the wrong file, this is where it
    // shows — the assertions below all compare against this same population.
    expect(flex).toEqual(expect.arrayContaining([
      'align', 'direction', 'gap', 'justify', 'wrap', 'children',
    ]));
    expect(flex.length).toBeGreaterThan(20);
  });

  it('reads a plausible BaseSchema member set', () => {
    expect(baseSchemaMembers().length).toBeGreaterThan(15);
  });
});

/* ── 2. The measurement ──────────────────────────────────────────────────── */

describe('StackSchema ships the members it declares (objectui#6151)', () => {
  it('declares EXACTLY what FlexSchema declares, less the one member only `flex` has a producer for', () => {
    // Before the fix: StackSchema declared ['type'] against FlexSchema's 25.
    // objectui#10872 batch 9 declared the node-level `responsiveStyles` on
    // `FlexSchema` alone (a producer writes it on `flex` nodes, none on `stack`),
    // so it is the one member the two do not share. It is named, so a second
    // difference still turns this red.
    const FLEX_ONLY = ['responsiveStyles'];
    expect(declaredMembers('FlexSchema')).toEqual(expect.arrayContaining(FLEX_ONLY));
    expect(declaredMembers('StackSchema')).toEqual(
      declaredMembers('FlexSchema').filter((member) => !FLEX_ONLY.includes(member)),
    );
  });

  it.each(['gap', 'children', 'align', 'justify', 'direction', 'wrap', 'className'])(
    'declares `%s` as a named member of the emitted declaration, not a key a mapped type dropped',
    (member) => {
      // `getPropertyOfType` returned undefined for every one of these before the
      // fix, while `StackSchema['gap']` in SOURCE resolved to `any` and hid it.
      expect(declaredMembers('StackSchema')).toContain(member);
    },
  );

  it('still discriminates the union — `type` is the stack literal', () => {
    const symbol = moduleExports(emittedLayout).get('StackSchema');
    const type = checker.getDeclaredTypeOfSymbol(symbol!);
    const typeProp = checker.getPropertyOfType(type, 'type');
    expect(typeProp).toBeDefined();
    expect(checker.typeToString(checker.getTypeOfSymbol(typeProp!))).toBe('"stack"');
  });
});

/* ── 3. The class tripwire ───────────────────────────────────────────────── */

describe('no LayoutSchema member loses BaseSchema’s members to a mapped type', () => {
  it('every union member declares all of BaseSchema’s named members', () => {
    const base = baseSchemaMembers();
    const collapsed = layoutUnionMembers()
      .map(({ name, members }) => ({ name, missing: base.filter((b) => !members.includes(b)) }))
      .filter(({ missing }) => missing.length > 0);

    // Every LayoutSchema member extends BaseSchema, so a missing BaseSchema
    // member means the heritage clause crossed a mapped type and collapsed —
    // `Omit`, `Pick`, or anything else built on `keyof`.
    expect(collapsed, `member erasure in the emitted declaration: ${JSON.stringify(collapsed)}`)
      .toEqual([]);
  });

  it('checks a plausible number of union members (non-vacuity)', () => {
    expect(layoutUnionMembers().length).toBeGreaterThan(10);
  });
});

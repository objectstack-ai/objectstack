/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7209 — `ObjectViewRenderer` reads `SchemaRendererContext` AS
 * DECLARED.
 *
 * This module used to re-declare the imported context at module scope as a
 * `React.Context<any>`, which erased `SchemaRendererContextType` for every read
 * of it: a member the context does not declare type-checked clean — the
 * mechanism behind objectui#7206's phantom `ctx.formValues ?? ctx.data`
 * channel. The re-declaration is gone and the hook reads the import directly;
 * the one value that genuinely disagrees with a consumer (`null` handed to the
 * REQUIRED `ObjectViewProps.dataSource`, objectui#7842) now carries its own
 * narrow assertion at that value instead of an erasure of the whole context.
 *
 * The harness, and why it is a `ts.Program` rather than a `@ts-expect-error`
 * in a test file, is explained once in plugin-form's
 * `schemaRendererContextRead-7209.test.ts`; this file is the same harness over
 * this package's site. In short: the DECLARED type is read off
 * `@object-ui/react`'s own export in the same program; the site is located by
 * NAME and must hold exactly one read; a cast planted back IN MEMORY must read
 * `any` (so the verdicts below can fail); `formValues`, the member
 * objectui#7206 retired, must not be readable (PROBE); `dataSource` must read
 * at its declared type (LIT CONTROL).
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

/** Rooted at THIS file, never at `process.cwd()`. */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');
const slash = (p: string): string => p.replace(/\\/g, '/');
const SITE_FILE = slash(join(HERE, '..', 'index.tsx'));
const CONTEXT_FILE = slash(join(REPO_ROOT, 'packages', 'react', 'src', 'context', 'SchemaRendererContext.tsx'));

/** The renderer that reads the context, by the name it is declared under. */
const SITES = ['ObjectViewRenderer'] as const;
/** The member objectui#7206 retired — it never existed on the context. */
const PHANTOM = 'formValues';
/** What the calibration leg plants back: the cast this card removed. */
const PLANTED_CAST = " as import('react').Context<any>";

interface Reading {
  type: string;
  isAny: boolean;
  phantomReadable: boolean;
  /** The `dataSource` member's type, or null when the value has no such member. */
  dataSource: string | null;
}

/**
 * A program over the site file, optionally with the site's text replaced in
 * memory. Every other file is parsed once and shared between the two programs
 * `measure()` builds, so the calibration program costs one file, not the tree.
 */
function programFactory(): (siteText?: string) => ts.Program {
  const configPath = join(REPO_ROOT, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, ' '));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, REPO_ROOT, undefined, configPath);
  const options: ts.CompilerOptions = {
    ...parsed.options,
    noEmit: true,
    skipLibCheck: true,
    types: [],
    paths: { ...parsed.options.paths, '@object-ui/react': ['packages/react/src'] },
  };
  const host = ts.createCompilerHost(options);
  const parse = host.getSourceFile.bind(host);
  const parsedFiles = new Map<string, ts.SourceFile | undefined>();
  let override: string | undefined;
  host.getSourceFile = (fileName, languageVersion, ...rest) => {
    if (override !== undefined && slash(fileName) === SITE_FILE) {
      return ts.createSourceFile(fileName, override, languageVersion, true);
    }
    if (!parsedFiles.has(fileName)) parsedFiles.set(fileName, parse(fileName, languageVersion, ...rest));
    return parsedFiles.get(fileName);
  };
  return (siteText) => {
    override = siteText;
    return ts.createProgram([SITE_FILE], options, host);
  };
}

/** The one `useContext(SchemaRendererContext…)` call inside the named declaration. */
function hookCall(program: ts.Program, owner: string): ts.CallExpression {
  const sf = program.getSourceFile(SITE_FILE);
  if (!sf) throw new Error(`setup failure: ${SITE_FILE} is not a program input`);
  let ownerNode: ts.Node | undefined;
  const findOwner = (node: ts.Node): void => {
    if (ownerNode) return;
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node))
      && node.name && ts.isIdentifier(node.name) && node.name.text === owner) {
      ownerNode = node;
      return;
    }
    ts.forEachChild(node, findOwner);
  };
  findOwner(sf);
  if (!ownerNode) throw new Error(`setup failure: no declaration named \`${owner}\` in ${SITE_FILE}`);
  const calls: ts.CallExpression[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node)
      && /(^|\.)useContext$/.test(node.expression.getText(sf))
      && node.arguments.length === 1
      && /\bSchemaRendererContext\b/.test(node.arguments[0].getText(sf))) {
      calls.push(node);
    }
    ts.forEachChild(node, walk);
  };
  walk(ownerNode);
  if (calls.length !== 1) {
    throw new Error(`setup failure: \`${owner}\` holds ${calls.length} reads of SchemaRendererContext, expected exactly 1`);
  }
  return calls[0];
}

function describeValue(checker: ts.TypeChecker, type: ts.Type, at: ts.Node): Reading {
  const isAny = (type.flags & ts.TypeFlags.Any) !== 0;
  const value = checker.getNonNullableType(type);
  const member = checker.getPropertyOfType(value, 'dataSource');
  return {
    type: checker.typeToString(type),
    isAny,
    phantomReadable: isAny
      || checker.getPropertyOfType(value, PHANTOM) !== undefined
      || checker.getIndexInfosOfType(value).length > 0,
    dataSource: member ? checker.typeToString(checker.getTypeOfSymbolAtLocation(member, at)) : null,
  };
}

/** `SchemaRendererContextType | null` as `@object-ui/react` exports it. */
function declared(program: ts.Program): Reading {
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(CONTEXT_FILE);
  const moduleSymbol = sf && checker.getSymbolAtLocation(sf);
  const exported = moduleSymbol && checker.getExportsOfModule(moduleSymbol)
    .find((s) => s.name === 'SchemaRendererContext');
  if (!sf || !exported) throw new Error('setup failure: `SchemaRendererContext` did not resolve to its source export');
  const [valueType] = checker.getTypeArguments(checker.getTypeOfSymbol(exported) as ts.TypeReference);
  if (!valueType) throw new Error('setup failure: the context export carries no type argument');
  return describeValue(checker, valueType, sf);
}

function readSites(program: ts.Program): Record<string, Reading> {
  const checker = program.getTypeChecker();
  return Object.fromEntries(SITES.map((owner) => {
    const call = hookCall(program, owner);
    return [owner, describeValue(checker, checker.getTypeAtLocation(call), call)];
  }));
}

interface Measurement {
  declared: Reading;
  sites: Record<string, Reading>;
  planted: Record<string, Reading>;
}

function measure(): Measurement {
  const build = programFactory();
  const program = build();
  const sf = program.getSourceFile(SITE_FILE)!;
  // Plant the cast after each context argument, last position first so the
  // earlier offsets stay valid.
  const ends = SITES.map((owner) => hookCall(program, owner).arguments[0].end).sort((a, b) => b - a);
  let planted = sf.text;
  for (const end of ends) planted = planted.slice(0, end) + PLANTED_CAST + planted.slice(end);
  return {
    declared: declared(program),
    sites: readSites(program),
    planted: readSites(build(planted)),
  };
}

// MODULE SCOPE on purpose (AGENTS.md 测试纪律): the compiler work lands in the
// import phase, which no test or hook timeout bounds. A failure is kept and
// re-thrown by every test that reads the measurement, so it surfaces as named
// failures rather than as a collection error.
let outcome: Measurement | Error;
try {
  outcome = measure();
} catch (error) {
  outcome = error instanceof Error ? error : new Error(String(error));
}
const measurement = (): Measurement => {
  if (outcome instanceof Error) throw outcome;
  return outcome;
};

describe('objectui#7209 — the instrument is calibrated before it is believed', () => {
  it('resolved the declared context type from `@object-ui/react`’s own export', () => {
    const { declared: d } = measurement();
    expect(d.isAny).toBe(false);
    expect(d.phantomReadable).toBe(false);
    expect(d.dataSource).toMatch(/\bDataSource\b/);
  });

  for (const owner of SITES) {
    it(`\`${owner}\` with the cast planted back IN MEMORY reads \`any\` — the verdicts below can fail`, () => {
      expect(measurement().planted[owner]).toMatchObject({ isAny: true, phantomReadable: true, dataSource: null });
    });
  }
});

describe('objectui#7209 — each bridge reads SchemaRendererContext as declared', () => {
  for (const owner of SITES) {
    it(`\`${owner}\`: the hook call carries the declared context type, not \`any\``, () => {
      const { declared: d, sites } = measurement();
      expect({ owner, type: sites[owner].type, isAny: sites[owner].isAny })
        .toEqual({ owner, type: d.type, isAny: false });
    });

    it(`\`${owner}\`: PROBE — the phantom \`${PHANTOM}\` member is not readable off the value`, () => {
      expect(measurement().sites[owner].phantomReadable).toBe(false);
    });

    it(`\`${owner}\`: LIT CONTROL — \`dataSource\` reads at its declared type`, () => {
      const { declared: d, sites } = measurement();
      expect(sites[owner].dataSource).toBe(d.dataSource);
    });
  }
});

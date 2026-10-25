// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `AnySchema` holds every declared `BaseSchema` node type, and `SchemaByType`
 * resolves each single-literal member to itself (objectui#11478).
 *
 * ## The defect this pins shut
 *
 * `AnySchema`'s docblock said it was the union of all component schemas, and it
 * was not: node types this package declares and exports, each extending
 * `BaseSchema` with a literal `type`, were not members, and neither was the
 * standalone `ActionBarSchema`. Its `BaseSchema` arm admits any `type` string,
 * so no value was refused; what was wrong was the answer the union gives about
 * a type. `SchemaByType` of their literals was `never`, and narrowing on
 * `type` never reached them. objectui#11466's slot union inherits this list,
 * so without them their correct literals would be refused there.
 *
 * ## What re-derives the claim (AGENTS.md #9)
 *
 * The population is computed, never listed. The compiler API reads this
 * package's own sources with its own `tsconfig.json`, so nothing depends on a
 * built `dist/`, the same reason `object-view-slot-key-lists.test.ts` gives.
 * It takes every type exported from the root barrel or from a published
 * subpath entry (read from `package.json` `exports`) that:
 *
 *   - is a non-generic object type, not a union (a union is a list, not a node
 *     type);
 *   - declares `type` as a string literal or a union of string literals; and
 *   - reaches `BaseSchema` through its `extends` chain: an `extends` clause, an
 *     intersection constituent, or the first type argument of a utility type in
 *     an `extends` clause (`OmitDeclared` of a node type, the way
 *     `InputShorthandSchema` derives from `InputSchema`).
 *
 * Each one must be a member of `AnySchema`. The enumerator's own control runs
 * it over a virtual module, so the test shows it can fail for the reason it
 * exists.
 *
 * ## The limits, said so they are not read as covered
 *
 * - `ActionBarSchema` does not extend `BaseSchema`, so the enumeration cannot
 *   see it. It is held by name below, and nothing finds the next standalone
 *   node type of its kind.
 * - The spec-row authoring faces (`AuthoringNode`, `./authoring-nodes.ts`)
 *   carry `BaseSchema`'s member names without extending it. They are a
 *   separate list and their literals overlap this union's, so they are outside
 *   the population on purpose, ⛔ not by oversight.
 * - `SchemaByType` of a member whose `type` is a union of literals (for
 *   example `InputShorthandSchema`) is `never`, because `Extract` asks whether
 *   the member's whole `type` fits the one literal. The round-trip below checks
 *   single-literal members only.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const srcRoot = join(packageRoot, 'src');
const indexFile = join(srcRoot, 'index.ts');

/**
 * A module that exists only in this program: never written to disk. It is the
 * enumerator's control and the `SchemaByType` round-trip probe.
 */
const probeFile = join(srcRoot, '__anyschema-pin-probe__.ts');
const PROBE_SOURCE = `
import type { AnySchema, BaseSchema, ButtonSchema, SchemaByType } from './index.js';

// Control module for the enumerator, judged against ControlUnion. The utility
// type is spelled the way form.ts spells its module-private OmitDeclared.
type OmitDeclaredControl<T, K extends PropertyKey> = { [P in keyof T as P extends K ? never : P]: T[P] };
export interface ControlInsideSchema extends BaseSchema { type: 'control-inside' }
export interface ControlOutsideSchema extends BaseSchema { type: 'control-outside' }
export interface ControlDerivedSchema extends OmitDeclaredControl<ButtonSchema, 'type'> { type: 'control-derived' }
export interface ControlStandaloneSchema { type: 'control-standalone'; className?: string }
export interface ControlWideSchema extends BaseSchema { tag?: string }
export type ControlUnion = ControlInsideSchema | ButtonSchema;

// The SchemaByType round-trip over every member of the real union.
type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;
type Same<A, B> = (<X>() => X extends A ? 1 : 2) extends (<X>() => X extends B ? 1 : 2) ? true : false;
type RoundTrip<M> = M extends { type: infer L extends string }
  ? string extends L
    ? never
    : true extends IsUnion<L>
      ? never
      : Same<SchemaByType<L>, M> extends true
        ? never
        : M
  : never;
export type SchemaByTypeMisses = RoundTrip<AnySchema>;
`;

/** The source file of every published subpath entry, from `package.json` `exports`. */
function publishedEntryFiles(): string[] {
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
    exports: Record<string, { import: string }>;
  };
  return Object.values(manifest.exports).map((entry) => {
    const match = /^\.\/dist\/(.+)\.js$/.exec(entry.import);
    if (!match) throw new Error(`unrecognised export target ${entry.import}`);
    return join(srcRoot, `${match[1]}.ts`);
  });
}

function createProgram(): ts.Program {
  const configPath = join(packageRoot, 'tsconfig.json');
  const readConfig = ts.readConfigFile(configPath, ts.sys.readFile);
  if (readConfig.error) {
    throw new Error(ts.flattenDiagnosticMessageText(readConfig.error.messageText, '\n'));
  }
  const parsed = ts.parseJsonConfigFileContent(readConfig.config, ts.sys, packageRoot);
  const options: ts.CompilerOptions = {
    ...parsed.options,
    noEmit: true,
    declaration: false,
    composite: false,
    incremental: false,
    tsBuildInfoFile: undefined,
  };
  const host = ts.createCompilerHost(options);
  const { getSourceFile, fileExists, readFile } = host;
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) =>
    fileName === probeFile
      ? ts.createSourceFile(fileName, PROBE_SOURCE, languageVersion, true)
      : getSourceFile.call(host, fileName, languageVersion, onError, shouldCreate);
  host.fileExists = (fileName) => fileName === probeFile || fileExists.call(host, fileName);
  host.readFile = (fileName) => (fileName === probeFile ? PROBE_SOURCE : readFile.call(host, fileName));
  return ts.createProgram([...new Set([indexFile, ...publishedEntryFiles(), probeFile])], options, host);
}

const program = createProgram();
const checker = program.getTypeChecker();

function moduleExports(file: string): Map<string, ts.Symbol> {
  const sourceFile = program.getSourceFile(file);
  if (!sourceFile) throw new Error(`not in the program: ${file}`);
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) throw new Error(`not a module: ${file}`);
  return new Map(
    checker.getExportsOfModule(moduleSymbol).map((exported) => [
      exported.getName(),
      exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported,
    ]),
  );
}

const rootExports = moduleExports(indexFile);

function declaredType(exports: Map<string, ts.Symbol>, name: string): ts.Type {
  const symbol = exports.get(name);
  if (!symbol) throw new Error(`${name} is not exported`);
  return checker.getDeclaredTypeOfSymbol(symbol);
}

const baseSchema = declaredType(rootExports, 'BaseSchema');

function membersOf(union: ts.Type): Set<ts.Type> {
  return new Set(union.isUnion() ? union.types : [union]);
}

/** The `type` literals a type declares, or `null` when `type` is absent or not all literals. */
function typeLiterals(type: ts.Type): string[] | null {
  const property = checker.getPropertyOfType(type, 'type');
  if (!property) return null;
  const propertyType = checker.getTypeOfSymbol(property);
  const parts = (propertyType.isUnion() ? propertyType.types : [propertyType]).filter(
    (part) => !(part.flags & ts.TypeFlags.Undefined),
  );
  if (parts.length === 0 || !parts.every((part) => part.isStringLiteral())) return null;
  return parts.map((part) => (part as ts.StringLiteralType).value);
}

function reachesBaseSchema(type: ts.Type, seen = new Set<ts.Type>()): boolean {
  if (seen.has(type)) return false;
  seen.add(type);
  if (type === baseSchema) return true;
  if (type.isIntersection()) return type.types.some((part) => reachesBaseSchema(part, seen));
  const target = (type as ts.TypeReference).target ?? type;
  if (!((target as ts.ObjectType).objectFlags & (ts.ObjectFlags.Interface | ts.ObjectFlags.Class))) {
    return false;
  }
  return (checker.getBaseTypes(target as ts.InterfaceType) ?? []).some(
    (base) =>
      reachesBaseSchema(base, seen) ||
      (base.aliasTypeArguments !== undefined &&
        base.aliasTypeArguments.length > 0 &&
        reachesBaseSchema(base.aliasTypeArguments[0], seen)),
  );
}

interface NodeType {
  name: string;
  literals: string[];
  type: ts.Type;
  file: string;
}

/** The population: exported, non-generic, non-union, literal `type`, reaches `BaseSchema`. */
function declaredNodeTypes(files: readonly string[]): NodeType[] {
  const found = new Map<ts.Symbol, NodeType>();
  for (const file of files) {
    for (const symbol of moduleExports(file).values()) {
      if (found.has(symbol)) continue;
      if (!(symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias))) continue;
      const declarations = symbol.declarations ?? [];
      const generic = declarations.some(
        (declaration) =>
          (ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration)) &&
          (declaration.typeParameters?.length ?? 0) > 0,
      );
      if (generic) continue;
      const type = checker.getDeclaredTypeOfSymbol(symbol);
      if (type.isUnion() || !(type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection))) continue;
      const literals = typeLiterals(type);
      if (!literals || !reachesBaseSchema(type)) continue;
      found.set(symbol, {
        name: symbol.getName(),
        literals,
        type,
        file: declarations[0] ? declarations[0].getSourceFile().fileName.slice(packageRoot.length + 1) : '?',
      });
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function outsideOf(population: readonly NodeType[], union: ts.Type): string[] {
  const members = membersOf(union);
  return population
    .filter((node) => !members.has(node.type))
    .map((node) => `${node.name} (type '${node.literals.join("' | '")}', ${node.file})`);
}

describe('AnySchema holds every declared BaseSchema node type (objectui#11478)', () => {
  const population = declaredNodeTypes([indexFile, ...publishedEntryFiles()]);
  const anySchema = declaredType(rootExports, 'AnySchema');

  it('the enumerator flags a node type outside the union, and only that (control)', () => {
    const probeExports = moduleExports(probeFile);
    const controls = declaredNodeTypes([probeFile]);
    expect(controls.map((node) => node.name)).toEqual([
      'ControlDerivedSchema',
      'ControlInsideSchema',
      'ControlOutsideSchema',
    ]);
    expect(outsideOf(controls, declaredType(probeExports, 'ControlUnion'))).toEqual([
      "ControlDerivedSchema (type 'control-derived', src/__anyschema-pin-probe__.ts)",
      "ControlOutsideSchema (type 'control-outside', src/__anyschema-pin-probe__.ts)",
    ]);
  });

  it('reads the real barrel: the population is not empty and holds ButtonSchema', () => {
    expect(population.map((node) => node.name)).toContain('ButtonSchema');
  });

  it('every exported BaseSchema node type with a literal type is a member of AnySchema', () => {
    // A name printed here is a node type this package declares and exports that
    // `AnySchema` leaves out. Add it to `AnySchema` in `../index.ts` — the one
    // list; ⛔ not a second list in a new type.
    expect(outsideOf(population, anySchema)).toEqual([]);
  });

  it('ActionBarSchema, which the enumeration cannot see, is a member by name', () => {
    const actionBar = declaredType(rootExports, 'ActionBarSchema');
    expect(membersOf(anySchema).has(actionBar)).toBe(true);
    // If this goes red, `ActionBarSchema` now extends `BaseSchema` and the
    // enumeration above covers it: delete this case and the by-name sentence
    // in `AnySchema`'s docblock, ⛔ do not loosen the population.
    expect(population.some((node) => node.type === actionBar)).toBe(false);
  });

  it('SchemaByType resolves every single-literal member of AnySchema to that member', () => {
    const misses = declaredType(moduleExports(probeFile), 'SchemaByTypeMisses');
    const names = [...membersOf(misses)]
      .filter((member) => !(member.flags & ts.TypeFlags.Never))
      .map((member) => checker.typeToString(member));
    expect(names).toEqual([]);
  });
});

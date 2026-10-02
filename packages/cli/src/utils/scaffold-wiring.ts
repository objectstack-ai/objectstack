// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import path from 'node:path';
import type { ts as TS } from 'ts-morph';
import { isAggregatedViewContainer } from '@objectstack/spec';
// The LEAF subpath: the registry-key derivation alone, not the metadata plugin.
import { deriveViewContainerObject } from '@objectstack/metadata/view-container';
import { findConfigPath, loadConfig } from './config.js';
import { authoringRuleUnionStack } from './stack-collections.js';

/**
 * Whether what `os generate` just wrote REACHES the stack the project's config
 * builds, asked right after the write (#20215).
 *
 * ## The defect this answers
 *
 * `os g view|action|flow|dashboard|app|skill` wrote a scaffold and a barrel
 * `index.ts`, and nothing imported the barrel: an `os init` config wired
 * `./src/objects` alone. `os validate` then exited 0 with `UI: 0 Apps` and
 * `Logic: 0 Flows` — a green that judged nothing the command had just written,
 * with no line anywhere saying so.
 *
 * `os init` now wires every generator's barrel (see `init.ts`), which is the
 * fix for the project it scaffolds. This module is the other half: every
 * project that is NOT shaped that way — a config written before the fix, one
 * the author reorganised, a `.js` / `.mjs` config, `create-objectstack`'s
 * starter, a directory with no config at all — hears the truth from the
 * command that wrote the file instead of from a count that silently stayed 0.
 *
 * ## Why the loaded stack and not the config's source text
 *
 * The question is read off the stack the config EVALUATES to, through the same
 * {@link loadConfig} `os validate` uses, and folded with the same
 * {@link authoringRuleUnionStack} its counter uses. So it is exact for every
 * config shape at once — keys reordered, extra imports, `defineStack` fed from
 * variables, `packages[]` — without this command understanding any of them,
 * and it can never disagree with the count `os validate` then prints. Nothing
 * here reads or edits the config's text: a config is the author's file, and
 * the only thing this module does with it is load it.
 */

/** What the project's config says about one item `os generate` wrote. */
export type StackReach =
  /** No `objectstack.config.{ts,js,mjs}` in the working directory. */
  | { kind: 'no-config' }
  /** A config exists and did not load (or its `packages[]` did not fold). */
  | { kind: 'load-failed'; configPath: string; message: string }
  /**
   * The config loaded. `reached` says whether its stack carries the item;
   * `missingRequires` lists the capability tokens the item needs to RUN that
   * the stack's top-level `requires` does not declare, and `declaredRequires`
   * is that list as declared (`null`: the stack declares no `requires`).
   */
  | {
    kind: 'loaded';
    configPath: string;
    reached: boolean;
    missingRequires: string[];
    declaredRequires: string[] | null;
  };

/** The item one scaffold writes, and where in a stack it has to land. */
export interface ScaffoldStackTarget {
  /** The `defineStack` key the type is collected under (`views`, `flows`, …). */
  stackKey: string;
  /** The metadata `name` the scaffold writes. */
  itemName: string;
  /** Capability tokens a stack must declare in `requires` for the item to run. */
  requires: readonly string[];
}

type Bag = Record<string, unknown>;

/**
 * The key an item is registered under: its `name` — except an aggregated views
 * container, which is registered under the object it binds to
 * (`deriveViewContainerObject`, the same derivation the boot registrar's
 * container branch uses) and which `os g view` writes with no `name` at all
 * (#21325).
 */
export function registeredItemName(stackKey: string, item: unknown): unknown {
  if (stackKey === 'views' && isAggregatedViewContainer(item)) return deriveViewContainerObject(item);
  return (item as { name?: unknown } | null)?.name;
}

/**
 * Whether the stack a loaded config evaluates to carries an item named
 * `itemName` under `stackKey`. Both collection spellings are read: the array
 * form every scaffold config uses, and the name-keyed map form
 * `normalizeStackInput` also accepts.
 */
export function stackCarries(config: unknown, stackKey: string, itemName: string): boolean {
  const stack = authoringRuleUnionStack((config ?? {}) as Bag) as Bag;
  const collection = stack[stackKey];
  if (Array.isArray(collection)) {
    return collection.some((item) => registeredItemName(stackKey, item) === itemName);
  }
  if (collection && typeof collection === 'object') {
    return Object.entries(collection as Bag).some(
      ([key, item]) => key === itemName || registeredItemName(stackKey, item) === itemName,
    );
  }
  return false;
}

/**
 * The tokens in `requires` that the config's top-level `requires` does not
 * declare. Top-level on purpose: it is the list `defineStack`'s trigger
 * capability rule reads and the list `os serve` mounts capabilities from.
 */
export function missingCapabilities(config: unknown, requires: readonly string[]): string[] {
  const tokens = declaredCapabilities(config) ?? [];
  return requires.filter((token) => !tokens.includes(token));
}

/** The config's top-level `requires` tokens, or `null` when it declares none. */
export function declaredCapabilities(config: unknown): string[] | null {
  const declared = (config as { requires?: unknown } | null)?.requires;
  return Array.isArray(declared) ? declared.filter((t): t is string => typeof t === 'string') : null;
}

/** Load the project's config and ask it about `target`. Never throws. */
export async function measureStackReach(
  target: ScaffoldStackTarget,
  cwd: string = process.cwd(),
): Promise<StackReach> {
  const configPath = findConfigPath(cwd);
  if (!configPath) return { kind: 'no-config' };
  try {
    const { config } = await loadConfig(configPath);
    return {
      kind: 'loaded',
      configPath,
      reached: stackCarries(config, target.stackKey, target.itemName),
      missingRequires: missingCapabilities(config, target.requires),
      declaredRequires: declaredCapabilities(config),
    };
  } catch (error) {
    return {
      kind: 'load-failed',
      configPath,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The module specifier a config at `configPath` imports the barrel directory
 * `barrelDir` (absolute) through, in the extensionless form `os init` writes.
 * `loadConfig` bundles the config, so the directory form resolves to its
 * `index.ts` for a `.ts`, `.js` and `.mjs` config alike.
 */
export function barrelSpecifier(configPath: string, barrelDir: string): string {
  const rel = path.relative(path.dirname(configPath), barrelDir).split(path.sep).join('/');
  if (rel === '') return './index';
  return rel.startsWith('../') || rel === '..' ? rel : `./${rel}`;
}

/**
 * The lines that wire one barrel into a config: the import, the `defineStack`
 * key, and — when the item needs capabilities the stack does not declare — the
 * `requires` entry. The binding is named after the stack key, the name
 * `os init`'s own config gives it.
 *
 * A `requires` line is the WHOLE list: what the stack already declares, then
 * the missing tokens. Printing the missing tokens alone would read as a second
 * `requires` key to add beside the first, which replaces it.
 */
export function wiringLines(args: {
  specifier: string;
  stackKey: string;
  missingRequires: readonly string[];
  declaredRequires: readonly string[] | null;
}): { importLine: string; stackLines: string[] } {
  const { specifier, stackKey, missingRequires, declaredRequires } = args;
  const stackLines = [`${stackKey}: Object.values(${stackKey}),`];
  if (missingRequires.length > 0) {
    const all = [...(declaredRequires ?? []), ...missingRequires];
    const replaces = declaredRequires !== null ? '  // replaces the requires already there' : '';
    stackLines.push(`requires: [${all.map((t) => `'${t}'`).join(', ')}],${replaces}`);
  }
  return { importLine: `import * as ${stackKey} from '${specifier}';`, stackLines };
}

// ─── Barrel membership ─────────────────────────────────────────────────

/**
 * Every name a barrel source exports by name: `export { a, b as c }` (with or
 * without `from`), and exported `const` / `let` / `var` / `function` / `class`
 * declarations. `export *` contributes nothing, because its names are not in
 * this file.
 *
 * Exported so a pin reaches the instrument the command uses, not a copy.
 */
export function barrelExportNames(ts: typeof TS, source: string): Set<string> {
  const file = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const names = new Set<string>();
  const exported = (node: TS.Node) =>
    ts.canHaveModifiers(node)
    && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      if (clause && ts.isNamedExports(clause)) {
        for (const element of clause.elements) names.add(element.name.text);
      }
    } else if (ts.isVariableStatement(statement) && exported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
    } else if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))
      && exported(statement)
      && statement.name
    ) {
      names.add(statement.name.text);
    }
  }
  return names;
}

/**
 * Whether the barrel `source` already exports `binding` by name.
 *
 * ⛔ Not a substring test. The barrel step used to ask
 * `indexContent.includes(binding)`, so a binding that merely APPEARED in the
 * file was read as exported: after `os g view order_line` (binding
 * `orderLine`), `os g view order` found `order` inside `orderLine` and
 * appended nothing, and the view it had just written was never exported. The
 * empty barrels `os init` now writes (`export {};`) would have made that bite
 * on real names too — `port`, `ex`. The compiler is asked which names the file
 * exports instead, so a comment, a module path or a longer identifier never
 * counts.
 */
export async function barrelExportsBinding(source: string, binding: string): Promise<boolean> {
  const { ts } = await import('ts-morph');
  return barrelExportNames(ts, source).has(binding);
}

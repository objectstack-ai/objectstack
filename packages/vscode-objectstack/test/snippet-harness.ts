// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.

/**
 * Snippet harness — turns a VS Code snippet body into the value a metadata
 * author would actually get, so a schema can judge it.
 *
 * Why this exists (#4917): `snippets/objectstack.json` is a *metadata producer*
 * — the very first `.object.ts` / `.view.ts` an author (human or AI) writes is
 * whatever the IDE expanded for them. Nothing in this repo ever parsed that
 * output, so when #4001 closed `ListViewSchema` for unknown keys the
 * `os-view-grid` snippet went from "silently drops `defaultSort`/`pageSize`" to
 * "hard parse error", and stayed broken because no gate could see it. Four more
 * snippets were found equally stale by the audit that opened this file.
 *
 * The harness is deliberately boring: expand the placeholders, transpile the TS,
 * run it with the REAL `@objectstack/spec` behind `require`, and hand the
 * authored literal back so the test can `safeParse` it. No stubbing of the spec,
 * because a stub is exactly how a gate stops tracking the contract it guards.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import ts from 'typescript';

const require = createRequire(import.meta.url);

/** One snippet as it appears in `snippets/objectstack.json`. */
export interface RawSnippet {
  prefix: string;
  description: string;
  body: string[];
}

/** A call the snippet made into a validating spec factory. */
export interface RecordedFactoryCall {
  /** e.g. `defineView`, `ObjectSchema.create`. */
  factory: string;
  /** The literal the author wrote — pre-parse, pre-defaults. */
  config: unknown;
}

export interface EvaluatedSnippet {
  /** The expanded TypeScript source, exactly as the IDE would insert it. */
  source: string;
  /** Every validating factory the snippet called, in call order. */
  calls: RecordedFactoryCall[];
  /** The module's single export (default, or the one named export). */
  exported: unknown;
}

/**
 * Expand VS Code snippet placeholder syntax into concrete text.
 *
 * The four forms the LSP snippet grammar allows in this file, and what an
 * author gets if they tab straight through without typing:
 *
 * | form            | expands to           |
 * |-----------------|----------------------|
 * | `${1:default}`  | `default`            |
 * | `${1\|a,b\|}`   | `a` (the first choice, which is what VS Code preselects) |
 * | `${1}`          | `p1` (a syntactically valid placeholder identifier)      |
 * | `$0`            | `` (the final cursor stop — no text)                     |
 *
 * Expansion is therefore *non-trivial but total*: every form has one defined
 * result, so "what the author gets" is a single well-defined string and the
 * gate has something concrete to parse. A snippet that used a form outside this
 * table would silently expand to the wrong thing, so
 * {@link assertKnownPlaceholderSyntax} rejects one instead.
 */
export function expandSnippetBody(body: string[]): string {
  const source = body.join('\n');
  assertKnownPlaceholderSyntax(source);
  return source
    .replace(/\$\{\d+\|([^|]*)\|\}/g, (_m, choices: string) => choices.split(',')[0])
    .replace(/\$\{(\d+):([^}]*)\}/g, (_m, _n: string, dflt: string) => dflt)
    .replace(/\$\{(\d+)\}/g, (_m, n: string) => `p${n}`)
    .replace(/\$\d+/g, '');
}

/**
 * Reject any placeholder form {@link expandSnippetBody} does not model —
 * variables (`$TM_FILENAME`), transforms (`${1/…/…/}`), nested placeholders.
 * Without this the expander would silently produce text no author would ever
 * see, and the gate would be validating a fiction.
 */
export function assertKnownPlaceholderSyntax(source: string): void {
  const unsupported = [...source.matchAll(/\$\{[^}]*\}|\$[A-Za-z_]\w*/g)]
    .map((m) => m[0])
    .filter((tok) => !/^\$\{\d+(:[^}]*)?\}$/.test(tok) && !/^\$\{\d+\|[^|]*\|\}$/.test(tok));
  if (unsupported.length > 0) {
    throw new Error(
      `Unsupported snippet placeholder syntax: ${unsupported.join(', ')}. ` +
      'The harness models ${n:default}, ${n|a,b|}, ${n} and $n only — teach ' +
      'expandSnippetBody() the new form before using it, or the gate silently ' +
      'validates text no author would ever see.',
    );
  }
}

/** Factories whose argument is the authored metadata literal. */
const RECORDED_FACTORIES = new Set([
  'defineStack', 'defineView', 'defineForm', 'defineFlow', 'defineAgent',
  'defineApp', 'defineTool', 'defineSkill', 'defineReport', 'defineAction',
]);

/** Schema objects whose `.create()` is the authoring entry point. */
const RECORDED_CREATE_SCHEMAS = new Set(['ObjectSchema']);

/**
 * Wrap a spec module so every authoring factory the snippet calls records the
 * literal it received. The call still goes through to the real factory, so the
 * factory's own `.parse()` stays part of the proof.
 */
function recordingModule(mod: Record<string, unknown>, sink: RecordedFactoryCall[]): unknown {
  return new Proxy(mod, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string') return value;

      if (RECORDED_FACTORIES.has(prop) && typeof value === 'function') {
        return (...args: unknown[]) => {
          sink.push({ factory: prop, config: args[0] });
          return (value as (...a: unknown[]) => unknown)(...args);
        };
      }

      // A spec schema built by `lazySchema()` is a *callable* proxy, not a
      // plain object — checking only for `typeof === 'object'` silently skipped
      // `ObjectSchema` and let `os-object` through unrecorded.
      if (RECORDED_CREATE_SCHEMAS.has(prop) && value
          && (typeof value === 'object' || typeof value === 'function')) {
        const schema = value as Record<string, unknown>;
        if (typeof schema.create !== 'function') return value;
        return new Proxy(schema, {
          get(schemaTarget, schemaProp) {
            const member = Reflect.get(schemaTarget, schemaProp);
            if (schemaProp === 'create' && typeof member === 'function') {
              return (...args: unknown[]) => {
                sink.push({ factory: `${prop}.create`, config: args[0] });
                return (member as (...a: unknown[]) => unknown).apply(schemaTarget, args);
              };
            }
            return typeof member === 'function' ? member.bind(schemaTarget) : member;
          },
        });
      }

      return value;
    },
  });
}

/**
 * Transpile the expanded snippet and run it against the real spec.
 *
 * `ts.transpileModule` (not the full program) is deliberate: it is the same
 * single-file, types-erased transform a bundler applies, it needs no tsconfig,
 * and it keeps this gate cheap enough to live in the package's own `pnpm test`.
 * What it cannot see — that an imported *name* exists — is covered separately by
 * the import-surface check below, which is the half that catches a snippet
 * importing a binding the spec no longer exports.
 */
export function evaluateSnippetModule(source: string): EvaluatedSnippet {
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const calls: RecordedFactoryCall[] = [];
  const moduleObject: { exports: Record<string, unknown> } = { exports: {} };
  const shimmedRequire = (id: string): unknown => {
    const resolved = require(id) as Record<string, unknown>;
    return id.startsWith('@objectstack/spec') ? recordingModule(resolved, calls) : resolved;
  };

  const run = new Function('exports', 'require', 'module', js) as (
    exports: unknown, req: unknown, mod: unknown,
  ) => void;
  run(moduleObject.exports, shimmedRequire, moduleObject);

  return { source, calls, exported: soleExport(moduleObject.exports) };
}

/**
 * A snippet scaffolds exactly one metadata item, so its module has exactly one
 * export. Insisting on that (rather than groping for `.default`) keeps the
 * harness honest about what it validated.
 */
function soleExport(exports: Record<string, unknown>): unknown {
  const names = Object.keys(exports).filter((k) => k !== '__esModule');
  if (names.length !== 1) {
    throw new Error(
      `Expected the snippet module to export exactly one value, got ${names.length}: ` +
      `[${names.join(', ')}].`,
    );
  }
  return exports[names[0]];
}

/** A single `import … from '…'` statement found in a snippet. */
export interface SnippetImport {
  specifier: string;
  /** Named bindings, by their name in the source module (pre-`as`). */
  named: string[];
  /** True for `import * as NS from '…'`. */
  namespace: boolean;
}

/** Parse a snippet's import statements with the TypeScript parser. */
export function collectImports(source: string): SnippetImport[] {
  const sf = ts.createSourceFile('snippet.ts', source, ts.ScriptTarget.ES2022, true);
  const imports: SnippetImport[] = [];
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const entry: SnippetImport = {
      specifier: statement.moduleSpecifier.text,
      named: [],
      namespace: false,
    };
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) entry.namespace = true;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        entry.named.push((element.propertyName ?? element.name).text);
      }
    }
    imports.push(entry);
  }
  return imports;
}

/**
 * Every name a module exports — runtime values plus the type-only names its
 * entry `.d.ts` declares.
 *
 * The type half is the point. `import { Data } from '@objectstack/spec'` was in
 * five of these snippets; `Data` was a *type* namespace, so no runtime check
 * could see it disappear when the root namespace re-exports were removed for
 * being untree-shakeable (see `packages/spec/src/index.ts`). Reading the
 * declaration file is what makes a vanished type binding a red test.
 */
export function declaredExportSurface(specifier: string): Set<string> {
  const names = new Set<string>(Object.keys(require(specifier) as object));

  const jsEntry = require.resolve(specifier);
  const dtsEntry = join(dirname(jsEntry), `${basenameWithoutExt(jsEntry)}.d.ts`);
  const declaration = readFileSync(dtsEntry, 'utf8'); // loud if the build is missing
  const sf = ts.createSourceFile(dtsEntry, declaration, ts.ScriptTarget.ES2022, true);

  for (const statement of sf.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause
        && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) names.add(element.name.text);
      continue;
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    if (!modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) names.add(d.name.text);
      }
    } else if ('name' in statement && statement.name && ts.isIdentifier(statement.name as ts.Node)) {
      names.add((statement.name as ts.Identifier).text);
    }
  }
  return names;
}

function basenameWithoutExt(file: string): string {
  return file.split('/').pop()!.replace(/\.(c|m)?js$/, '');
}

/** Read the snippet contribution file this extension actually ships. */
export function readSnippets(): Record<string, RawSnippet> {
  const file = new URL('../snippets/objectstack.json', import.meta.url);
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, RawSnippet>;
}

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── [#16786] the repository a CLASS-typed call site reaches is declared ────
//
// `IScopedObjectRepository` (`packages/spec/src/contracts/scoped-context.ts`)
// declares `findOne` as `Promise<Record<string, any> | null>` and `update` as
// `Promise<Record<string, any> | number | null>` — ruling A on #16231, landed
// as PR #16783. `IDataEngine`, the call each `ObjectRepository` member forwards
// to, declares the same shapes. `ObjectRepository` sat between those two narrow
// declarations and re-widened the result back to `Promise<any>`.
//
// `implements` does not catch that: a WIDER declared return always satisfies a
// narrower one, so `class ObjectRepository implements IScopedObjectRepository`
// compiled green while the members it published were `any`. The interface's
// narrowing therefore reached only the call sites whose STATIC type is the
// interface — and the doors this package exports are typed as the CLASS:
//
//   ObjectQL.createContext(ctx).object(n)   -> ScopedContext -> ObjectRepository
//   ScopedContext.sudo().object(n)          -> ObjectRepository
//   engine.transaction((trxCtx) => …)       -> ScopedContext -> ObjectRepository
//
// ## What this file measures, and what it deliberately does not
//
// Measured on `origin/main` ae19f5edb7 before the fix, with these probes:
//
//   ctx: HookContext ; ctx.api!.object(n).findOne(…)   -> ALREADY NARROW
//   api: ScopedContext ; api.object(n).findOne(…)      -> `any`
//   ql.createContext({}).object(n).findOne(…)          -> `any`
//
// ⚠️ The first line is why the probes below are written through the CLASS and
// the exported engine door rather than through `HookContext`. `HookContext.api`
// was narrowed to `IScopedContext` by #5945/#6311, so a handler typed
// `(ctx: HookContext) => …` reads the narrow type today and read it before this
// fix too — a probe written that way is GREEN on both sides and pins nothing.
// The `any` lives on the class-typed doors, so that is where the probes go.
//
// ## Why the compiler API rather than `@ts-expect-error`
//
// The same reason `packages/spec/src/contracts/scoped-context.test.ts` gives:
// `@ts-expect-error` is satisfied by ANY error on the next line, and this
// file's whole subject is WHICH type a call resolves to. Every negative probe
// below asserts that the diagnostic NAMES the declared shape, so a bare "it
// errored" — or an `any` that erased the type entirely — cannot satisfy it.
//
// Anti-vacuity: a harness that resolves nothing reports zero diagnostics and
// looks exactly like success, so `control-legal` must compile CLEAN, and no
// probe may report TS2307 (unresolved module).

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');

/**
 * Compile probe files against this package's real `src/engine.ts` and return
 * each one's diagnostics. The probes live (virtually) beside the source, so
 * `../engine` resolves the way any sibling module would and `@objectstack/spec`
 * resolves the way a real consumer's does — through the installed package.
 */
function compileProbes(probes: Readonly<Record<string, string>>): Map<string, ts.Diagnostic[]> {
  const dir = resolve(PKG, 'src/__scoped_repo_probes__');
  const paths = new Map<string, string>();
  for (const [name, text] of Object.entries(probes)) paths.set(resolve(dir, `${name}.ts`), text);

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    // A probe declares a const and stops; TS6133 is an opinion about the
    // probe's framing, not about whether the call is well-typed.
    noUnusedLocals: false,
    noUnusedParameters: false,
    types: ['node'],
    baseUrl: PKG,
  };

  const host = ts.createCompilerHost(options, true);
  const realGetSourceFile = host.getSourceFile.bind(host);
  const realFileExists = host.fileExists.bind(host);
  const realReadFile = host.readFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const overlay = paths.get(resolve(fileName));
    return overlay === undefined
      ? realGetSourceFile(fileName, languageVersion, onError, shouldCreate)
      : ts.createSourceFile(fileName, overlay, languageVersion, true);
  };
  host.fileExists = (fileName) => paths.has(resolve(fileName)) || realFileExists(fileName);
  host.readFile = (fileName) => paths.get(resolve(fileName)) ?? realReadFile(fileName);

  const program = ts.createProgram([...paths.keys()], options, host);
  const out = new Map<string, ts.Diagnostic[]>();
  for (const name of Object.keys(probes)) out.set(name, []);
  for (const d of ts.getPreEmitDiagnostics(program)) {
    const file = d.file?.fileName ? resolve(d.file.fileName) : undefined;
    for (const name of Object.keys(probes)) {
      if (file === resolve(dir, `${name}.ts`)) out.get(name)!.push(d);
    }
  }
  return out;
}

/** One diagnostic per line, `TS<code>: <message>`, for readable assertions. */
function render(diagnostics: readonly ts.Diagnostic[]): string {
  return diagnostics
    .map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`)
    .join('\n');
}

const PROBES = {
  // ── anti-vacuity: the harness really resolves and really compiles ────────
  'control-legal': `
import type { ObjectQL } from '../engine';
export const probe = async (ql: ObjectQL) => {
  const row = await ql.createContext({}).object('task').findOne({ where: { id: 't1' } });
  return row === null ? 'missing' : String(row.status);
};`,
  // ── the class-typed door: what a hook reaches at RUNTIME ─────────────────
  'class-door-findOne': `
import type { ScopedContext } from '../engine';
export const probe = async (api: ScopedContext) => {
  const bad: number = await api.object('task').findOne({ where: { id: 't1' } });
};`,
  // ── the exported public door ─────────────────────────────────────────────
  'public-door-findOne': `
import type { ObjectQL } from '../engine';
export const probe = async (ql: ObjectQL) => {
  const bad: number = await ql.createContext({}).object('task').findOne({ where: { id: 't1' } });
};`,
  // ── the elevated door ────────────────────────────────────────────────────
  'sudo-door-findOne': `
import type { ScopedContext } from '../engine';
export const probe = async (api: ScopedContext) => {
  const bad: number = await api.sudo().object('task').findOne({ where: { id: 't1' } });
};`,
  // ── update carries the same repair ───────────────────────────────────────
  'class-door-update': `
import type { ScopedContext } from '../engine';
export const probe = async (api: ScopedContext) => {
  const bad: boolean = await api.object('task').update({ id: 't1', status: 'done' });
};`,
  // ── the direct any-detector, in case a future edit reaches `any` by ──────
  // ── some route the assignment probes above do not cover ─────────────────
  'not-any-findOne': `
import type { ScopedContext } from '../engine';
type IsAny<T> = 0 extends (1 & T) ? true : false;
type Row = Awaited<ReturnType<ReturnType<ScopedContext['object']>['findOne']>>;
export const isAny: IsAny<Row> = true;`,
} as const;

describe('[#16786] `object(name)` hands back a DECLARED repository, not `any`', () => {
  const diagnostics = compileProbes(PROBES);

  it('resolves every probe against real source (anti-vacuity)', () => {
    for (const [name, ds] of diagnostics) {
      expect(render(ds), `${name} failed to resolve its imports`).not.toContain('TS2307');
    }
    // The legal spelling — null handled — must compile with nothing to say.
    // Without this, a harness that compiled nothing would satisfy every
    // negative probe below by reporting no diagnostics at all.
    expect(render(diagnostics.get('control-legal')!)).toBe('');
  });

  it.each([
    ['class-door-findOne', 'Record<string, any> | null'],
    ['public-door-findOne', 'Record<string, any> | null'],
    ['sudo-door-findOne', 'Record<string, any> | null'],
    // TypeScript normalises this union's order; the string is the compiler's
    // own rendering, not the source order in `IScopedObjectRepository`.
    ['class-door-update', 'number | Record<string, any> | null'],
  ])('%s: the diagnostic NAMES the declared shape', (probe, declared) => {
    const text = render(diagnostics.get(probe)!);
    // Not merely "some error": `any` produces NO error here, and an erased or
    // widened declaration produces one that does not name this shape.
    expect(text).toContain('TS2322');
    expect(text).toContain(declared);
  });

  it('findOne is not `any` — measured by the compiler, not by reading the source', () => {
    // `IsAny<Row>` is `false` once the declaration is honest, so assigning
    // `true` to it is an error. When `Row` is `any`, `IsAny<Row>` is `true`
    // and this probe compiles clean — which is the pre-fix reading.
    const text = render(diagnostics.get('not-any-findOne')!);
    expect(text).toContain('TS2322');
    expect(text).toContain("Type 'true' is not assignable to type 'false'");
  });
});

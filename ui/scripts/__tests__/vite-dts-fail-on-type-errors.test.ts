import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { createDtsExplicitExtensions } from '../vite-dts-explicit-extensions';
import {
  createDtsFailOnTypeErrors,
  describeFatalDiagnostics,
  formatDiagnostic,
  selectFatalDiagnostics,
} from '../vite-dts-fail-on-type-errors';

/**
 * objectui#5370 — `vite-plugin-dts` computed a type program's diagnostics,
 * PRINTED them, and let `vite build` exit 0 anyway. Measured on
 * `@object-ui/layout` at `478ec54ce` with one deliberate TS2353: the error in
 * the log, `BUILD_EXIT=0` underneath it.
 *
 * What is pinned here, and why each case is not covered by the next:
 *
 *   1. **A real TypeScript diagnostic is fatal.** The subject is fed
 *      diagnostics from an actual `ts.createProgram` over a fixture, not from
 *      hand-rolled objects, so the predicate is pinned against the shape the
 *      plugin really hands it.
 *   2. **Only errors are fatal.** Warning / suggestion / message diagnostics
 *      pass. This is invisible in a green build and is the difference between
 *      a gate that survives and a gate someone switches off — which would take
 *      the errors with it.
 *   3. **The message carries the diagnostics.** The plugin logs them once, at
 *      program creation, hundreds of lines above the failure; a `| tail` is
 *      what hid them in the first place. A failure that only says "there were
 *      errors" reproduces the defect one layer up.
 *   4. **The hooks are disjoint from the other dts factory.**
 *      `packages/layout/vite.config.ts` spreads both into one object literal,
 *      where a duplicate key silently keeps the last one and reports nothing.
 */

/** Diagnostics from a real compile of one throwaway file. */
function diagnosticsFor(source: string): { diagnostics: readonly ts.Diagnostic[]; dir: string } {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dts-fail-'));
  const file = path.join(dir, 'probe.ts');
  fs.writeFileSync(file, source);

  const program = ts.createProgram([file], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
  });

  return {
    diagnostics: [...program.getSemanticDiagnostics(), ...program.getSyntacticDiagnostics()],
    dir: dir.replace(/\\/g, '/'),
  };
}

/** A diagnostic of a given category, with no file attached. */
function bare(category: ts.DiagnosticCategory, code: number, messageText: string): ts.Diagnostic {
  return { category, code, messageText, file: undefined, start: undefined, length: undefined };
}

describe('createDtsFailOnTypeErrors', () => {
  it('throws on a real type error the declaration program would have printed and swallowed', () => {
    const { diagnostics, dir } = diagnosticsFor("export const answer: number = 'not a number';\n");
    expect(diagnostics.length).toBeGreaterThan(0);

    const hooks = createDtsFailOnTypeErrors({ packageDir: dir });

    expect(() => hooks.afterDiagnostic(diagnostics)).toThrowError(/TS2322/);
    expect(() => hooks.afterDiagnostic(diagnostics)).toThrowError(/must not exit 0/);
  });

  it('stays silent on a clean program — the green build is unchanged', () => {
    const { diagnostics, dir } = diagnosticsFor("export const answer: number = 42;\n");
    expect(diagnostics).toHaveLength(0);

    const hooks = createDtsFailOnTypeErrors({ packageDir: dir });
    expect(() => hooks.afterDiagnostic(diagnostics)).not.toThrow();
  });

  it('fails on errors only — warnings, suggestions and messages are not build failures', () => {
    const noisy = [
      bare(ts.DiagnosticCategory.Warning, 6133, "'x' is declared but never used."),
      bare(ts.DiagnosticCategory.Suggestion, 80001, 'File is a CommonJS module.'),
      bare(ts.DiagnosticCategory.Message, 6194, 'Found 0 errors.'),
    ];
    const hooks = createDtsFailOnTypeErrors({ packageDir: '/pkg' });

    expect(selectFatalDiagnostics(noisy)).toHaveLength(0);
    expect(() => hooks.afterDiagnostic(noisy)).not.toThrow();

    const withError = [...noisy, bare(ts.DiagnosticCategory.Error, 2353, 'Object literal ...')];
    expect(selectFatalDiagnostics(withError)).toHaveLength(1);
    expect(() => hooks.afterDiagnostic(withError)).toThrowError(/TS2353/);
  });

  it('names file, line, column and code, relative to the package', () => {
    const { diagnostics, dir } = diagnosticsFor("export const answer: number = 'nope';\n");
    const [diagnostic] = selectFatalDiagnostics(diagnostics);

    expect(formatDiagnostic(diagnostic, dir)).toMatch(/^probe\.ts\(1,14\): error TS2322: /);
    // Absolute when the diagnostic is outside the package being built, rather
    // than a path computed against the wrong root.
    expect(formatDiagnostic(diagnostic, '/somewhere/else')).toMatch(/^\/.*probe\.ts\(1,14\): /);
  });

  it('quotes at most `maxQuoted` diagnostics and says how many it elided', () => {
    const many = Array.from({ length: 7 }, (_, index) =>
      bare(ts.DiagnosticCategory.Error, 2300 + index, `error number ${index}`)
    );

    const message = describeFatalDiagnostics(many, { packageDir: '/pkg', maxQuoted: 3 })!;
    expect(message).toContain('reported 7 type errors');
    expect(message).toContain('TS2300');
    expect(message).toContain('TS2302');
    expect(message).not.toContain('TS2303');
    expect(message).toContain('... and 4 more');
  });

  it('returns null rather than an empty message when nothing is fatal', () => {
    expect(describeFatalDiagnostics([], { packageDir: '/pkg' })).toBeNull();
    expect(
      describeFatalDiagnostics([bare(ts.DiagnosticCategory.Warning, 6133, 'unused')], {
        packageDir: '/pkg',
      })
    ).toBeNull();
  });

  it('shares no hook name with createDtsExplicitExtensions', () => {
    // `packages/layout/vite.config.ts` spreads both factories into ONE object
    // literal. Overlapping keys there would silently drop whichever came
    // first — no error, no log line, and one of the two fixes just stops
    // existing. If a hook is ever added to either factory, this fails and
    // points at the call site that has to compose instead of spread.
    const failOnErrors = Object.keys(createDtsFailOnTypeErrors({ packageDir: '/pkg' }));
    const explicitExtensions = Object.keys(createDtsExplicitExtensions({ packageDir: '/pkg' }));

    expect(failOnErrors).toEqual(['afterDiagnostic']);
    expect(explicitExtensions.sort()).toEqual(['afterBuild', 'beforeWriteFile']);
    expect(failOnErrors.filter((hook) => explicitExtensions.includes(hook))).toEqual([]);
  });
});

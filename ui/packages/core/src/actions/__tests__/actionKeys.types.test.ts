/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Type-level pins for objectstack#4075 — the keys `ActionDef` declares
 * explicitly (step 2's 18 spec-owned ones, plus the five step 3's deletion
 * surfaced) and, since step 3, the keys it now REFUSES.
 *
 * Why this file has to drive `tsc` itself: the property under test is that the
 * COMPILER rejects a wrong-typed value. A normal runtime test cannot observe
 * that, and `expectTypeOf` is not available here (vitest's `typecheck` mode is
 * not enabled in `vitest.config.mts`, and enabling it is a shared-config change
 * that belongs to objectui#3181's gate, not to this issue). So the assertions
 * compile a small virtual module against the real `ActionDef` and read the
 * diagnostics back.
 *
 * The discrimination proof is built in rather than asserted in prose: the same
 * bad assignments are compiled a SECOND time against `IndexSignatureOnly` — an
 * interface carrying nothing but `[key: string]: any`, i.e. `ActionDef` as it
 * was before step 2 — and every one of them must come back CLEAN. That control
 * is what makes this file revert-proof: undo the promotion and the "rejects"
 * assertions go green-to-red, because the index signature swallows them again,
 * which is the entire bug objectstack#4075 describes.
 *
 * Since step 3 that control also covers the deletion itself, not just the
 * promotions. `{ targt: … }` and `{ execute: … }` are now `rejected: true`, and
 * the only thing standing between them and silence is the absence of the index
 * signature — so restoring it makes those two rows leak into the control's
 * "leaked" list as well as flipping them here. The control is no longer a
 * historical foil; it is the exact shape of the thing that was removed.
 *
 * Cost note (AGENTS.md 测试纪律): the program is built once at MODULE SCOPE, not
 * in `beforeAll`. Module-scope work runs in the import phase and is bound by no
 * test or hook timeout; a `beforeAll` would put ~3s of compiler work under the
 * 10s `hookTimeout`, which is the narrower budget and the documented way to
 * turn a slow setup into a load-dependent flake.
 */
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER_IMPORT = join(HERE, '..', 'ActionRunner').replace(/\\/g, '/');

/** A single assignment, and whether `tsc` is required to reject it. */
interface Case {
  readonly what: string;
  readonly code: string;
  readonly rejected: boolean;
}

/**
 * Every case is a value assigned to one of the promoted keys. `rejected: true`
 * means step 2 made it a compile error; `rejected: false` means it is a shape
 * the runner genuinely accepts and must keep accepting.
 */
const CASES: readonly Case[] = [
  // ── Wrong-typed values the spec-derived types now reject ───────────────────
  { what: 'locations rejects a string outside the spec location enum', rejected: true, code: `{ locations: ['nope'] }` },
  { what: 'order rejects a string where the spec says number', rejected: true, code: `{ order: 'first' }` },
  { what: 'variant rejects a colour the spec enum does not list', rejected: true, code: `{ variant: 'chartreuse' }` },
  { what: 'component rejects a renderer the spec enum does not list', rejected: true, code: `{ component: 'action:carousel' }` },
  { what: 'icon rejects a number', rejected: true, code: `{ icon: 42 }` },
  { what: 'objectName rejects a number', rejected: true, code: `{ objectName: 42 }` },
  { what: 'recordIdField rejects a number', rejected: true, code: `{ recordIdField: 42 }` },
  { what: 'recordIdParam rejects a number', rejected: true, code: `{ recordIdParam: 42 }` },
  { what: 'requiredPermissions rejects a bare string where the spec says string[]', rejected: true, code: `{ requiredPermissions: 'admin' }` },
  { what: 'requiresFeature rejects a feature the spec enum does not list', rejected: true, code: `{ requiresFeature: 'telepathy' }` },
  { what: 'mode rejects a value the spec enum does not list', rejected: true, code: `{ mode: 'telepathic' }` },
  { what: 'bodyShape rejects a string other than "flat"', rejected: true, code: `{ bodyShape: 'nested-ish' }` },
  { what: 'bodyExtra rejects a non-object', rejected: true, code: `{ bodyExtra: 'extra' }` },
  // `aria` is no longer declared (objectui#10929): spec 17.5.0 retired it, so
  // even the object it used to take is refused, as an excess property.
  { what: 'aria is retired and undeclared, so even its old object shape is rejected', rejected: true, code: `{ aria: { ariaLabel: 'Approve' } }` },
  { what: 'ai rejects a string', rejected: true, code: `{ ai: 'yes' }` },
  { what: 'visible rejects a number — neither predicate, envelope, nor boolean', rejected: true, code: `{ visible: 42 }` },

  // The two tombstones. Spec 17 retired both as `retiredKey()` (`z.never()`),
  // so DERIVING the type — rather than hand-writing `shortcut?: string` —
  // turns "authoring this is a hard parse rejection" into a compile error.
  { what: 'shortcut is a retired tombstone, so any value is a compile error', rejected: true, code: `{ shortcut: 'ctrl+k' }` },
  { what: 'bulkEnabled is a retired tombstone, so any value is a compile error', rejected: true, code: `{ bulkEnabled: true }` },

  // ── Shapes the runner genuinely accepts and must keep accepting ────────────
  { what: 'locations accepts a real spec location', rejected: false, code: `{ locations: ['record_header'] }` },
  { what: 'order accepts a number', rejected: false, code: `{ order: 10 }` },
  { what: 'variant accepts a spec variant', rejected: false, code: `{ variant: 'primary' }` },
  { what: 'component accepts a spec renderer', rejected: false, code: `{ component: 'action:button' }` },
  { what: 'requiredPermissions accepts a string array', rejected: false, code: `{ requiredPermissions: ['admin'] }` },
  { what: 'requiresFeature accepts a spec feature', rejected: false, code: `{ requiresFeature: 'sso' }` },

  // `visible`'s three accepted arms. The raw-string one is why these types are
  // derived from `z.input` and not `z.infer`: `ActionSchema` is a `ZodPipe`
  // whose transform narrows `visible` to the envelope alone, so deriving from
  // the inferred `Action` would have type-errored a predicate that
  // `ActionEngine.getActionsForLocation` explicitly supports.
  { what: 'visible accepts a raw CEL string (the z.infer-vs-z.input arm)', rejected: false, code: `{ visible: 'record.done == false' }` },
  { what: 'visible accepts a { dialect, source } envelope', rejected: false, code: `{ visible: { dialect: 'cel', source: 'record.done == false' } }` },
  { what: 'visible accepts a literal boolean (objectui tolerance, pinned by ActionEngine.visibility.test.ts)', rejected: false, code: `{ visible: true }` },

  // `disabled`'s three arms, converged onto `visible`'s by the 2026-08-06
  // maintainer ruling and delivered by `@objectstack/spec` 17.0.0-rc.6
  // (objectstack#5970). Step 2 could only declare `string | boolean` by hand,
  // which is why `DeclaredActionsBar` still read the key through a cast: the
  // envelope arm the spec emits had no declaration to land in.
  { what: 'disabled accepts a literal boolean', rejected: false, code: `{ disabled: true }` },
  { what: 'disabled accepts a raw CEL string', rejected: false, code: `{ disabled: 'record.locked' }` },
  { what: 'disabled accepts a { dialect, source } envelope', rejected: false, code: `{ disabled: { dialect: 'cel', source: 'record.locked' } }` },
  { what: 'disabled rejects a number — neither predicate, envelope, nor boolean', rejected: true, code: `{ disabled: 42 }` },

  // The five keys step 3's deletion surfaced: four `navigation`-alias spellings
  // that step 1 had ruled legitimate but step 2 left as data, and `description`,
  // which every action renderer forwards and the param dialog reads.
  { what: 'the navigation alias spelling is declared', rejected: false, code: `{ to: '/records/1', external: false, newTab: true, replace: false }` },
  { what: 'newTab is the boolean switch, not the openIn string', rejected: true, code: `{ newTab: 'new-tab' }` },
  //
  // `description` is deliberately NOT pinned here — it is pinned in
  // `actionDef-closed-surface.test.ts` instead, and the reason is a real limit
  // of this harness rather than an oversight.
  //
  // Every other derivation above resolves through `@objectstack/spec`, an
  // ordinary installed package. `description` derives from
  // `UIActionSchema['description']` in `@object-ui/types`, a WORKSPACE package
  // whose types resolve through its built `dist/index.d.ts`. This harness
  // builds its own program with a default compiler host and no `paths` (see
  // `erroringLines`), so it reads whatever is on disk — and the unit-test job
  // does not build workspace packages first. When `dist` is stale or absent the
  // indexed access degrades to `any`, `{ description: 42 }` is accepted, and a
  // `rejected: true` row here goes red for a reason that has nothing to do with
  // `ActionDef`. Measured: green locally after a build, red in CI without one.
  //
  // `tsconfig.test.json` has no such problem — it is a real project in the
  // dependency graph, so CI's Type Check job builds `@object-ui/types` before
  // compiling it, and the `@ts-expect-error` on `{ description: 42 }` there is
  // enforced for real. Splitting the two `description` pins out is therefore
  // the honest placement, not a weakening: an assertion whose colour depends on
  // whether someone ran a build is not a pin.

  // Step 3's completion check, from the type side, INVERTED by step 3 landing.
  // While `[key: string]: any` stood, a typo was absorbed silently and this case
  // read `rejected: false` under a comment promising it would flip. It flipped.
  //
  // The dev-mode warning it pointed at did NOT retire with it, and the reason is
  // the one thing this file cannot pin: `tsc` only ever sees actions authored as
  // TypeScript, while `execute: 'markDone'` lives in stored `sys_metadata` rows
  // that reach the runner UNPARSED (objectstack#3903). Closing the type is half
  // the surface; the warning is the other half.
  { what: 'an unrecognized key is REJECTED — the index signature is gone', rejected: true, code: `{ targt: 'form_1' }` },
  { what: 'the retired `execute` tombstone is rejected by name', rejected: true, code: `{ execute: 'markDone' }` },
];

/** `ActionDef` as it was BEFORE step 2: nothing but the open index signature. */
const CONTROL_DECL = `interface IndexSignatureOnly { [key: string]: any; }`;

/**
 * Compile every case as `const c<N>: <Type> = <value>;`, one per line, and
 * return the set of line numbers that produced a diagnostic. One program for
 * all cases keeps this to a single type-resolution of `@objectstack/spec`.
 */
function erroringLines(typeName: string, preamble: string): Set<number> {
  const header = `${preamble}\n`;
  const body = CASES.map((c, i) => `const c${i}: ${typeName} = ${c.code};`).join('\n');
  const source = `${header}${body}\n`;
  const headerLines = header.split('\n').length - 1;

  const VIRTUAL = join(HERE, '__actionDefTypePins.virtual.ts').replace(/\\/g, '/');
  const options: ts.CompilerOptions = {
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ESNext,
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, ...rest) =>
    fileName === VIRTUAL
      ? ts.createSourceFile(fileName, source, languageVersion, true)
      : getSourceFile(fileName, languageVersion, ...rest);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => (fileName === VIRTUAL ? true : fileExists(fileName));
  const readFile = host.readFile.bind(host);
  host.readFile = (fileName) => (fileName === VIRTUAL ? source : readFile(fileName));

  const program = ts.createProgram([VIRTUAL], options, host);
  const sf = program.getSourceFile(VIRTUAL);
  if (!sf) throw new Error('virtual source file was not added to the program');

  const lines = new Set<number>();
  for (const d of program.getSemanticDiagnostics(sf)) {
    if (d.start == null) continue;
    lines.add(sf.getLineAndCharacterOfPosition(d.start).line - headerLines);
  }
  return lines;
}

// Module scope on purpose — see the file header. Both programs are built here so
// the compiler cost lands in the import phase rather than under a hook timeout.
const againstActionDef = erroringLines('ActionDef', `import type { ActionDef } from '${RUNNER_IMPORT}';`);
const againstIndexSignature = erroringLines('IndexSignatureOnly', CONTROL_DECL);

describe('ActionDef spec-owned key types (objectstack#4075 step 2)', () => {
  for (const [i, c] of CASES.entries()) {
    it(c.what, () => {
      expect({ case: c.what, rejected: againstActionDef.has(i) }).toEqual({ case: c.what, rejected: c.rejected });
    });
  }
});

describe('discrimination: the same code against a bare index signature', () => {
  it('absorbs every rejected case silently — which is the bug step 2 fixes', () => {
    // If this ever fails, the control interface stopped modelling "ActionDef
    // before step 2" and the suite above has lost its meaning.
    const leaked = CASES.map((c, i) => ({ what: c.what, i }))
      .filter(({ i }) => againstIndexSignature.has(i))
      .map(({ what }) => what);
    expect(leaked).toEqual([]);
  });

  it('proves the promotion is what rejects them, not some unrelated diagnostic', () => {
    const shouldReject = CASES.map((c, i) => [c, i] as const).filter(([c]) => c.rejected);
    expect(shouldReject.length).toBeGreaterThan(0);
    // Every rejected case errors against ActionDef and is clean against the
    // index-signature-only control. That difference IS the step-2 delta.
    const delta = shouldReject.filter(([, i]) => againstActionDef.has(i) && !againstIndexSignature.has(i));
    expect(delta.length).toBe(shouldReject.length);
  });
});

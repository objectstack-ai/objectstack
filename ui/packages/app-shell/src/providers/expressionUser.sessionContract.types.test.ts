/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Type-level pin for objectui#6551 — the cast `buildExpressionUser` reads its
 * input through is not WIDER than the contract it mirrors.
 *
 * ## What the defect was, and why only the compiler can see it
 *
 * The normaliser's signed-in branch forwards `id` / `name` / `email` RAW, out
 * of a cast that declared all three optional:
 *
 *     const u = user as { id?: string; name?: string; email?: string; … }
 *
 * So the declaration said a session with no `id` was a legitimate input, and
 * the code answered `{ id: undefined, … }` for it — present-and-always-
 * `undefined`, the exact shape objectui#5424 removed `roles` from this object
 * for and objectui#6534 refused for the anonymous branch one key over. The
 * contract it mirrors disagrees: `useAuth().user` is `@object-ui/auth`'s
 * `AuthUser`, which extends the spec's `AuthUser` — `id: string;
 * email: string; name: string`, with only `positions` / `tenantId` optional.
 *
 * NOTHING REACHABLE TODAY HITS IT. The only production input is a better-auth
 * principal that always carries `id`, which is why this card was graded a
 * latent shape hazard and why the fix moved a DECLARATION and no runtime
 * behaviour. That is also why no runtime assertion can pin it: `id?: string`
 * and `id: string` produce byte-identical output for every input a producer
 * can actually supply. The compiler is the only instrument that sees the
 * difference, so this file drives `tsc` itself — same mechanism as
 * `core/src/utils/__tests__/freeze-schema.types.test.ts` and
 * `core/src/actions/__tests__/actionKeys.types.test.ts` (vitest's `typecheck`
 * mode is off in `vitest.config.mts`; turning it on is a shared-config change
 * owned by objectui#3181, not by this card).
 *
 * NO BUILD ARTIFACT SITS BETWEEN THE EDIT AND THESE ASSERTIONS. The preamble
 * imports `../expressionUser` by relative path, so the program reads the
 * SOURCE file — and that module is a LEAF that imports nothing, so there is no
 * workspace `dist` anywhere on the path that could go stale and degrade a type
 * to `any` (the hazard `actionKeys.types.test.ts` documents). `AuthUser` comes
 * from the PUBLISHED `@objectstack/spec` typings in `node_modules`, and the
 * preamble-integrity case below fails loudly if either import stops resolving,
 * rather than letting a silent `any` turn a rejection case green.
 *
 * ## Discrimination is built in, not promised
 *
 * Every case is compiled a SECOND time with one thing changed: the type
 * redeclared with its PRE-FIX optionality, verbatim from `main` at
 * `0235ce7c1`, everything else still the real module. `EXPECTED_FLIPS` names by
 * index exactly which cases that reverts. A case outside that set is green on
 * BOTH legs and is stated as such rather than quietly counted as evidence —
 * three of the cases below are in that position deliberately, because "the
 * narrowing did not overshoot" is a claim that needs its own controls.
 *
 * ## The limit this file recorded is closed (objectui#6559)
 *
 * The last case below used to be ACCEPTED, pinning that the parameter was
 * `unknown` and so the narrowed cast bound no call site. objectui#6559 moved
 * the declaration onto the parameter (maintainer ruling 2026-08-27), and that
 * case is now a REJECTION. The parameter's own discrimination — the leg that
 * shows a re-widened parameter turning it green again — lives in
 * `expressionUser.parameterContract.types.test.ts`, because the reverted
 * preamble here can only re-widen the local type alias.
 *
 * ## Fenced boundary
 *
 * `id: u.id ?? null` is the REJECTED shape (triage ruling, 2026-08-26): a
 * lenient default in the consumer is what AGENTS.md #0.1 forbids and what
 * objectui#6534 shipped a scope fence against. The last case in the runtime
 * section is that fence made mechanical — it reds if a fallback is smuggled in
 * later. Changing it is re-deciding the card, not editing a test.
 */
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildExpressionUser, type ExpressionUserSession } from './expressionUser';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_IMPORT = join(HERE, 'expressionUser').replace(/\\/g, '/');

/** One statement, and whether `tsc` is required to reject it. */
interface Case {
  readonly what: string;
  readonly code: string;
  readonly rejected: boolean;
}

/**
 * One line each — the diagnostics are mapped back to cases BY LINE NUMBER, so
 * a two-line case would silently mis-attribute its own error to its neighbour.
 */
const CASES: readonly Case[] = [
  // ── The defect, in type form ──────────────────────────────────────────────
  // Case 0 is the card's own literal: `buildExpressionUser({ name: 'B',
  // email: 'b@c.d' })` was a DECLARED-legitimate input that answered
  // `{ id: undefined, … }`.
  {
    what: 'a session with no `id` is not a signed-in session',
    rejected: true,
    code: `const a: ExpressionUserSession = { name: 'B', email: 'b@c.d' }; void a;`,
  },
  {
    what: 'a session with no `name` is not a signed-in session',
    rejected: true,
    code: `const b: ExpressionUserSession = { id: 'u_1', email: 'b@c.d' }; void b;`,
  },
  {
    what: 'a session with no `email` is not a signed-in session',
    rejected: true,
    code: `const c: ExpressionUserSession = { id: 'u_1', name: 'B' }; void c;`,
  },
  {
    // The present-and-undefined shape ITSELF, written out. The optional cast
    // accepted this spelling too, which is how the defect reached the object
    // literal below `u` unaltered.
    what: 'an explicitly `undefined` `id` is not a signed-in session either',
    rejected: true,
    code: `const d: ExpressionUserSession = { id: undefined, name: 'B', email: 'b@c.d' }; void d;`,
  },
  {
    // Rejected on BOTH legs — see EXPECTED_FLIPS. It is here because `null` is
    // the ANONYMOUS branch's answer, and "signed in with no id" must not be
    // spellable as "signed out" on the way IN. That was rejected shape 1 in the
    // ruling, and the type refuses it independently of this card's change.
    what: 'a `null` `id` is not a signed-in session — the anonymous answer is not an input',
    rejected: true,
    code: `const e: ExpressionUserSession = { id: null, name: 'B', email: 'b@c.d' }; void e;`,
  },
  {
    // The spec-derived half: this one does not restate the three key names, so
    // it follows `@objectstack/spec` if the principal's required set ever
    // moves. An INCOMPLETE principal is not an input.
    what: 'a Partial of the spec principal is not a signed-in session',
    rejected: true,
    code: `const f: ExpressionUserSession = { ...partialPrincipal }; void f;`,
  },

  // ── The narrowing did not overshoot ───────────────────────────────────────
  // Green on both legs. Without these, "reds when the cast widens" would be
  // satisfied by a type that rejects everything, which is the other way to be
  // wider-or-narrower than the contract.
  {
    what: 'a COMPLETE spec principal is a signed-in session',
    rejected: false,
    code: `const g: ExpressionUserSession = { ...principal }; void g;`,
  },
  {
    what: 'the minimum complete principal types — `role` and `positions` stay optional',
    rejected: false,
    code: `const h: ExpressionUserSession = { id: 'u_1', name: 'B', email: 'b@c.d' }; void h;`,
  },
  {
    // The index signature is load-bearing and must survive the narrowing:
    // better-auth projects an app's custom user columns onto this object, and
    // it is also the route by which `isPlatformAdmin` and `positions` are read.
    what: 'better-auth custom columns are still absorbed by the index signature',
    rejected: false,
    code: `const i: ExpressionUserSession = { id: 'u_1', name: 'Ada', email: 'a@e.d', role: 'user', positions: ['user'], isPlatformAdmin: true, department__c: 'sales' }; void i;`,
  },
  {
    // objectui#6551's honest limit — and objectui#6559 CLOSED it. While the
    // PARAMETER was `unknown`, narrowing the cast made no producer loud at
    // compile time: the module merely stopped declaring the broken input
    // legitimate, and this case recorded that by being ACCEPTED. The parameter
    // now IS `ExpressionUserSession | null | undefined` (maintainer ruling
    // 2026-08-27, option A), so the same call is refused and this case is the
    // seam between the two cards. It is rejected on BOTH legs below: the
    // reverted preamble re-widens the local type ALIAS, while the parameter
    // reads the real module's. What discriminates the parameter is
    // `expressionUser.parameterContract.types.test.ts`.
    what: 'the exported function refuses an unchecked input — the parameter is a call-site check',
    rejected: true,
    code: `buildExpressionUser({ name: 'B', email: 'b@c.d' });`,
  },
];

/** Diagnostics from one compile: how many landed in the preamble, and which case lines erred. */
interface Run {
  readonly headerErrors: number;
  readonly lines: ReadonlySet<number>;
}

function compile(preamble: string): Run {
  const header = `${preamble}\n`;
  const body = CASES.map((c) => c.code).join('\n');
  const source = `${header}${body}\nexport {};\n`;
  const headerLines = header.split('\n').length - 1;

  const VIRTUAL = join(HERE, '__expressionUserSessionContract.virtual.ts').replace(/\\/g, '/');
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
  let headerErrors = 0;
  const diagnostics = [...program.getSemanticDiagnostics(sf), ...program.getSyntacticDiagnostics(sf)];
  for (const d of diagnostics) {
    if (d.start == null) continue;
    const line = sf.getLineAndCharacterOfPosition(d.start).line;
    if (line < headerLines) headerErrors++;
    else lines.add(line - headerLines);
  }
  return { headerErrors, lines };
}

/**
 * The fixtures both legs share. `principal` and `partialPrincipal` are the only
 * things tying these cases to `@objectstack/spec` rather than to a local
 * restatement of it.
 */
const FIXTURES =
  `declare const principal: AuthUser;\n` + `declare const partialPrincipal: Partial<AuthUser>;`;

const REAL_PREAMBLE =
  `import { buildExpressionUser } from '${MODULE_IMPORT}';\n` +
  `import type { ExpressionUserSession } from '${MODULE_IMPORT}';\n` +
  `import type { AuthUser } from '@objectstack/spec/contracts';\n` +
  FIXTURES;

/**
 * The same program with ONE thing changed: `ExpressionUserSession` redeclared
 * with the optionality it carried before this card — copied verbatim from the
 * cast on `main` at `0235ce7c1`. The module, the spec principal and every case
 * are otherwise identical, so a flip here can only be caused by that
 * optionality.
 */
const REVERTED_PREAMBLE =
  `import { buildExpressionUser } from '${MODULE_IMPORT}';\n` +
  `import type { AuthUser } from '@objectstack/spec/contracts';\n` +
  `type ExpressionUserSession = { id?: string; name?: string; email?: string; role?: string; [key: string]: unknown };\n` +
  FIXTURES;

// Module scope on purpose (see the header of `actionKeys.types.test.ts`): the
// compiler cost lands in the import phase rather than under a hook timeout.
const againstReal = compile(REAL_PREAMBLE);
const againstReverted = compile(REVERTED_PREAMBLE);

describe('objectui#6551 — the signed-in cast is no wider than the contract it mirrors', () => {
  it('resolves the real declarations — no diagnostic lands in either preamble', () => {
    // The guard against a SILENT `any`. If `../expressionUser` or
    // `@objectstack/spec/contracts` stopped resolving, `ExpressionUserSession`
    // and `AuthUser` would degrade and every rejection case below would go
    // green for a reason that has nothing to do with this card.
    expect({ real: againstReal.headerErrors, reverted: againstReverted.headerErrors }).toEqual({
      real: 0,
      reverted: 0,
    });
  });

  for (const [i, c] of CASES.entries()) {
    it(c.what, () => {
      expect({ case: c.what, rejected: againstReal.lines.has(i) }).toEqual({
        case: c.what,
        rejected: c.rejected,
      });
    });
  }
});

/**
 * Indices the PRE-FIX optionality turns green again. Named explicitly so the
 * file records which assertions actually discriminate — the rest are green on
 * both legs and prove nothing about this change on their own.
 *
 *   0,1,2 — the three keys the spec principal declares required.
 *   3     — the present-and-`undefined` spelling itself.
 *   4     — NOT here: `id: null` is refused by `id?: string` too, so it does
 *           not move. It pins that the anonymous answer is not an input,
 *           which is a different claim from this card's.
 *   5     — the spec-derived incomplete principal.
 *   6-8   — the overshoot controls; green on both legs by construction.
 *   9     — NOT here either, and for the OPPOSITE reason: since objectui#6559
 *           the parameter carries the contract, so that call is refused on
 *           both legs. This leg re-widens the local type alias only, and the
 *           parameter reads the real module's declaration.
 */
const EXPECTED_FLIPS = [0, 1, 2, 3, 5];

describe('discrimination: the same cases against the pre-fix optionality', () => {
  it('re-widening the cast is exactly what turns the rejection cases green', () => {
    const flipped = CASES.map((_, i) => i).filter(
      (i) => againstReverted.lines.has(i) !== againstReal.lines.has(i),
    );
    expect(flipped).toEqual(EXPECTED_FLIPS);
  });

  it('every flipped case is REJECTED now and was ACCEPTED before', () => {
    for (const i of EXPECTED_FLIPS) {
      expect({ i, now: againstReal.lines.has(i), before: againstReverted.lines.has(i) }).toEqual({
        i,
        now: true,
        before: false,
      });
    }
  });
});

/**
 * The runtime half. Both of these pass on `main` at `0235ce7c1` too — the
 * runtime was never the defect and this card deliberately did not move it —
 * and they are here so the mismatch cannot be "fixed" later by moving the
 * runtime instead of the producer.
 */
describe('objectui#6551 — the runtime the narrowed declaration now describes', () => {
  it('still answers the real principal unchanged', () => {
    expect(
      buildExpressionUser({ id: 'u_1', name: 'Ada', email: 'a@e.d', positions: ['user'] }),
    ).toStrictEqual({
      id: 'u_1',
      name: 'Ada',
      email: 'a@e.d',
      role: 'user',
      isPlatformAdmin: false,
      positions: ['user'],
    });
  });

  it('adds no consumer-side fallback for the input the type now refuses', () => {
    // THE FENCE, MECHANISED. Rejected shape 1 was `id: u.id ?? null`, which
    // would make this read `null` — a lenient default in the consumer
    // (AGENTS.md #0.1), and one that silently equates "signed in, no id" with
    // "signed out". No such producer exists, so the honest answer is that the
    // input never arrives; the type is where that is now said, and this asserts
    // nothing was quietly added below it. Re-deciding this is a card, not a
    // test edit.
    // Since objectui#6559 the PARAMETER refuses this input, so reaching the
    // runtime with it takes a deliberate double assertion — which is the
    // honest spelling: no producer can arrive here by accident any more, and
    // this case is only asking what the code does if one is forced through.
    const built = buildExpressionUser({
      name: 'B',
      email: 'b@c.d',
    } as unknown as ExpressionUserSession);

    expect(built.id).toBeUndefined();
    expect(built.id).not.toBeNull();
    // The keys that DO carry a declared default still carry it — the asymmetry
    // this card was filed about is between these and the three above, and it is
    // closed by narrowing the three, not by lowering these.
    expect(built.role).toBe('user');
    expect(built.isPlatformAdmin).toBe(false);
    expect(built.positions).toEqual([]);
  });
});

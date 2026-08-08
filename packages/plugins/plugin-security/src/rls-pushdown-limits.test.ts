// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6132 — the RLS end of the CEL pushdown bounds convergence, in BOTH positions
 * of the dated switch.
 *
 * `@objectstack/formula`'s `cel-to-filter.ts` used to parse RLS predicates
 * through a private, limitless environment of its own, so a predicate the
 * interpreter refuses outright (`Exceeded maxAstNodes (256)` / `maxDepth (32)` /
 * `maxListElements (64)`) compiled here and reached REAL pushdown SQL, silently.
 * It now parses through the canonical front end, and the maintainer's A′ ruling
 * (2026-08-08, quoted verbatim on the issue) grants a grace window:
 *
 * > **rc grace, GA flip:** during 17.0.0-rc.x an over-limit predicate on the
 * > pushdown path still compiles + emits a WARN naming the exceeded limit; at
 * > v17 GA the runtime flips to fail-closed refusal (the `parse-error` ⇒
 * > `RLS_DENY_FILTER` path).
 *
 * The formula package pins the compiler's answer at both positions. THIS file
 * pins what that answer does to authorization — which is the half that matters,
 * because the deny sentinel lives here and nowhere else.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RowLevelSecurityPolicy } from '@objectstack/spec/security';
import { setCelPushdownLimitsModeForTests, __resetPushdownLimitWarnings } from '@objectstack/formula';

import { RLSCompiler, RLS_DENY_FILTER } from './rls-compiler.js';

/** 80-term conjunction — over `maxAstNodes` (256). */
const CONJ_80 = Array.from({ length: 80 }, (_, i) => `f${i} == ${i}`).join(' && ');
/** 40-level nesting — over `maxDepth` (32). */
const NEST_40 = `${'('.repeat(40)}owner_id == current_user.id${')'.repeat(40)}`;
/** 200-element `$in` — over `maxListElements` (64). */
const IN_200 = `stage in [${Array.from({ length: 200 }, (_, i) => `'s${i}'`).join(',')}]`;

const OVER_LIMIT: ReadonlyArray<{ name: string; using: string; limit: string }> = [
  { name: '80-term conjunction', using: CONJ_80, limit: 'maxAstNodes' },
  { name: '40-level nesting', using: NEST_40, limit: 'maxDepth' },
  { name: '200-element $in', using: IN_200, limit: 'maxListElements' },
];

function policy(using: string): RowLevelSecurityPolicy {
  return { name: 'over_budget', object: 'deal', operation: 'select', using } as RowLevelSecurityPolicy;
}

const CTX = { userId: 'u1', tenantId: 'org-1' } as never;

function compilerWithLogger() {
  const logger = { warn: vi.fn() };
  const compiler = new RLSCompiler();
  compiler.setLogger(logger);
  return { compiler, logger };
}

let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  __resetPushdownLimitWarnings();
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  consoleWarn.mockRestore();
});

describe('switch = rc-grace (17.0.0-rc.x) — the policy still ENFORCES, and the WARN names the limit', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = setCelPushdownLimitsModeForTests('rc-grace');
  });
  afterEach(() => restore());

  for (const { name, using, limit } of OVER_LIMIT) {
    it(`${name}: compiles to a real filter — NOT the deny sentinel`, () => {
      const { compiler, logger } = compilerWithLogger();
      const filter = compiler.compileFilter([policy(using)], CTX);
      expect(filter).not.toEqual(RLS_DENY_FILTER);
      expect(filter).not.toBeNull();
      // The policy was not dropped, so `compileFilter`'s own "DROPPED (no
      // enforcement)" warning must NOT fire — the grace window is "it still
      // works", not "it silently vanished".
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it(`${name}: WARNs on the console naming ${limit} and the GA consequence`, () => {
      compilerWithLogger().compiler.compileFilter([policy(using)], CTX);
      const message = String(consoleWarn.mock.calls[0]?.[0]);
      expect(message).toContain('[cel-to-filter]');
      expect(message).toContain(limit);
      expect(message).toMatch(/this predicate measures \d+/);
      expect(message).toContain('RLS_DENY_FILTER');
    });
  }
});

describe('switch = fail-closed (v17 GA) — the policy is REFUSED and the request fails closed', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = setCelPushdownLimitsModeForTests('fail-closed');
  });
  afterEach(() => restore());

  for (const { name, using, limit } of OVER_LIMIT) {
    it(`${name}: the only applicable policy → RLS_DENY_FILTER (zero rows)`, () => {
      const { compiler } = compilerWithLogger();
      expect(compiler.compileFilter([policy(using)], CTX)).toEqual(RLS_DENY_FILTER);
    });

    it(`${name}: the drop is OBSERVABLE — the shape gate refuses it, so the policy is warned`, () => {
      const { compiler, logger } = compilerWithLogger();
      compiler.compileFilter([policy(using)], CTX);
      // ADR-0056 D4: a predicate `isSupportedRlsExpression` rejects earns the
      // "DROPPED (no enforcement)" warning rather than vanishing in silence.
      // Both sides of that comparison are downstream of the same switch, so the
      // flip cannot produce a silently-dropped policy.
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(String(logger.warn.mock.calls[0]?.[0])).toContain('DROPPED (no enforcement)');
    });

    it(`${name}: refusing does not ALSO emit the grace WARN`, () => {
      compilerWithLogger().compiler.compileFilter([policy(using)], CTX);
      const graceWarns = consoleWarn.mock.calls.filter((c) => String(c[0]).includes('[cel-to-filter]'));
      expect(graceWarns).toHaveLength(0);
      expect(limit).toBeTruthy();
    });

    it(`${name}: an over-budget policy cannot be rescued by a second, compilable one — it is OR'd, not silently widened`, () => {
      const { compiler } = compilerWithLogger();
      const filter = compiler.compileFilter(
        [policy(using), policy('owner_id == current_user.id')],
        CTX,
      );
      // The over-budget policy dropped out; the surviving policy is the whole
      // filter. This is the pre-existing multi-policy semantic (any policy
      // allows), stated here so the flip's blast radius is on the record.
      expect(filter).toEqual({ owner_id: 'u1' });
    });
  }
});

describe('both positions — a within-budget policy is untouched', () => {
  for (const mode of ['rc-grace', 'fail-closed'] as const) {
    it(`switch = ${mode}: the ordinary RLS shapes compile identically, with no WARN`, () => {
      const restore = setCelPushdownLimitsModeForTests(mode);
      try {
        const { compiler, logger } = compilerWithLogger();
        expect(compiler.compileFilter([policy('owner_id == current_user.id')], CTX)).toEqual({ owner_id: 'u1' });
        expect(compiler.compileFilter([policy("stage == 'won'")], CTX)).toEqual({ stage: 'won' });
        expect(
          compiler.compileFilter([policy('organization_id == current_user.organization_id')], CTX),
        ).toEqual({ organization_id: 'org-1' });
        // 40 conjuncts ≈ 120 AST nodes — under `maxAstNodes` (256).
        const under = Array.from({ length: 40 }, (_, i) => `f${i} == ${i}`).join(' && ');
        expect(compiler.compileFilter([policy(under)], CTX)).not.toEqual(RLS_DENY_FILTER);
        expect(logger.warn).not.toHaveBeenCalled();
        expect(consoleWarn.mock.calls.filter((c) => String(c[0]).includes('[cel-to-filter]'))).toHaveLength(0);
      } finally {
        restore();
      }
    });
  }
});

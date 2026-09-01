// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins for the error-code provenance gate (#13353). Fixture-driven on purpose:
 * every case injects synthetic sources/ledgers into the gate's exported pure
 * functions, so this suite reads nothing outside its package — the REAL
 * repo-wide run belongs to the gate's own CI step (`check:error-code-provenance`
 * in lint.yml's unfiltered job), where turbo's per-package input hashing
 * cannot cache it stale. A vitest case that walked `packages/**` itself would
 * be exactly the cross-package-invisible test `check:cross-package-test-inputs`
 * exists to flag.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  STAMP_PATTERNS,
  scanSourceText,
  deriveFindings,
  type StampSite,
} from './check-error-code-provenance';
import type { ProvenanceWaiver } from '../src/api/error-code-ledger.zod';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const registered = new Set(['REGISTERED_ONE', 'REGISTERED_TWO']);
const ledger = { '@objectstack/owner': ['REGISTERED_ONE', 'REGISTERED_TWO'] } as const;
const site = (pkg: string, code: string, pattern = 'objlit'): StampSite => ({
  file: 'packages/x/src/a.ts',
  line: 1,
  package: pkg,
  code,
  pattern,
});

describe('STAMP_PATTERNS (published, one pin per pattern)', () => {
  it('publishes exactly the three sweep patterns the card measured with', () => {
    // The list is a PUBLISHED bound: an unrecognised spelling produces no
    // finding, silently — so growing or shrinking it is a deliberate act that
    // must also touch this pin (and the gate's own --self-test).
    expect(STAMP_PATTERNS.map((p) => p.name)).toEqual(['objlit', 'assign', 'constdef']);
  });

  it('objlit: a registered code in an object literal is a site', () => {
    const hits = scanSourceText("return c.json({ error: { code: 'REGISTERED_ONE' } }, 400);", registered);
    expect(hits).toEqual([{ code: 'REGISTERED_ONE', pattern: 'objlit', line: 1 }]);
  });

  it('assign: a registered code stamped onto a throwable is a site', () => {
    const hits = scanSourceText("const err = new Error(m);\nerr.code = 'REGISTERED_ONE';", registered);
    expect(hits).toEqual([{ code: 'REGISTERED_ONE', pattern: 'assign', line: 2 }]);
  });

  it('constdef: a *_CODE constant initializer is a site, type annotation included', () => {
    expect(scanSourceText("export const MY_CODE = 'REGISTERED_ONE';", registered))
      .toEqual([{ code: 'REGISTERED_ONE', pattern: 'constdef', line: 1 }]);
    // The union-typed spelling stays ONE site: the annotation's own literals
    // sit behind no recognised token (`MY_CODE:` is not `code:`), so only the
    // initializer is read.
    expect(scanSourceText("const MY_CODE: 'REGISTERED_ONE' | 'X' = 'REGISTERED_ONE';", registered))
      .toEqual([{ code: 'REGISTERED_ONE', pattern: 'constdef', line: 1 }]);
  });

  it('an unregistered code is out of population — the dispatcher-vocabulary gate owns it', () => {
    expect(scanSourceText("return { code: 'NOT_IN_ANY_LEDGER' };", registered)).toEqual([]);
  });

  it('a code quoted in a comment is mention, not a site', () => {
    expect(scanSourceText("// the 403 carries { code: 'REGISTERED_ONE' }\nconst x = 1;", registered)).toEqual([]);
    expect(scanSourceText("/* err.code = 'REGISTERED_ONE' */\nconst x = 1;", registered)).toEqual([]);
  });
});

describe('deriveFindings — the reconciliation, both directions', () => {
  it('RED LEG: a synthetic unlisted stamper of a registered code is a violation', () => {
    const { violations } = deriveFindings([site('@objectstack/rogue', 'REGISTERED_ONE')], ledger, []);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ package: '@objectstack/rogue', code: 'REGISTERED_ONE' });
  });

  it('a stamper listed under its own owner key is green', () => {
    const { violations, listed } = deriveFindings([site('@objectstack/owner', 'REGISTERED_ONE')], ledger, []);
    expect(violations).toEqual([]);
    expect(listed).toHaveLength(1);
  });

  it('a waiver admits exactly the (package, code) pair it records — and only that', () => {
    const waiver: ProvenanceWaiver = {
      package: '@objectstack/rogue',
      code: 'REGISTERED_ONE',
      registeredUnder: '@objectstack/owner',
      reason: 'fixture: recorded decision',
    };
    const admitted = deriveFindings([site('@objectstack/rogue', 'REGISTERED_ONE')], ledger, [waiver]);
    expect(admitted.violations).toEqual([]);
    expect(admitted.waived).toHaveLength(1);
    expect(admitted.waiverProblems).toEqual([]);
    // A different code from the same package is NOT admitted.
    const other = deriveFindings(
      [site('@objectstack/rogue', 'REGISTERED_ONE'), site('@objectstack/rogue', 'REGISTERED_TWO')],
      ledger,
      [waiver],
    );
    expect(other.violations).toHaveLength(1);
    expect(other.violations[0]?.code).toBe('REGISTERED_TWO');
  });

  it('a waiver whose scan site is gone reddens — the liveness ratchet', () => {
    const { waiverProblems } = deriveFindings([], ledger, [{
      package: '@objectstack/rogue',
      code: 'REGISTERED_ONE',
      registeredUnder: '@objectstack/owner',
      reason: 'fixture',
    }]);
    expect(waiverProblems.some((p) => p.includes('NO stamp site'))).toBe(true);
  });

  it('a waiver naming a registeredUnder key that does not list the code reddens', () => {
    const { waiverProblems } = deriveFindings([site('@objectstack/rogue', 'REGISTERED_ONE')], ledger, [{
      package: '@objectstack/rogue',
      code: 'REGISTERED_ONE',
      registeredUnder: '@objectstack/nobody',
      reason: 'fixture',
    }]);
    expect(waiverProblems.some((p) => p.includes('registeredUnder'))).toBe(true);
  });

  it('a row plus a waiver for the same pair is dead weight and reddens', () => {
    const { waiverProblems } = deriveFindings([site('@objectstack/owner', 'REGISTERED_ONE')], ledger, [{
      package: '@objectstack/owner',
      code: 'REGISTERED_ONE',
      registeredUnder: '@objectstack/owner',
      reason: 'fixture',
    }]);
    expect(waiverProblems.some((p) => p.includes('dead weight'))).toBe(true);
  });

  it('duplicate waivers for one pair redden — one decision, one record', () => {
    const waiver: ProvenanceWaiver = {
      package: '@objectstack/rogue',
      code: 'REGISTERED_ONE',
      registeredUnder: '@objectstack/owner',
      reason: 'fixture',
    };
    const { waiverProblems } = deriveFindings([site('@objectstack/rogue', 'REGISTERED_ONE')], ledger, [waiver, { ...waiver }]);
    expect(waiverProblems.some((p) => p.includes('duplicate'))).toBe(true);
  });
});

describe('the shipped script', () => {
  it('--self-test passes (the per-pattern red legs, run exactly as CI runs them)', () => {
    const require = createRequire(import.meta.url);
    const tsx = require.resolve('tsx/cli');
    const result = spawnSync(process.execPath, [tsx, path.join(HERE, 'check-error-code-provenance.ts'), '--self-test'], {
      cwd: path.resolve(HERE, '..'),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    expect(output).toContain('self-test OK');
    expect(result.status, output).toBe(0);
  });
});

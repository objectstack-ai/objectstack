// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12509] ADR-0112's `declaredCode` channel has a 5xx SCOPE, and this file
 * pins the rule itself — the doors are pinned to it from their own packages.
 *
 * ## What was on the wire before this
 *
 * Measured on `origin/main` @ `aef1b7e64`, by driving the real routes rather
 * than by reading source:
 *
 * ```
 * POST /api/v1/packages/publish  → 500 {"error":{"code":"INTERNAL_ERROR",
 *     "message":"Internal server error","declaredCode":"SQLITE_ERROR"}}
 * POST /api/v1/analytics/query   → 500 {"error":{"code":"INTERNAL_ERROR",
 *     "message":"Internal server error","declaredCode":"42P01"}}
 * ```
 *
 * The prose withhold (#8086) fired and the driver's own dialect went out
 * beside it. `SQLITE_ERROR` vs `42P01` names the backend, which is one of the
 * two disclosures the message withhold exists to prevent.
 *
 * ## The ruling this implements
 *
 * Maintainer, 2026-08-27, option D: in 5xx sanitisation a DEMOTED code — one
 * the fallback-to-500 picked up from an UNDECLARED producer — is withheld
 * along with the prose; an AUTHOR-DECLARED code survives. One rule at the
 * shared resolver, every door inherits it. Per-door variants, withholding the
 * author channel too, and recording the leak as a decision were all declined.
 *
 * ## Why the STATUS channel is the discriminator
 *
 * A driver errno and an app's own spelling both arrive on `.code` as a plain
 * string. Anything that told them apart by LOOKING at the string would be a
 * heuristic over an open channel — and unfalsifiable, since nothing stops an
 * app from spelling `SQLITE_ERROR`. Section 3 is that pin: two throws whose
 * `.code` strings are IDENTICAL and whose answers differ, so an implementation
 * that inspected the spelling cannot pass here.
 *
 * ## The cost, pinned rather than hidden
 *
 * Section 2's last row: a producer that spells a code and declares NO status
 * loses that code on a 5xx. That is what "the fallback-to-500 picked it up
 * from an undeclared producer" means when it is spelled as code, and it is
 * kept visible here so nobody discovers it from a bug report. The tenant
 * limb the ADR-0112 amendment protects is NOT this shape: `SandboxError`
 * answers 400, so `DUPLICATE` rides a 4xx (pinned in
 * `packages/runtime/src/domains/actions-validation-envelope.test.ts`).
 */

import { describe, it, expect } from 'vitest';
import {
  resolveThrownHttpError,
  demotedDeclaredCode,
  serverFaultProvenance,
} from './thrown-http-error.js';

/** A producer's throw, carrying whatever it declares. */
function thrown(message: string, carried: Record<string, unknown>): Error {
  return Object.assign(new Error(message), carried);
}

// ---------------------------------------------------------------------------
// 1. The discriminator
// ---------------------------------------------------------------------------

describe('[#12509] `serverFaultProvenance` — who named this 5xx', () => {
  const CASES: Array<{ name: string; error: unknown; expected: string | undefined }> = [
    {
      name: 'a bare driver fault — the fallback supplied the 500',
      error: thrown('SQLITE_ERROR: no such table: leave_request', { code: 'SQLITE_ERROR' }),
      expected: 'undeclared',
    },
    {
      name: 'a producer that declared 503 itself',
      error: thrown('the ledger service is down', { status: 503, code: 'ACME_LEDGER_OFFLINE' }),
      expected: 'declared',
    },
    {
      name: 'a producer that declared 500 itself — declaring the fallback VALUE is still declaring',
      error: thrown('the importer gave up', { status: 500, code: 'ACME_IMPORT_ABORTED' }),
      expected: 'declared',
    },
    {
      name: 'a declared 5xx spelled `statusCode`',
      error: thrown('not built yet', { statusCode: 501, code: 'ACME_NOT_BUILT' }),
      expected: 'declared',
    },
    {
      name: 'a declared 4xx — nothing is sanitised below 500',
      error: thrown('invoices still open', { status: 409, code: 'CLOSE_PERIOD_LOCKED' }),
      expected: undefined,
    },
    {
      name: 'a validation shape — a 400 by shape, so also below 500',
      error: thrown('bad manifest', { name: 'ValidationError', fields: [{ field: 'id' }] }),
      expected: undefined,
    },
  ];

  for (const c of CASES) {
    it(c.name, () => {
      expect(serverFaultProvenance(resolveThrownHttpError(c.error))).toBe(c.expected);
    });
  }

  it('the cases above really do produce all three answers', () => {
    // Anti-vacuity for the table: rows that collapsed onto one answer would
    // agree with any implementation, including one that always says the same
    // thing.
    const answers = CASES.map((c) => serverFaultProvenance(resolveThrownHttpError(c.error)));
    expect(new Set(answers)).toEqual(new Set(['undeclared', 'declared', undefined]));
  });

  it('the fallback the CALLER supplies is what decides, not the number 500', () => {
    // A door that resolves against a 4xx fallback is answering a 4xx, and
    // nothing here applies. The same throw, two callers, two verdicts.
    const bare = new Error('kaboom');
    expect(serverFaultProvenance(resolveThrownHttpError(bare, 500))).toBe('undeclared');
    expect(serverFaultProvenance(resolveThrownHttpError(bare, 404))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. What a boundary is allowed to put on the wire
// ---------------------------------------------------------------------------

describe('[#12509] `demotedDeclaredCode` withholds an UNDECLARED 5xx spelling', () => {
  const CASES: Array<{ name: string; error: unknown; status: number; declaredCode: string | undefined }> = [
    {
      name: 'sqlite errno on an undeclared 500 → WITHHELD',
      error: thrown('SQLITE_ERROR: no such table: leave_request', { code: 'SQLITE_ERROR' }),
      status: 500,
      declaredCode: undefined,
    },
    {
      name: 'postgres errno on an undeclared 500 → WITHHELD',
      error: thrown('relation "leave_request" does not exist', { code: '42P01' }),
      status: 500,
      declaredCode: undefined,
    },
    {
      name: 'an AUTHOR-declared 503 → survives',
      error: thrown('the ledger service is down', { status: 503, code: 'ACME_LEDGER_OFFLINE' }),
      status: 503,
      declaredCode: 'ACME_LEDGER_OFFLINE',
    },
    {
      name: 'an AUTHOR-declared 500 → survives; the ruling splits by PROVENANCE, not by status value',
      error: thrown('the importer gave up', { status: 500, code: 'ACME_IMPORT_ABORTED' }),
      status: 500,
      declaredCode: 'ACME_IMPORT_ABORTED',
    },
    {
      name: 'an app spelling on a declared 409 → untouched, 5xx sanitisation does not reach it',
      error: thrown('invoices still open', { status: 409, code: 'CLOSE_PERIOD_LOCKED' }),
      status: 409,
      declaredCode: 'CLOSE_PERIOD_LOCKED',
    },
    {
      name: 'a REGISTERED code is already in `code` — absent for the #9106 reason, not this one',
      error: thrown('would drop data', { status: 409, code: 'DESTRUCTIVE_CHANGE' }),
      status: 409,
      declaredCode: undefined,
    },
    {
      name: '⚠️ the COST: a code spelled with NO declared status loses the channel on a 5xx',
      error: thrown('the widget refused the write', { code: 'WIDGET_REFUSED_THE_WRITE' }),
      status: 500,
      declaredCode: undefined,
    },
  ];

  for (const c of CASES) {
    it(c.name, () => {
      const resolved = resolveThrownHttpError(c.error);
      // The POSITIVE half first: an absence asserted on a throw that resolved
      // to some entirely different status would pass for the wrong reason.
      expect(resolved.status).toBe(c.status);
      expect(demotedDeclaredCode(resolved)).toBe(c.declaredCode);
    });
  }

  it('the withhold is a WITHHOLD — the resolver still records what the producer wrote', () => {
    // The two fields answer different questions, and a "fix" that stopped
    // recording the spelling would break `metadata-protocol`'s row mapper and
    // every log that reads it. Only the WIRE read is narrowed.
    const resolved = resolveThrownHttpError(thrown('boom', { code: 'SQLITE_ERROR' }));
    expect(resolved.declaredCode).toBe('SQLITE_ERROR');
    expect(demotedDeclaredCode(resolved)).toBeUndefined();
  });

  it('both outcomes are reachable from this table', () => {
    // Anti-vacuity: a rule that withheld everything, or nothing, would satisfy
    // half of the rows above and this line is what notices.
    const answers = CASES.map((c) => demotedDeclaredCode(resolveThrownHttpError(c.error)));
    expect(answers.filter((a) => a !== undefined).length).toBeGreaterThan(1);
    expect(answers.filter((a) => a === undefined).length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// 3. The spelling is NOT what decides — the pin against a string heuristic
// ---------------------------------------------------------------------------

describe('[#12509] identical spellings, different answers — provenance, not the string', () => {
  it('the SAME `.code` survives when declared and is withheld when not', () => {
    const SPELLING = 'SQLITE_ERROR';
    const declared = resolveThrownHttpError(thrown('down for maintenance', { status: 503, code: SPELLING }));
    const undeclared = resolveThrownHttpError(thrown('down for maintenance', { code: SPELLING }));

    expect(demotedDeclaredCode(declared)).toBe(SPELLING);
    expect(demotedDeclaredCode(undeclared)).toBeUndefined();
  });

  it('and an app-shaped spelling is withheld on the undeclared side too', () => {
    // The mirror image of the row above: nothing here reads the string, so a
    // driver-looking code and an app-looking code get the same treatment for
    // the same reason. An implementation that pattern-matched errnos would
    // pass the first case and fail this one.
    const SPELLING = 'ACME_WIDGET_REFUSED';
    const declared = resolveThrownHttpError(thrown('refused', { status: 503, code: SPELLING }));
    const undeclared = resolveThrownHttpError(thrown('refused', { code: SPELLING }));

    expect(demotedDeclaredCode(declared)).toBe(SPELLING);
    expect(demotedDeclaredCode(undeclared)).toBeUndefined();
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17130] The row-scope RESOLUTION refusals declare themselves —
 * `READ_SCOPE_COMPILE_FAILED` / 500 — so no wording can turn one into an empty
 * chart.
 *
 * ## What was wrong
 *
 * The row-level read scope is established in two stages. The LOWERING stage
 * (`read-scope-sql.ts`) has declared `READ_SCOPE_COMPILE_FAILED` / 500 since
 * #5367. The RESOLUTION stage — `plugin.ts`'s `security` bridge, and
 * `AnalyticsService.resolveReadScopes` — refused with a bare
 * `throw new Error(…)`.
 *
 * A bare refusal is the one kind `queryDataset`'s catch classifies by WORDING:
 * `hasDeclaredErrorEnvelope` re-throws anything a producer classified, and only
 * the unclassified reaches `isMissingSourceError` — six substrings, three of
 * which (`not registered`, `unknown object`, `is not a registered object`) are
 * exactly the phrasings a registry or security refusal reaches for. A hit is
 * not a wrong status code; it is `{rows: [], fields: [], totals: []}` served to
 * the caller — a fail-closed gate rendered as a confident empty chart, with one
 * `warn` and no exception.
 *
 * PR #17125's refusal propagates today only because its text happens to match
 * none of the six. ⛔ A coincidence, not a construction — and the fix is the
 * DECLARATION, not a luckier string: every message below is byte-unchanged.
 *
 * ## The three blocks
 *
 * `the producers declare it` captures the real refusals — the bridge's and the
 * pre-pass's — and pins `code` + `status` on them. These are the rows that go
 * red on the ablation, because their wording never matched the sniffer and
 * never needed to.
 *
 * `a colliding refusal propagates` is the property the card asks for, over all
 * THREE colliding limbs. Bare, each of these is an empty chart; enveloped, each
 * reaches the caller. It uses the package's own constructor rather than a
 * synthesised envelope, because the claim under test is about the refusals THIS
 * PACKAGE raises.
 *
 * `#5033's leniency is untouched` is the negative control, and it must stay
 * byte-identical: a genuine absent source table still degrades to the empty
 * result with its `warn`, and an ABSENT security service still runs unscoped.
 * That is the deliberate behaviour the file's own docblock exists to protect,
 * and ⛔ nothing here may regress it.
 *
 * ## Reverse verification — direction predicted BEFORE running
 *
 * Ordinary direction (red), and SPLIT, because the two blocks fail for
 * different reasons:
 *
 *   - Revert both producers to `throw new Error(…)`: every row of
 *     `the producers declare it` that reads `code`/`status` goes RED on
 *     `undefined`, and every row of `a colliding refusal propagates` goes RED
 *     by returning the empty result instead of throwing.
 *   - The `#5033` block stays GREEN in both states — which is what "the
 *     leniency is untouched" means as evidence rather than as a claim.
 *
 * ⛔ Note which rows do NOT move: the real producers' MESSAGES are asserted in
 * `the producers declare it` and in `read-scope-bridge-resolution.test.ts`, and
 * they stay green under the ablation — the wording did not change, and that
 * asymmetry (envelope red, wording green) is the whole finding.
 */

import { describe, it, expect, vi } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';
import { readScopeUnresolvedError } from '../read-scope-refusal.js';

/** The ADR-0112 fields the REST boundary classifies on. */
interface Refusal extends Error {
  code?: unknown;
  status?: unknown;
}

const EMPTY = { rows: [], fields: [], totals: [] };

const dataset = DatasetSchema.parse({
  name: 'sales',
  label: 'Sales',
  object: 'opportunity',
  dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
});

const SELECTION = { dimensions: ['stage'], measures: ['revenue'] };
const CTX = { tenantId: 'org_A', userId: 'u_seeker' } as ExecutionContext;

function logger() {
  return { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() } as any;
}

async function refusalFrom(thunk: () => unknown | Promise<unknown>): Promise<Refusal | undefined> {
  try {
    await thunk();
    return undefined;
  } catch (e) {
    return e as Refusal;
  }
}

/** A service whose EXECUTION throws `thrown` — the way into `queryDataset`'s catch. */
function serviceThatThrows(thrown: unknown, log = logger()) {
  return new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async () => { throw thrown; },
    isRegisteredObject: () => true,
    logger: log,
  });
}

/**
 * A service whose ROW-SCOPE PROVIDER throws — the real seam, reached through
 * `resolveReadScopes` from inside `queryDataset`'s try. Execution itself is
 * healthy, so a result coming back at all means the fail-closed pre-pass was
 * bypassed or its refusal was swallowed.
 */
function serviceWhoseScopeProviderThrows(cause: unknown, log = logger()) {
  return new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async () => [{ stage: 'won', revenue: 42 }],
    isRegisteredObject: () => true,
    getReadScope: () => { throw cause; },
    logger: log,
  });
}

/**
 * The three limbs of `isMissingSourceError` a registry or security refusal
 * naturally reaches for — the card's own list, spelled here as the CALLER-side
 * inputs of the property rather than as a claim about the predicate (the
 * predicate itself is asserted in `refusal-wording-collision.test.ts`, which
 * imports the real function).
 *
 * ⚠️ Each names the dataset's OWN object on purpose. A bare colliding refusal
 * lands in one of #5033's TWO arms depending on which relation
 * `missingSourceRelation` reads out of it: name the dataset's own object and it
 * degrades to the empty chart (the arm this card is about); name anything else
 * — including a stray word the extractor mistakes for a table, measured: "…
 * unknown object in the resolved scope" yields `in` — and it is re-reported as
 * a cross-datasource topology error, loud but describing a JOIN that does not
 * exist. Both arms are wrong for a security refusal; the silent one is the one
 * under test here, so these fixtures aim at it deliberately rather than by
 * luck.
 */
const COLLIDING_WORDINGS = [
  '[Analytics] row-level read scope could not be resolved for "opportunity"; the policy names object "opportunity" is not registered with the security service.',
  '[Analytics] row-level read scope could not be resolved; the resolved scope names unknown object: opportunity.',
  '[Analytics] read-scope resolution failed: "opportunity" is not a registered object on the security service.',
];

describe('[#17130] the row-scope resolution refusals declare an ADR-0112 envelope', () => {
  it('the constructor stamps the code the lowering stage already owns', () => {
    const err = readScopeUnresolvedError('[Analytics] read-scope resolution failed for "x"; query denied (fail-closed).') as Refusal;
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(err.status).toBe(500);
    // ⛔ The message is the site's, untouched — #17130 fixes the declaration.
    expect(err.message).toBe('[Analytics] read-scope resolution failed for "x"; query denied (fail-closed).');
  });

  it('resolveReadScopes denies with the envelope, and the wording is unchanged', async () => {
    const log = logger();
    const err = await refusalFrom(() =>
      serviceWhoseScopeProviderThrows(new Error('security service exploded'), log)
        .queryDataset(dataset, SELECTION, CTX),
    );
    expect(err, 'a fail-closed row-scope denial was swallowed').toBeInstanceOf(Error);
    expect(err?.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(err?.status).toBe(500);
    expect(String(err?.message)).toMatch(/read-scope resolution failed for "opportunity"; query denied \(fail-closed\)/);
    // Refused ⇒ never degraded, so no "empty result" warn was emitted either.
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('returning an empty result'));
    // …and the operator still gets the cause at `error`, as before.
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('read-scope resolution failed for object "opportunity"'),
      expect.any(Error),
    );
  });

  it('the bridge refusal reaching the pre-pass keeps a declared envelope end to end', async () => {
    // The bridge (`plugin.ts`) throws its own enveloped refusal; the pre-pass
    // catches it and answers with its own. Both stages declared ⇒ whichever one
    // reaches `queryDataset` is re-thrown by declaration, never sniffed.
    const bridgeRefusal = readScopeUnresolvedError(
      '[Analytics] row-level read scope could not be resolved for "opportunity"; query refused (fail-closed).',
    );
    const err = await refusalFrom(() =>
      serviceWhoseScopeProviderThrows(bridgeRefusal).queryDataset(dataset, SELECTION, CTX),
    );
    expect(err?.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(err?.status).toBe(500);
  });
});

describe('[#17130] a colliding refusal propagates instead of becoming a 200 with an empty chart', () => {
  for (const wording of COLLIDING_WORDINGS) {
    it(`propagates: ${wording.slice(0, 64)}…`, async () => {
      const log = logger();
      const err = await refusalFrom(() =>
        serviceThatThrows(readScopeUnresolvedError(wording), log).queryDataset(dataset, SELECTION, CTX),
      );
      expect(err, 'a fail-closed refusal was served as an empty chart').toBeInstanceOf(Error);
      expect(err?.code).toBe('READ_SCOPE_COMPILE_FAILED');
      expect(err?.status).toBe(500);
      expect(String(err?.message)).toBe(wording);
      expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('returning an empty result'));
    });
  }

  it('…and the same three wordings BARE still degrade — which is what makes the envelope the fix', async () => {
    // ⛔ Not an aspiration: this is the measurement that says the property is
    // carried by the declaration and not by the phrasing. Strip the envelope
    // and every one of the three is an empty chart again. That is also the
    // ablation's predicted shape, asserted here so the claim is re-runnable.
    for (const wording of COLLIDING_WORDINGS) {
      const result = await serviceThatThrows(new Error(wording)).queryDataset(dataset, SELECTION, CTX);
      expect(result, `bare wording unexpectedly propagated: ${wording}`).toEqual(EMPTY);
    }
  });
});

describe('[#17130] #5033’s deliberate leniency is untouched — the negative control', () => {
  it('a genuine absent source table still degrades to the empty result, with the warn', async () => {
    const log = logger();
    const result = await serviceThatThrows(
      new Error('SELECT COUNT(*) FROM "opportunity" - no such table: opportunity'),
      log,
    ).queryDataset(dataset, SELECTION, CTX);
    expect(result).toEqual(EMPTY);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('backing object "opportunity" is unavailable'),
    );
  });

  it('postgres’s and mysql’s real wordings still degrade too', async () => {
    expect(
      await serviceThatThrows(
        new Error('select "stage" from "opportunity" - relation "opportunity" does not exist'),
      ).queryDataset(dataset, SELECTION, CTX),
    ).toEqual(EMPTY);
    expect(
      await serviceThatThrows(new Error("Table 'app.opportunity' doesn't exist")).queryDataset(
        dataset,
        SELECTION,
        CTX,
      ),
    ).toEqual(EMPTY);
  });

  it('an ABSENT row-scope provider still runs the query unscoped', async () => {
    // The state `read-scope-bridge-resolution.test.ts` calls the negative
    // control: no security service at all is a real single-tenant deployment,
    // reported loudly at init, and refusing there would break it. Re-asserted
    // here so this file's own change cannot narrow it.
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async () => [{ stage: 'won', revenue: 42 }],
      isRegisteredObject: () => true,
      logger: logger(),
    });
    const result = await svc.queryDataset(dataset, SELECTION, CTX);
    expect(result.rows).toEqual([{ stage: 'won', revenue: 42 }]);
  });
});

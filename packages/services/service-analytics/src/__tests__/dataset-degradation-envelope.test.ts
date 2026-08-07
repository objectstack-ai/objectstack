// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5717] The dataset degradation path judges an error by its ENVELOPE first,
 * and only then by its words.
 *
 * ## What was wrong
 *
 * `queryDataset` wraps execution in a catch whose whole job is #5033's
 * deliberate leniency: a widget whose backing object is not mounted in this
 * kernel renders "no data" instead of a 500. The criterion for "not mounted"
 * was `isMissingSourceError` — a substring match over the error MESSAGE. So the
 * degradation was available to any error that happened to phrase itself like a
 * driver, and #5352/#5367's finding on the REST face ("the HTTP status of an
 * error family must not be a property of its wording") applied here one level
 * worse: the outcome was not a wrong status code but a SILENT EMPTY RESULT —
 * no exception, no 4xx, no 5xx, one `warn`, and a confident empty chart.
 *
 * One refusal already matched. `dataset-compiler.ts`'s
 *
 *   `[dataset-compiler] dataset "X" includes relationship "R" which does not
 *    exist on object "O".`
 *
 * carries both `relation` (inside "relationship") and `does not exist`, which
 * is exactly what the postgres limb tested for. It never went off for one
 * reason: `queryDataset` compiles BEFORE the try, so that throw has never been
 * inside the catch's reach. A mine, wired and unarmed — armed by any future
 * edit that moves the compile in, or by any executor/strategy refusal that ever
 * phrases itself the same way.
 *
 * ## The two defences, and which case pins which
 *
 * They are independent, and this file keeps them separable on purpose:
 *
 *   - **B (the criterion)** — an error carrying an ADR-0112 envelope (numeric
 *     `status` + non-empty `code`) is re-thrown untouched, whatever it says.
 *     Its producer already answered the classification question. Pinned by the
 *     cases whose message STILL matches the sniffer after C: the real
 *     `CUBE_NOT_FOUND` / 404 gate error (which says "…is not a registered
 *     object…") and the declared-5xx case.
 *   - **C (the sniffer)** — the postgres limb is anchored to postgres's actual
 *     wording instead of "any sentence with both words", so the compiler
 *     refusal no longer matches it even stripped of its envelope. Pinned by the
 *     BARE compiler-wording case.
 *
 * The compiler refusal itself is therefore covered TWICE — by B because #5963
 * gave it `DATASET_INVALID` / 400, and by C because the anchor no longer reads
 * "relationship" as "relation". Both are asserted, and the pair is the reason
 * the mine is disarmed rather than merely stepped around.
 *
 * ## What deliberately did NOT change
 *
 * #5033's semantics, verbatim: a BARE driver error is still classified by its
 * words and still degrades to `{rows: [], fields: [], totals: []}` + a `warn`
 * (`no such table`, postgres's real `relation "x" does not exist`), and a bare
 * error naming a JOINED table still fails loudly as a cross-datasource dataset.
 * The compile point also stays OUTSIDE the try — see the PR for the
 * measurement: moving it in would newly expose the compiler's own bare
 * invariants and the host-supplied relationship resolver to the degradation
 * path, which widens leniency in the opposite direction from this fix.
 *
 * ## Reverse verification — direction predicted BEFORE running
 *
 * Ordinary direction (red), but SPLIT, and the split is the point: reverting
 * one defence leaves the other holding the compiler case, so "revert the fix
 * and watch it all go red" would be a false expectation here.
 *
 *   - revert **B** only (drop the `hasDeclaredErrorEnvelope` branch):
 *     `CUBE_NOT_FOUND` and declared-5xx go RED (both degrade to an empty
 *     result); both compiler cases stay GREEN — C alone still saves them.
 *   - revert **C** only (restore `includes('relation') && includes('does not
 *     exist')`): the BARE compiler case goes RED; the enveloped one stays
 *     GREEN — B alone still saves it.
 *   - revert BOTH: all four go RED.
 *
 * MEASURED, one revert at a time, on this file (11 cases):
 *   B only reverted → **2 red / 9 green** — `CUBE_NOT_FOUND`, declared-5xx.
 *   C only reverted → **1 red / 10 green** — the bare compiler wording.
 *   both reverted   → **4 red / 7 green** — those three plus the ENVELOPED
 *   compiler wording, the mine itself, which is the one case that needs BOTH
 *   defences gone before it fires. (This line predicted "3" first: the union of
 *   the two single-revert sets is 3, and the mine is the fourth — it is exactly
 *   the case neither single revert can reach. The prediction is left corrected
 *   rather than quietly fixed, because that fourth row IS the finding.)
 *
 * The #5033 cases are green in every one of those four states, which is what
 * "the deliberate leniency is untouched" means as evidence rather than as a
 * claim.
 */

import { describe, it, expect, vi } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';
import { compileDataset } from '../dataset-compiler.js';

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
  include: ['account'],
  dimensions: [{ name: 'region', field: 'account.region', type: 'string' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
});

const SELECTION = { dimensions: ['region'], measures: ['revenue'] };
const CTX = { tenantId: 'org_A' } as ExecutionContext;

function logger() {
  return { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() } as any;
}

/**
 * A service whose execution throws `thrown` — the only way into the catch under
 * test. `isRegisteredObject` answers true so the #5033 cross-datasource triage
 * behaves as it does in a real kernel.
 */
function serviceThatThrows(thrown: unknown, log = logger()) {
  return new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async () => { throw thrown; },
    isRegisteredObject: () => true,
    logger: log,
  });
}

async function refusalFrom(thunk: () => unknown | Promise<unknown>): Promise<Refusal | undefined> {
  try {
    await thunk();
    return undefined;
  } catch (e) {
    return e as Refusal;
  }
}

// ── the real producers, captured rather than re-typed ────────────────────────

/**
 * `dataset-compiler.ts`'s resolveHop refusal — the exact error object the real
 * producer builds, wording and `DATASET_INVALID` / 400 envelope included. Its
 * throw site is outside `queryDataset`'s try today; re-throwing it from INSIDE
 * the try is precisely the "what if the compile moved in" question the mine
 * poses, asked without moving anything.
 */
async function compilerRelationshipRefusal(): Promise<Refusal> {
  const err = await refusalFrom(() =>
    compileDataset(
      DatasetSchema.parse({
        name: 'sales',
        label: 'Sales',
        object: 'opportunity',
        include: ['bogus'],
        dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
        measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
      }),
      () => undefined,
    ),
  );
  if (!err) throw new Error('the compiler accepted an unresolvable relationship — fixture is stale');
  return err;
}

/**
 * `analytics-service.ts`'s own `assertInferableCube` gate (#3867) —
 * `CUBE_NOT_FOUND` / 404, and its message ends "…and it is not a registered
 * object either…", which matches the sniffer's framework limb VERBATIM. Same
 * shape of luck as the compiler refusal: on the dataset path `queryDataset`
 * registers the compiled cube before executing, so this gate is not reachable
 * there today. It is the case that isolates B, because no narrowing of the
 * postgres limb can save it.
 */
async function cubeNotFoundRefusal(): Promise<Refusal> {
  const svc = new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async () => [],
    isRegisteredObject: () => false,
    logger: logger(),
  });
  const err = await refusalFrom(() => svc.query({ cube: 'ghost', measures: ['count'] }));
  if (!err) throw new Error('the cube-existence gate accepted an unregistered name — fixture is stale');
  return err;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('[#5717] an error that declares an ADR-0112 envelope is never degraded to an empty result', () => {
  it('the fixtures are the real producers, and both still match the sniffer’s framework limb', async () => {
    // Guards the two captures above against silently becoming vacuous — the
    // #5046 lesson: a case that passes because nothing is produced.
    const compilerErr = await compilerRelationshipRefusal();
    expect(compilerErr.message).toMatch(/includes relationship "bogus" which does not exist on object "opportunity"/);
    expect(compilerErr.code).toBe('DATASET_INVALID');
    expect(compilerErr.status).toBe(400);

    const cubeErr = await cubeNotFoundRefusal();
    expect(cubeErr.message).toMatch(/is not a registered object/);
    expect(cubeErr.code).toBe('CUBE_NOT_FOUND');
    expect(cubeErr.status).toBe(404);
  });

  it('CUBE_NOT_FOUND / 404 propagates — the case that no message narrowing can save', async () => {
    // Isolates defence B: "…is not a registered object either…" is a verbatim
    // sniffer hit before AND after the postgres limb was anchored, so only the
    // envelope check keeps a 404 from rendering as "no data".
    const log = logger();
    const refusal = await cubeNotFoundRefusal();
    const err = await refusalFrom(() =>
      serviceThatThrows(refusal, log).queryDataset(dataset, SELECTION, CTX),
    );
    expect(err, 'a 404 was swallowed into an empty grid').toBeInstanceOf(Error);
    expect(err?.code).toBe('CUBE_NOT_FOUND');
    expect(err?.status).toBe(404);
    // Not degraded ⇒ not warned about as an absent backing object either.
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('returning an empty result'));
  });

  it('a DECLARED 5xx propagates too — the envelope, not its range, is the criterion', async () => {
    // A declared server fault (`read-scope-sql.ts`'s family — an RLS lowering
    // that failed closed) is if anything worse to swallow than a 400: the
    // widget would render a confident empty chart for a fault nobody is told
    // about. The WORDING here is synthesised, deliberately: the rule under test
    // is "the producer classified it", so the case must carry a message the
    // sniffer would otherwise take (`unknown object`), which today's ten real
    // read-scope messages do not.
    const declared = Object.assign(
      new Error('[read-scope-sql] read scope references unknown object "crm_account" (fail-closed).'),
      { code: 'READ_SCOPE_COMPILE_FAILED', status: 500 },
    );
    const err = await refusalFrom(() => serviceThatThrows(declared).queryDataset(dataset, SELECTION, CTX));
    expect(err?.code).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(err?.status).toBe(500);
  });

  it('the compiler’s relationship refusal is not swallowed — the mine, disarmed', async () => {
    // The direct assertion #5717 asks for: the exact refusal, thrown from
    // INSIDE the try (which is what moving the compile point would do), reaches
    // the caller with its 400 envelope intact instead of becoming an empty grid.
    const refusal = await compilerRelationshipRefusal();
    const log = logger();
    const err = await refusalFrom(() =>
      serviceThatThrows(refusal, log).queryDataset(dataset, SELECTION, CTX),
    );
    expect(err, 'the mine went off — a 400 refusal became an empty result').toBeInstanceOf(Error);
    expect(err?.code).toBe('DATASET_INVALID');
    expect(err?.status).toBe(400);
    expect(String(err?.message)).toMatch(/includes relationship "bogus" which does not exist/);
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('returning an empty result'));
  });

  it('…and stays unswallowed with the envelope STRIPPED — defence C, standing alone', async () => {
    // The same wording as a bare `Error`: what this refusal was before #5963,
    // and what any future re-worded refusal looks like. Nothing here declares
    // anything, so only the anchored postgres limb can tell it apart from a
    // driver reporting a missing table — and it does: "relationship" is not
    // `relation "x"`, and the missing thing is a RELATIONSHIP, not a table.
    const refusal = await compilerRelationshipRefusal();
    const err = await refusalFrom(() =>
      serviceThatThrows(new Error(refusal.message)).queryDataset(dataset, SELECTION, CTX),
    );
    expect(err, 'a bare refusal with the compiler wording was still swallowed').toBeInstanceOf(Error);
    expect(String(err?.message)).toMatch(/includes relationship "bogus" which does not exist/);
    // Bare ⇒ nothing to classify it with; it must arrive unclassified, not
    // wearing an envelope this layer invented for it.
    expect(err?.code).toBeUndefined();
    expect(err?.status).toBeUndefined();
  });

  it('an enveloped 400 whose message says nothing driver-ish propagates as it always did', async () => {
    // The neighbour a character away: this one never matched the sniffer, so it
    // propagated before this change too. It is here so the block is not read as
    // "only sniffer-matching refusals are protected" — the criterion is the
    // envelope, and the guarantee is now independent of what the message says.
    const { datasetInvalidError } = await import('../dataset-refusal.js');
    const err = await refusalFrom(() =>
      serviceThatThrows(datasetInvalidError('[dataset-executor] compareTo needs a dated window to shift.'))
        .queryDataset(dataset, SELECTION, CTX),
    );
    expect(err?.code).toBe('DATASET_INVALID');
    expect(err?.status).toBe(400);
  });
});

describe('[#5717] #5033’s deliberate leniency for BARE driver errors is untouched', () => {
  it('sqlite/libsql "no such table" still degrades to an empty result, with the warn', async () => {
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

  it('postgres’s REAL wording still degrades — the anchor keeps the limb it was written for', async () => {
    const result = await serviceThatThrows(
      new Error('select "region" from "opportunity" - relation "opportunity" does not exist'),
    ).queryDataset(dataset, SELECTION, CTX);
    expect(result).toEqual(EMPTY);
  });

  it('mysql’s "doesn’t exist" still degrades', async () => {
    const result = await serviceThatThrows(
      new Error("Table 'app.opportunity' doesn't exist"),
    ).queryDataset(dataset, SELECTION, CTX);
    expect(result).toEqual(EMPTY);
  });

  it('a bare missing JOINED table still fails loudly as a cross-datasource dataset (#5033)', async () => {
    // The louder half of #5033: the base table resolved, a JOINED one did not,
    // and the joined object IS registered — a topology error, never "no data".
    // Regression guard that the new envelope branch did not short-circuit past it.
    const err = await refusalFrom(() =>
      serviceThatThrows(new Error('no such table: account')).queryDataset(dataset, SELECTION, CTX),
    );
    expect(String(err?.message)).toMatch(/cannot be executed as one statement/);
    expect(String(err?.message)).toMatch(/A dataset JOIN cannot cross datasources/);
  });

  it('a bare non-missing-source error still surfaces (real query bugs are not hidden)', async () => {
    const err = await refusalFrom(() =>
      serviceThatThrows(new Error('syntax error near "FROM"')).queryDataset(dataset, SELECTION, CTX),
    );
    expect(String(err?.message)).toMatch(/syntax error/);
  });
});

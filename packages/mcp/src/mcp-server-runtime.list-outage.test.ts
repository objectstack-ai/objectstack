// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6504, ADR-0110 D3 — MCP side, plural read] A metadata plane that could not
 * be fully READ is not an environment that declares fewer things.
 *
 * ---------------------------------------------------------------------------
 * The defect
 * ---------------------------------------------------------------------------
 * `MetadataManager` has computed a `degraded` verdict for every `list()` since
 * #5184 and spent it entirely on a cache TTL. The two consumers in this file
 * therefore read a short array during a loader outage with no way to ask why it
 * was short — the plural instance of the #5840 / PR #6051 shape #6055 closed on
 * the singular read.
 *
 * The two are NOT the same case, and PR #6051's discipline is to classify each
 * consumer rather than apply one rule, so they are pinned separately:
 *
 *   - `objectstack://objects` **MIS-DESCRIBES**. It renders the listing as
 *     `{ objects, totalCount }`, and during an outage `totalCount` is a
 *     positive, numeric claim that is simply false. This is the surface where a
 *     count is the strongest thing a read can wrongly say, and the fix withholds
 *     the count while still serving the objects.
 *   - the `agent_prompt` sibling **skill bridge** produces a SNAPSHOT. It
 *     publishes no count and makes no completeness claim to any client; a
 *     degraded read costs it silently-unregistered prompts. There is nobody on
 *     the wire to tell, so the verdict goes to the operator at `warn`.
 *
 * ---------------------------------------------------------------------------
 * Why these doubles, and where the REAL loader failure is pinned
 * ---------------------------------------------------------------------------
 * Stated plainly rather than papered over. `packages/mcp` depends on
 * `@objectstack/spec`, `core`, `types` and `formula` — deliberately NOT on
 * `@objectstack/metadata` — so a real `MetadataManager` over a broken
 * `DatabaseLoader` cannot be constructed here, and adding that dependency to
 * drive a test would be a larger architectural change than the fix.
 *
 * The real failure is therefore driven where the loader actually lives:
 * `packages/metadata/src/metadata-manager-list-diagnosed.test.ts` fails a
 * `DatabaseLoader`'s driver for real, so `readListUncached()`'s `catch` is what
 * produces `degraded`, and asserts the exact record shape the doubles below
 * return. This file pins the other half of that chain — what each consumer DOES
 * with such a record — which is the same split #6055 used for `getDiagnosed`.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Ordinary red, taken on this consumer. These doubles feed `listDiagnosed`'s
 * return contract directly, so reverting the producer cannot move this file —
 * only restoring the pre-#6504 reads here can.
 *
 * The reversion is defined **behaviourally, not textually**: the degraded
 * branch of `buildObjectListResource` is removed so it answers
 * `{ objects, totalCount }` unconditionally, and the skill bridge's
 * incompleteness `warn` is removed. The extraction of the builder is kept.
 * Reverting the whole FILE to `origin/main` instead would delete the builder's
 * export, fail the import, and turn all eleven cases red — a result that
 * measures the extraction rather than the decision, and so proves nothing about
 * either.
 *
 * Predicted, written down before running: **5 red / 6 green**.
 *
 * The six predicted GREEN are invariant pins rather than gaps, and each is
 * green in BOTH directions on purpose:
 *   - the two HEALTHY cases (resource + skill bridge) — this fix deliberately
 *     leaves the healthy answer byte-identical, so a red there would report a
 *     regression, not the fix;
 *   - *"a degraded listing still serves the objects it could read"* — the
 *     pre-fix code served them too. It is what would go red if a future change
 *     here started withholding data instead of withholding the claim;
 *   - *"the readable skills are still bridged"* — same shape, on the snapshot;
 *   - the two *"a service without listDiagnosed"* cases — the optional-member
 *     fallback, which by construction resolves to the pre-fix behaviour.
 * The measured result is recorded in the PR body as it came out.
 *
 * The doubles declare metadata reads only — no engine write verb — so there is
 * no `delete`/`update` dispatch for `check:engine-double-contract` to scan and
 * no guard to hand-mirror.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IMetadataService, Logger } from '@objectstack/spec/contracts';
import { MCPServerRuntime, buildObjectListResource } from './mcp-server-runtime.js';

type AnyRecord = Record<string, any>;

/**
 * A logger double that is BOTH a real `Logger` and a set of vitest mocks.
 *
 * Typed rather than left as a bare record on purpose: this package's tsconfig
 * excludes `*.test.ts`, so `pnpm typecheck` never reads this file and only the
 * TEST_DEBT ratchet does. An untyped double compiles to eight TS2345s that the
 * ledger's surplus would have absorbed in silence — which is the exact shape
 * #6376 exists to stop.
 */
type MockLogger = Logger & {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

const LOADER_FAILURE = 'database: connect ECONNREFUSED 10.0.0.5:5432';

/** What the loader that IS reachable holds — one object, one skill. */
const REACHABLE_OBJECT = { name: 'acct', label: 'Account', fields: { title: { type: 'text' } } };
const REACHABLE_SKILL = {
  name: 'case_management',
  label: 'Case Management',
  instructions: 'Handle the support case lifecycle.',
};

function makeLogger(): MockLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as MockLogger;
}

/** Everything logged at `warn`, joined — the snapshot cases read this. */
const warnLines = (logger: MockLogger): string =>
  logger.warn.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');

/**
 * Build a metadata-service double.
 *
 * Every REQUIRED member of `IMetadataService` is present and throws, so a code
 * path that reaches one this fix should not touch fails loudly instead of
 * resolving an empty array and looking like the very shortness under test.
 */
function makeService(overrides: AnyRecord): IMetadataService {
  const unexpected = (member: string) => async (): Promise<never> => {
    throw new Error(`double: ${member}() should not be called by this surface`);
  };
  return {
    register: unexpected('register'),
    get: unexpected('get'),
    list: unexpected('list'),
    unregister: unexpected('unregister'),
    exists: unexpected('exists'),
    listNames: unexpected('listNames'),
    getObject: unexpected('getObject'),
    listObjects: unexpected('listObjects'),
    ...overrides,
  } as unknown as IMetadataService;
}

/**
 * One loader is down: the reachable ones answered, so `items` is a real
 * best-effort set and `degraded` says it is short. This is the record
 * `MetadataManager.listDiagnosed()` returns from a live `ECONNREFUSED`, pinned
 * in the metadata package.
 */
const listInOutage = (items: unknown[]) =>
  makeService({
    listObjects: vi.fn(async () => items),
    list: vi.fn(async () => items),
    listDiagnosed: vi.fn(async () => ({ items, degraded: true, errors: [LOADER_FAILURE] })),
  });

/** Every loader answered — the same items, and nothing degraded. */
const listComplete = (items: unknown[]) =>
  makeService({
    listObjects: vi.fn(async () => items),
    list: vi.fn(async () => items),
    listDiagnosed: vi.fn(async () => ({ items, degraded: false, errors: [] })),
  });

/** A service predating #6504: no `listDiagnosed` to probe. */
const listUndiagnosable = (items: unknown[]) =>
  makeService({
    listObjects: vi.fn(async () => items),
    list: vi.fn(async () => items),
  });

/** The parsed JSON body of the one-content resource answer. */
const bodyOf = async (result: { contents: Array<{ text: string }> }): Promise<AnyRecord> =>
  JSON.parse(result.contents[0]!.text) as AnyRecord;

describe('#6504 — `objectstack://objects` MIS-DESCRIBES: the count is withheld, the objects are not', () => {
  it('HEALTHY: `totalCount` is served exactly as before', async () => {
    const body = await bodyOf(
      await buildObjectListResource(listComplete([REACHABLE_OBJECT]), makeLogger()),
    );

    expect(body.totalCount).toBe(1);
    expect(body.objects).toHaveLength(1);
    expect(body.objects[0].name).toBe('acct');
    // No degradation vocabulary on a complete read.
    expect(body.partial).toBeUndefined();
    expect(body.code).toBeUndefined();
  });

  it('DEGRADED: the count claim is ABSENT — a client asking for a total gets nothing, not a wrong number', async () => {
    const body = await bodyOf(
      await buildObjectListResource(listInOutage([REACHABLE_OBJECT]), makeLogger()),
    );

    // The whole point. Before #6504 this said `totalCount: 1` about an
    // environment that declares more, and a machine consumer believed it.
    expect(body.totalCount).toBeUndefined();
    expect('totalCount' in body).toBe(false);

    // What replaces it says only what is known, in a name that cannot be read
    // as a total.
    expect(body.partial).toBe(true);
    expect(body.returnedCount).toBe(1);
  });

  it('DEGRADED: carries the ADR-0112-shaped envelope the sibling resource already uses', async () => {
    const body = await bodyOf(
      await buildObjectListResource(listInOutage([REACHABLE_OBJECT]), makeLogger()),
    );

    expect(body.code).toBe('SERVICE_UNAVAILABLE');
    expect(body.status).toBe(503);
    // The prose states the DIRECTION of the error — a floor, never an exact
    // number — and does not describe the listing as complete.
    expect(body.warning).toMatch(/INCOMPLETE/);
    expect(body.warning).toMatch(/at least/i);
    expect(body.warning).not.toMatch(/not found/i);
  });

  it('the two answers are not equal — which is the fact the defect WAS', async () => {
    const outage = await bodyOf(
      await buildObjectListResource(listInOutage([REACHABLE_OBJECT]), makeLogger()),
    );
    const complete = await bodyOf(
      await buildObjectListResource(listComplete([REACHABLE_OBJECT]), makeLogger()),
    );

    // Same objects, same length — so nothing but the completeness claim moved,
    // and yet the two bodies are now distinguishable.
    expect(outage.objects).toEqual(complete.objects);
    expect(outage).not.toEqual(complete);
  });

  it('DEGRADED: still serves the objects it could read — this is a diagnosis fix, not a withholding one', async () => {
    const body = await bodyOf(
      await buildObjectListResource(listInOutage([REACHABLE_OBJECT]), makeLogger()),
    );

    // Kept deliberately free of any degradation assertion: this case pins the
    // AFFORDANCE, which the pre-#6504 code had too. It cannot go red on this
    // fix's reversion, and it is what would go red if a future change here
    // started withholding data instead of withholding the claim.
    expect(body.objects).toHaveLength(1);
    expect(body.objects[0].name).toBe('acct');
  });

  it('DEGRADED: the operator is told once, naming the loader that was lost', async () => {
    const logger = makeLogger();
    await buildObjectListResource(listInOutage([REACHABLE_OBJECT]), logger);

    expect(warnLines(logger)).toMatch(/known-partial/);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][1].errors).toEqual([LOADER_FAILURE]);
  });

  it('a service without `listDiagnosed` behaves exactly as before — the member is optional', async () => {
    const logger = makeLogger();
    const body = await bodyOf(
      await buildObjectListResource(listUndiagnosable([REACHABLE_OBJECT]), logger),
    );

    // An implementation that cannot report the distinction reports nothing
    // degraded, which is precisely what it could express.
    expect(body.totalCount).toBe(1);
    expect(body.partial).toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('#6504 — the skill bridge is a SNAPSHOT: the verdict goes to the operator', () => {
  const bridgeSkills = async (service: IMetadataService, logger: MockLogger): Promise<void> => {
    const runtime = new MCPServerRuntime({ name: 'list-outage', version: '0.0.0', logger });
    await runtime.bridgePrompts(service);
  };

  it('DEGRADED: says the prompt list is incomplete, and that the skills are MISSING rather than undeclared', async () => {
    const logger = makeLogger();
    await bridgeSkills(listInOutage([REACHABLE_SKILL]), logger);

    const lines = warnLines(logger);
    expect(lines).toMatch(/INCOMPLETE/);
    expect(lines).toMatch(/missing, NOT undeclared/);
    // The consequence that makes it worth saying: the stdio snapshot outlives
    // the outage, so a healed loader does not fix the surface by itself.
    expect(lines).toMatch(/restarted/);
  });

  it('DEGRADED: the readable skills are still bridged — the short surface is served, not refused', async () => {
    const logger = makeLogger();
    await bridgeSkills(listInOutage([REACHABLE_SKILL]), logger);

    expect(logger.info.mock.calls.map((c: unknown[]) => String(c[0])).join('\n'))
      .toMatch(/Bridged 1 skill prompts/);
  });

  it('HEALTHY: no incompleteness is announced', async () => {
    const logger = makeLogger();
    await bridgeSkills(listComplete([REACHABLE_SKILL]), logger);

    expect(warnLines(logger)).not.toMatch(/INCOMPLETE/);
  });

  it('a service without `listDiagnosed` announces nothing either — same optionality', async () => {
    const logger = makeLogger();
    await bridgeSkills(listUndiagnosable([REACHABLE_SKILL]), logger);

    expect(warnLines(logger)).not.toMatch(/INCOMPLETE/);
  });
});

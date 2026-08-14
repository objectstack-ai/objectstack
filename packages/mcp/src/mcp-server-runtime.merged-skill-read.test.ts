// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8328] The skill prompt bridge reads the MERGED metadata listing, so a
 * runtime meta override reaches MCP prompts.
 *
 * ---------------------------------------------------------------------------
 * The defect
 * ---------------------------------------------------------------------------
 * `PUT /api/v1/meta/skill/<name>` with `{active:true}` returned 200 and the
 * flip never reached the prompt surface. The two surfaces read different
 * layers: the meta HTTP list goes through the protocol's `getMetaItems`, which
 * merges the `sys_metadata` overlay over the registry / MetadataService
 * baselines, while this bridge read `IMetadataService.list('skill')` — one
 * layer BELOW where any overlay merging happens. Same skill name, two answers.
 *
 * Measured on a booted showcase before the fix: `GET /api/v1/meta/skill`
 * served the overridden row and `[MCP] Bridged 0 skill prompts` was logged at
 * the same boot. The `active` flip is what makes the count binary — a row with
 * `active:false` is not projected at all (`projectSkillPrompt`) — so the
 * override's arrival is visible as 0 → 1 rather than as a body diff.
 *
 * ---------------------------------------------------------------------------
 * What this file pins, and what it deliberately does NOT
 * ---------------------------------------------------------------------------
 * It pins the LAYER the bridge reads from, and that #6504's completeness
 * verdict survives the layer change. It does not re-pin the projection rules
 * (`skill-prompts.test.ts` owns those) or the overlay merge itself
 * (`packages/metadata-protocol` owns that — `getMetaItems` is a double here).
 *
 * ⚠️ Scope, stated so a reader does not over-read a green file: this covers the
 * LONG-LIVED server's bridge, which is the stdio transport's prompt surface and
 * the half of #8328 that lives in this package. The HTTP surface at
 * `/api/v1/mcp` builds its bridge in `packages/runtime`
 * (`domains/mcp.ts` → `buildMcpBridge`), whose `listSkills` is a separate read
 * that this file cannot reach and that is NOT fixed by this change.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Ordinary red, on the consumer. The reversion is behavioural: `listSkills`
 * goes back to `diagnosedList(metadataService, 'skill')`, ignoring the merged
 * read. Predicted, written down before running: **6 red / 2 green**.
 *
 * The two predicted GREEN are invariant pins, green in both directions on
 * purpose:
 *   - *"no merged read: the bridge reads exactly as it did before"* — that case
 *     IS the pre-fix behaviour, so it must not move;
 *   - *"a degraded verdict still reaches the operator"* — the warn came from
 *     `listDiagnosed` before this change and still does. It would go red if a
 *     future change spent the #6504 contract while switching layers, which is
 *     the specific regression this fix had to avoid.
 * The measured result is recorded in the PR body as it came out.
 *
 * The doubles declare metadata reads only — no engine write verb — so there is
 * no `delete`/`update` dispatch for `check:engine-double-contract` to scan.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IMetadataService, Logger } from '@objectstack/spec/contracts';
import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { McpMergedMetadataRead } from './mcp-server-runtime.js';

type AnyRecord = Record<string, any>;

/** See the sibling outage suite: typed because the TEST_DEBT ratchet reads it. */
type MockLogger = Logger & {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

const makeLogger = (): MockLogger =>
  ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) as unknown as MockLogger;

const infoLines = (logger: MockLogger): string =>
  logger.info.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
const warnLines = (logger: MockLogger): string =>
  logger.warn.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');

const LOADER_FAILURE = 'database: connect ECONNREFUSED 10.0.0.5:5432';

/**
 * The packaged skill as the registry/loader layer holds it: authored inactive,
 * so it projects to NO prompt.
 */
const PACKAGED_SKILL = {
  name: 'case_management',
  label: 'Case Management',
  instructions: 'Handle the support case lifecycle.',
  active: false,
};

/**
 * The same skill as the protocol's merged read answers AFTER a runtime
 * `PUT /api/v1/meta/skill/case_management` with `{active:true}` — the overlay
 * row won its slot, so the row is now projectable.
 */
const OVERRIDDEN_SKILL = { ...PACKAGED_SKILL, active: true };

/**
 * Build a metadata-service double. Every required member throws, so a path that
 * reaches one this change should not touch fails loudly rather than resolving
 * an empty array and looking like the very absence under test.
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

/** A healthy service holding the packaged (inactive) row. */
const packagedService = (items: unknown[] = [PACKAGED_SKILL]) =>
  makeService({
    list: vi.fn(async () => items),
    listDiagnosed: vi.fn(async () => ({ items, degraded: false, errors: [] })),
  });

/** A service whose loader set is short — the #6504 verdict is `degraded`. */
const degradedService = (items: unknown[] = [PACKAGED_SKILL]) =>
  makeService({
    list: vi.fn(async () => items),
    listDiagnosed: vi.fn(async () => ({ items, degraded: true, errors: [LOADER_FAILURE] })),
  });

/** A service predating #6504: no `listDiagnosed` to probe. */
const undiagnosableService = (items: unknown[] = [PACKAGED_SKILL]) =>
  makeService({ list: vi.fn(async () => items) });

/** The protocol's merged listing, in its native `{ type, items }` envelope. */
const mergedRead = (items: unknown[]): McpMergedMetadataRead => ({
  getMetaItems: vi.fn(async ({ type }: { type: string }) => ({ type, items })),
});

const bridge = async (
  service: IMetadataService,
  logger: MockLogger,
  merged?: McpMergedMetadataRead,
): Promise<void> => {
  const runtime = new MCPServerRuntime({ name: 'merged-skill-read', version: '0.0.0', logger });
  await runtime.bridgePrompts(service, merged);
};

describe('#8328 — the skill read goes through the protocol\'s merged listing', () => {
  it('THE DEFECT: a runtime override that only the merged read can see reaches the prompt surface', async () => {
    const logger = makeLogger();
    // The registry/loader layer still holds `active:false`; only the merged
    // read carries the overlay's `active:true`. Before this fix the bridge read
    // the former and registered nothing.
    await bridge(packagedService(), logger, mergedRead([OVERRIDDEN_SKILL]));

    expect(infoLines(logger)).toMatch(/Bridged 1 skill prompts/);
  });

  it('the un-merged `list()` is not consulted for the items at all', async () => {
    const logger = makeLogger();
    const service = packagedService();
    await bridge(service, logger, mergedRead([OVERRIDDEN_SKILL]));

    // The layer switch is the whole fix: reading BOTH and preferring one would
    // leave the un-merged answer able to win a future edit by accident.
    expect(service.list).not.toHaveBeenCalled();
  });

  it('asks the merged read for the `skill` type specifically', async () => {
    const logger = makeLogger();
    const merged = mergedRead([OVERRIDDEN_SKILL]);
    await bridge(packagedService(), logger, merged);

    expect(merged.getMetaItems).toHaveBeenCalledWith({ type: 'skill' });
  });

  it('accepts a bare array from a host whose merged read is not enveloped', async () => {
    const logger = makeLogger();
    const merged = { getMetaItems: vi.fn(async () => [OVERRIDDEN_SKILL]) };
    await bridge(packagedService(), logger, merged);

    expect(infoLines(logger)).toMatch(/Bridged 1 skill prompts/);
  });

  it('an override that DEACTIVATES a packaged skill retires its prompt', async () => {
    const logger = makeLogger();
    // The mirror of the repro, and the case that proves the merged read is the
    // authority rather than merely an additional source: the registry says
    // active, the overlay says inactive, and the surface follows the overlay.
    const active = { ...PACKAGED_SKILL, active: true };
    await bridge(
      packagedService([active]),
      logger,
      mergedRead([{ ...active, active: false }]),
    );

    expect(infoLines(logger)).toMatch(/Bridged 0 skill prompts/);
  });

  it('a merged read that FAILS never falls back to the un-merged listing', async () => {
    const logger = makeLogger();
    const service = packagedService();
    const merged = {
      getMetaItems: vi.fn(async () => {
        throw new Error('sys_metadata unreadable');
      }),
    };
    await bridge(service, logger, merged);

    // Falling back would answer with registry rows in the shape of merged ones
    // — this defect, restored silently at exactly the moment an overlay is most
    // likely to be the thing being missed.
    expect(service.list).not.toHaveBeenCalled();
    expect(warnLines(logger)).toMatch(/Could not read skill metadata/);
    expect(infoLines(logger)).not.toMatch(/Bridged \d+ skill prompts/);
  });

  it('#6504 SURVIVES: a degraded verdict still reaches the operator through the merged read', async () => {
    const logger = makeLogger();
    // `getMetaItems` cannot express this — it swallows a MetadataService read
    // failure into its own catch — so the verdict is asked of `listDiagnosed`
    // alongside it. Losing this was the live risk of the layer change.
    await bridge(degradedService(), logger, mergedRead([OVERRIDDEN_SKILL]));

    const lines = warnLines(logger);
    expect(lines).toMatch(/INCOMPLETE/);
    expect(lines).toMatch(/missing, NOT undeclared/);
    expect(logger.warn.mock.calls[0]![1].errors).toEqual([LOADER_FAILURE]);
  });

  it('no merged read: the bridge reads exactly as it did before #8328', async () => {
    const logger = makeLogger();
    // A host assembled without the metadata protocol has no merged read to
    // give. `undefined` means "this host cannot merge", never "merging was
    // skipped", so the pre-#8328 read is the honest answer rather than a
    // regression — and a service predating #6504 keeps working too.
    const service = undiagnosableService([{ ...PACKAGED_SKILL, active: true }]);
    await bridge(service, logger, undefined);

    expect(service.list).toHaveBeenCalledWith('skill');
    expect(infoLines(logger)).toMatch(/Bridged 1 skill prompts/);
  });
});

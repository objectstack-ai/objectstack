// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17713 — `engine.registerHook` must not accept an engine lifecycle event the
 * engine never dispatches.
 *
 * ## The defect, as measured
 *
 * `registerHook(event, handler)` took `event: string`, warned when the name was
 * outside `DISPATCHABLE_HOOK_EVENTS`, and **registered the handler anyway**. A
 * downstream consumer registered read filters on `beforeFindOne` and
 * `beforeCount` expecting them to scope single-record reads and list totals.
 * They sat inert through every boot behind ~40 warning lines:
 *
 *   - `findOne` was still filtered — `beforeFind` covers it — so the author's
 *     mistake was harmless there and gave no signal;
 *   - `count` was NOT: a `limit`ed list returned a `total` counting rows the
 *     caller could not see;
 *   - `aggregate` was NOT: a `groupBy` was not narrowed at all.
 *
 * That is declared ≠ enforced on an authorable seam — ADR-0078's prohibited
 * fourth state (parsed, unmarked, silently inert) — and on THIS seam the inert
 * declaration is a guardrail the author believes they armed.
 *
 * ## Why the population is READ, not typed out
 *
 * The card's acceptance criterion is "a test per event name the engine exposes
 * but never dispatches". A hand-written list of those names would be the same
 * failure one layer up, so this file drives its population from
 * `HOOK_EVENT_DISPATCH_VOCABULARY`, which the engine derives as
 * (`before`|`after`) × `OperationContext['operation']` minus the dispatched
 * set. The literal six below is an anti-drift PIN on that derivation, not the
 * source the refusal tests iterate.
 *
 * ## What is deliberately still accepted
 *
 * A name OUTSIDE the engine's lifecycle namespace (`'myPlugin:flush'`) still
 * warns and still registers, because `triggerHooks` is public and a plugin
 * dispatching its own events is the legitimate reading #3195 recorded as the
 * reason not to reject. The preservation half is pinned here too: the refusal
 * narrows the accept set by six names, not down to eight.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectQL, HOOK_EVENT_DISPATCH_VOCABULARY } from './engine';
import type {
  EngineAggregateOptions,
  EngineCountOptions,
  EngineQueryOptions,
} from '@objectstack/spec/data';
import { SchemaRegistry } from './registry';

vi.mock('./registry', async () => {
  const { createRegistryModuleMock } = await import('./registry-module-mock.js');
  return createRegistryModuleMock();
});

const NOTE_SCHEMA = {
  name: 'note',
  fields: {
    title: { type: 'text' },
    owner: { type: 'text' },
  },
};

function makeDriver() {
  return {
    name: 'memory',
    supports: {},
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    find: vi.fn(async () => [{ id: 'n1', title: 't', owner: 'me' }]),
    findOne: vi.fn(async () => ({ id: 'n1', title: 't', owner: 'me' })),
    count: vi.fn(async () => 7),
    aggregate: vi.fn(async () => [{ owner: 'me', c: 7 }]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as any;
}

async function makeEngine() {
  vi.mocked((SchemaRegistry as any).getObject).mockImplementation((name: string) =>
    name === 'note' ? NOTE_SCHEMA : undefined,
  );
  const ql = new ObjectQL();
  ql.registerDriver(makeDriver(), true);
  await ql.init();
  return ql;
}

const { dispatchable, lifecycleNamespace, undispatchedLifecycle } = HOOK_EVENT_DISPATCH_VOCABULARY;

describe('[#17713] the registerHook accept set vs the engine dispatch set', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('the population, derived from the engine', () => {
    it('is the set difference — namespace minus dispatched — and is not empty', () => {
      // Derivation, re-run here rather than trusted: if the engine ever computed
      // `undispatchedLifecycle` some other way this fails, and an empty
      // population (which would make every refusal test below vacuous) fails
      // loudly rather than passing silently.
      const derived = [...lifecycleNamespace].filter((e) => !dispatchable.has(e)).sort();
      expect([...undispatchedLifecycle].sort()).toEqual(derived);
      expect(derived.length).toBeGreaterThan(0);
    });

    it('is exactly the six names #17713 measured (anti-drift pin)', () => {
      expect([...undispatchedLifecycle].sort()).toEqual([
        'afterAggregate',
        'afterCount',
        'afterFindOne',
        'beforeAggregate',
        'beforeCount',
        'beforeFindOne',
      ]);
    });

    it('the namespace is before/after × the seven engine operation verbs', () => {
      expect(lifecycleNamespace.size).toBe(14);
      expect(dispatchable.size).toBe(8);
    });
  });

  describe('every undispatched lifecycle name is refused at registration', () => {
    // The card's acceptance criterion, driven from the population above so a
    // new verb cannot add an untested name.
    for (const event of [...undispatchedLifecycle].sort()) {
      it(`refuses '${event}' and registers nothing`, async () => {
        const ql = await makeEngine();
        const handler = vi.fn();
        expect(() => ql.registerHook(event, handler, { object: 'note' })).toThrow(
          /never dispatches/,
        );
        expect((ql as any).hooks.has(event)).toBe(false);
        expect(handler).not.toHaveBeenCalled();
      });
    }
  });

  describe('the refusal names the repair, and the two seams differ', () => {
    it("*FindOne is told that beforeFind/afterFind already cover findOne", async () => {
      const ql = await makeEngine();
      expect(() => ql.registerHook('beforeFindOne', vi.fn(), { object: 'note' })).toThrow(
        /`beforeFind` already covers `findOne`/,
      );
      expect(() => ql.registerHook('afterFindOne', vi.fn(), { object: 'note' })).toThrow(
        /`afterFind` already covers `findOne`/,
      );
    });

    it('*Count / *Aggregate are sent to registerMiddleware, not to another event', async () => {
      const ql = await makeEngine();
      for (const event of ['beforeCount', 'afterCount', 'beforeAggregate', 'afterAggregate']) {
        let message = '';
        try {
          ql.registerHook(event, vi.fn(), { object: 'note' });
        } catch (e) {
          message = (e as Error).message;
        }
        expect(message).toContain('registerMiddleware');
        expect(message).toContain("ctx.operation === 'count' | 'aggregate'");
        // The consequence, spelled out where the author is reading: this is the
        // half that would have saved the #17713 consumer.
        expect(message).toContain('does not narrow a `total` or a `groupBy`');
      }
      expect(() => ql.registerHook('beforeCount', vi.fn(), { object: 'note' })).toThrow(
        /`count\(\)` dispatches no hook at all/,
      );
      expect(() => ql.registerHook('beforeAggregate', vi.fn(), { object: 'note' })).toThrow(
        /`aggregate\(\)` dispatches no hook at all/,
      );
    });
  });

  describe('the behaviour the refusal replaces', () => {
    /**
     * The pin that goes RED without the fix. On `origin/main` the registration
     * succeeds (warn only), so the `toThrow` fails while the second half — the
     * handler never running — passes: that pair IS "declared ≠ enforced".
     */
    it('a `beforeCount` registration cannot survive to be inert across count()', async () => {
      const ql = await makeEngine();
      const calls: string[] = [];
      expect(() =>
        ql.registerHook('beforeCount', () => {
          calls.push('beforeCount');
        }, { object: 'note' }),
      ).toThrow(/never dispatches/);

      // And the reason the throw is the repair rather than a nuisance: had the
      // registration stood, `count()` would never have reached the handler.
      const countQuery: EngineCountOptions = {};
      await expect(ql.count('note', countQuery)).resolves.toBe(7);
      expect(calls).toEqual([]);
    });

    it('a `beforeAggregate` registration cannot survive to be inert across aggregate()', async () => {
      const ql = await makeEngine();
      const calls: string[] = [];
      expect(() =>
        ql.registerHook('beforeAggregate', () => {
          calls.push('beforeAggregate');
        }, { object: 'note' }),
      ).toThrow(/never dispatches/);

      const aggregateQuery: EngineAggregateOptions = {
        groupBy: ['owner'],
        aggregations: [{ function: 'count', alias: 'c' }],
      };
      await ql.aggregate('note', aggregateQuery);
      expect(calls).toEqual([]);
    });

    it('the prescribed repair for *FindOne actually works — beforeFind fires for findOne', async () => {
      const ql = await makeEngine();
      const seen: string[] = [];
      ql.registerHook('beforeFind', (ctx: any) => {
        seen.push(ctx.event ?? 'beforeFind');
      }, { object: 'note' });

      const findOneQuery: EngineQueryOptions = { where: { id: 'n1' } };
      await ql.findOne('note', findOneQuery);
      expect(seen).toHaveLength(1);
    });
  });

  describe('what the refusal deliberately leaves alone', () => {
    it('every dispatchable event registers without throwing and without a warning', async () => {
      const ql = await makeEngine();
      const warn = vi.spyOn((ql as any).logger, 'warn');
      for (const event of dispatchable) {
        expect(() => ql.registerHook(event, vi.fn(), { object: 'note' })).not.toThrow();
        expect((ql as any).hooks.get(event)).toHaveLength(1);
      }
      const warnedAboutDispatch = warn.mock.calls.some((c) =>
        String(c[0]).includes('never dispatches'),
      );
      expect(warnedAboutDispatch).toBe(false);
    });

    it('a custom event outside the namespace still warns, still registers, and still dispatches', async () => {
      const ql = await makeEngine();
      const warn = vi.spyOn((ql as any).logger, 'warn');
      const handler = vi.fn();

      expect(() => ql.registerHook('myPlugin:flush', handler, { object: 'note' })).not.toThrow();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("'myPlugin:flush'"),
        expect.objectContaining({ event: 'myPlugin:flush' }),
      );

      // The reading #3195 recorded, kept alive: a plugin that dispatches its own
      // event through the public `triggerHooks` still reaches its handler.
      await ql.triggerHooks('myPlugin:flush', { object: 'note', event: 'myPlugin:flush', input: {} } as any);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('a near-miss that is NOT an engine verb is a custom event, not a refusal', async () => {
      const ql = await makeEngine();
      // `archive` is not on `OperationContext['operation']`, so `beforeArchive`
      // carries no claim about the engine's own vocabulary.
      expect(() => ql.registerHook('beforeArchive', vi.fn(), { object: 'note' })).not.toThrow();
      expect((ql as any).hooks.get('beforeArchive')).toHaveLength(1);
    });
  });
});

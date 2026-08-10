// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5928] The hook registration contract can express "global, EXCEPT these
 * objects".
 *
 * ## What was missing
 *
 * `registerHook` options carried one scope face: `object`, an ALLOW list (absent
 * = global, `'*'` = every object). An allow list and a deny list are
 * interchangeable only over a CLOSED universe of object names, and this one is
 * open — `applyObjectRegistryMutation` registers new objects into a running
 * engine on a successful `/meta` PUT, and `SchemaRegistry.registerObject` emits
 * no event a plugin could subscribe to. So a registrant that wanted "everything
 * except these twenty platform tables" had exactly two options, both wrong:
 *
 *  - keep the knowledge inside the handler as an early return, which leaves the
 *    registration GLOBAL — so the #5038 / #5284 per-object gates, which read the
 *    registration face, answer "yes, hooks apply" for objects the handler is
 *    about to skip, and the bulk-write path pays for a row-set read nobody uses;
 *  - enumerate the complement into `object`, which freezes the list at boot —
 *    the "probe D" scenario below, where an object created afterwards is
 *    silently NOT covered. For the audit plugin that is a compliance regression
 *    that reports nothing.
 *
 * `excludeObjects` is the third option: the deny half, declared on the
 * registration where the engine reads it.
 *
 * ## What these tests pin
 *
 *  1. the matching matrix — allow face × exclusion face, both spellings;
 *  2. probe D — under an exclusion face, an object nobody enumerated is covered
 *     BY DEFAULT, which is the whole reason this shape was chosen over
 *     enumerating the complement;
 *  3. the two refused EXCLUSION shapes (`''`/`['']`, `'*'`), following #4281's
 *     ruling on empty hook targets, plus the `[]` that is deliberately accepted
 *     on that face;
 *  3b. [#6573] the refused ALLOW shapes — `''`, `[]`, `['']` — and the scope
 *     whose two faces cancel out. #4281 closed these on the metadata path only;
 *     `registerHook` is the code path it never reached. Refused at the door,
 *     with `hookMatchesObject`'s reading left deliberately unchanged;
 *  4. **the property**: the `hasHooksFor` gate is never TIGHTER than the
 *     `triggerHooks` dispatch. Both now call one `hookMatchesObject`, so this is
 *     structurally true today — the test is what keeps it true, and it asserts
 *     the implication rather than an equality because the gate is allowed to be
 *     looser (it deliberately ignores `skipAutomations`).
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL, hookMatchesObject, type HookEntry } from './engine.js';

const EVENT = 'afterUpdate';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeEngine() {
  return new ObjectQL({ logger: makeLogger() });
}

/** Dispatch `EVENT` for `object` and report which handler names ran. */
async function dispatch(engine: ObjectQL, object: string): Promise<string[]> {
  const fired: string[] = [];
  (engine as any)._firedSink = fired;
  await engine.triggerHooks(EVENT, { object, event: EVENT, input: {} } as any);
  return fired;
}

/** Register a handler that records `name` into the engine's dispatch sink. */
function register(
  engine: ObjectQL,
  name: string,
  options: { object?: string | string[]; excludeObjects?: string | string[] },
) {
  engine.registerHook(
    EVENT,
    () => {
      ((engine as any)._firedSink as string[]).push(name);
    },
    options,
  );
}

const gateOpen = (engine: ObjectQL, object: string): boolean =>
  (engine as any).hasHooksFor(EVENT, object);

describe('[#5928] hook `excludeObjects` — matching semantics', () => {
  it('global minus a list: fires on unlisted objects, not on excluded ones', async () => {
    const engine = makeEngine();
    register(engine, 'audit', { excludeObjects: ['sys_audit_log', 'sys_job'] });

    expect(await dispatch(engine, 'account')).toEqual(['audit']);
    expect(await dispatch(engine, 'sys_audit_log')).toEqual([]);
    expect(await dispatch(engine, 'sys_job')).toEqual([]);
  });

  it('explicit wildcard minus a list behaves the same as the implicit global', async () => {
    const engine = makeEngine();
    register(engine, 'starred', { object: '*', excludeObjects: ['sys_audit_log'] });

    expect(await dispatch(engine, 'account')).toEqual(['starred']);
    expect(await dispatch(engine, 'sys_audit_log')).toEqual([]);
  });

  it('subtracts from a finite allow list too, not only from the global set', async () => {
    const engine = makeEngine();
    register(engine, 'pair', {
      object: ['account', 'contact'],
      excludeObjects: ['contact'],
    });

    expect(await dispatch(engine, 'account')).toEqual(['pair']);
    expect(await dispatch(engine, 'contact')).toEqual([]);
    // Outside the allow list: the allow face already refused it.
    expect(await dispatch(engine, 'lead')).toEqual([]);
  });

  it('accepts the bare-string spelling on both faces', async () => {
    const engine = makeEngine();
    register(engine, 'single', { object: '*', excludeObjects: 'sys_audit_log' });

    expect(await dispatch(engine, 'account')).toEqual(['single']);
    expect(await dispatch(engine, 'sys_audit_log')).toEqual([]);
  });

  it('leaves the pre-existing allow-only registrations untouched', async () => {
    const engine = makeEngine();
    register(engine, 'global', {});
    register(engine, 'allowOne', { object: 'account' });
    register(engine, 'allowMany', { object: ['account', 'contact'] });
    register(engine, 'wildcard', { object: '*' });

    expect((await dispatch(engine, 'account')).sort())
      .toEqual(['allowMany', 'allowOne', 'global', 'wildcard']);
    expect((await dispatch(engine, 'lead')).sort()).toEqual(['global', 'wildcard']);
  });

  it('`excludeObjects: []` is a no-op — the honest spelling of "subtract nothing"', async () => {
    const engine = makeEngine();
    register(engine, 'spread', { excludeObjects: [] });

    // The natural value of `excludeObjects: [...SKIP_OBJECTS]` when the source
    // list is empty. Nothing transforms it, so it means what it says — unlike
    // #4281's `object: []`, which the binder widened into the wildcard.
    expect(await dispatch(engine, 'account')).toEqual(['spread']);
    expect(await dispatch(engine, 'sys_audit_log')).toEqual(['spread']);
  });
});

describe('[#5928] probe D — an object registered after the hook was', () => {
  /*
   * The decisive comparison. `late_object` stands for an object a `/meta` PUT
   * registers into a live engine after the plugin's `init()` ran — the case that
   * ruled out enumerating the complement.
   */
  it('is covered by default under an exclusion face', async () => {
    const engine = makeEngine();
    register(engine, 'audit', { excludeObjects: ['sys_audit_log'] });

    expect(await dispatch(engine, 'late_object')).toEqual(['audit']);
    expect(gateOpen(engine, 'late_object')).toBe(true);
  });

  it('is silently NOT covered under an enumerated allow list', async () => {
    const engine = makeEngine();
    // The same intent expressed as the complement, frozen at registration time.
    register(engine, 'audit', { object: ['account', 'contact'] });

    expect(await dispatch(engine, 'late_object')).toEqual([]);
    expect(gateOpen(engine, 'late_object')).toBe(false);
  });
});

describe('[#5928] refused exclusion faces (#4281 / ADR-0078 lineage)', () => {
  it('refuses the empty string — it subtracts nothing while reading as if it did', () => {
    const engine = makeEngine();
    expect(() => engine.registerHook(EVENT, () => {}, { excludeObjects: '' }))
      .toThrow(/empty `excludeObjects` entry/);
  });

  it("refuses `['']`, including as one member of an otherwise valid list", () => {
    const engine = makeEngine();
    expect(() => engine.registerHook(EVENT, () => {}, { excludeObjects: [''] }))
      .toThrow(/empty `excludeObjects` entry/);
    expect(() => engine.registerHook(EVENT, () => {}, { excludeObjects: ['sys_job', '  '] }))
      .toThrow(/empty `excludeObjects` entry/);
  });

  it("refuses `'*'` — subtracting every object leaves a hook that can never fire", () => {
    const engine = makeEngine();
    expect(() => engine.registerHook(EVENT, () => {}, { excludeObjects: '*' }))
      .toThrow(/can never fire/);
    expect(() => engine.registerHook(EVENT, () => {}, { excludeObjects: ['sys_job', '*'] }))
      .toThrow(/ADR-0078/);
  });

  it('registers nothing when it refuses', async () => {
    const engine = makeEngine();
    expect(() => engine.registerHook(EVENT, () => {}, { excludeObjects: '*' })).toThrow();

    // A refusal that still pushed the entry would leave exactly the inert
    // registration the refusal exists to prevent.
    expect(await dispatch(engine, 'account')).toEqual([]);
    expect(gateOpen(engine, 'account')).toBe(false);
  });

  it('names the fix in the message rather than only the fault', () => {
    const engine = makeEngine();
    const empty = (() => {
      try { engine.registerHook(EVENT, () => {}, { excludeObjects: '' }); return ''; }
      catch (e) { return (e as Error).message; }
    })();
    expect(empty).toContain("excludeObjects: ['sys_audit_log']");
    expect(empty).toContain('an empty array is accepted');
  });
});

/*
 * ── [#6573] The allow face gets #4281's door too ────────────────────────────
 *
 * #4281 ("an empty target is not *no* target") was closed in two places, both
 * on the METADATA path: `HookSchema.object`'s refine in `packages/spec`, and
 * `normalizeObjects` in `hook-binder.ts`. `engine.registerHook` — the CODE path
 * — went through neither, so all three spellings still reached the matcher:
 *
 *   `object: ''`   falsy ⇒ allow half skipped ⇒ registers GLOBAL   (#4281's
 *                  headline failure mode, on the path it never covered)
 *   `object: []`   truthy, admits nothing ⇒ can never fire          (ADR-0078)
 *   `object: ['']` same, via a name nothing is called               (ADR-0078)
 *
 * And #5928's exclusion face added a fourth, reached by arithmetic rather than
 * by one bad name: an allow face fully cancelled by the exclusion face. #5928's
 * ruling named only `''` / `['']` / `'*'`-in-excludes, so this fell outside its
 * letter and was deliberately left.
 *
 * All four are refused HERE, at the door — never by changing what
 * `hookMatchesObject` reads. That distinction is the card: teaching the matcher
 * that `''` is an unmatchable name would turn a hook firing on every object
 * into one firing on none, silently. Same defect, opposite direction.
 */
describe('[#6573] refused allow faces (#4281 on the code path)', () => {
  it("refuses `''` — falsy, so it would have registered a GLOBAL hook", () => {
    const engine = makeEngine();
    expect(() => engine.registerHook(EVENT, () => {}, { object: '' }))
      .toThrow(/empty `object` target/);
  });

  it("refuses `[]` and `['']` — an allow face that admits nothing can never fire", () => {
    const engine = makeEngine();
    expect(() => engine.registerHook(EVENT, () => {}, { object: [] }))
      .toThrow(/empty `object` target/);
    expect(() => engine.registerHook(EVENT, () => {}, { object: [''] }))
      .toThrow(/empty `object` target/);
    // One blank member poisons an otherwise valid list, as on the exclude face.
    expect(() => engine.registerHook(EVENT, () => {}, { object: ['account', '  '] }))
      .toThrow(/empty `object` target/);
  });

  it('leaves every legitimate allow face registrable', () => {
    const engine = makeEngine();
    expect(() => engine.registerHook(EVENT, () => {}, {})).not.toThrow();
    expect(() => engine.registerHook(EVENT, () => {}, { object: '*' })).not.toThrow();
    expect(() => engine.registerHook(EVENT, () => {}, { object: 'account' })).not.toThrow();
    expect(() => engine.registerHook(EVENT, () => {}, { object: ['account', 'contact'] }))
      .not.toThrow();
    // `undefined` is "no target" and stays the spelling of a global hook — the
    // refusal is about a target that was WRITTEN and names nothing.
    expect(() => engine.registerHook(EVENT, () => {}, { object: undefined })).not.toThrow();
  });

  it('registers nothing when it refuses', async () => {
    const engine = makeEngine();
    expect(() => register(engine, 'blank', { object: '' })).toThrow();

    // The refusal exists to prevent an inert (here: accidentally global) entry;
    // pushing it anyway would deliver exactly that entry.
    expect(await dispatch(engine, 'account')).toEqual([]);
    expect(gateOpen(engine, 'account')).toBe(false);
  });

  it("names the fix in the message, and reuses #4281's wording", () => {
    const engine = makeEngine();
    const message = (() => {
      try { engine.registerHook(EVENT, () => {}, { object: '' }); return ''; }
      catch (e) { return (e as Error).message; }
    })();
    expect(message).toContain('An empty target is not "no target"');
    expect(message).toContain("object: 'account'");
    expect(message).toContain("object: '*'");
    expect(message).toContain('ADR-0078');
  });
});

describe('[#6573] refused scopes whose two faces cancel out', () => {
  it('refuses a single name excluded by name', () => {
    const engine = makeEngine();
    expect(() => engine.registerHook(EVENT, () => {}, {
      object: 'account',
      excludeObjects: 'account',
    })).toThrow(/excludes every object its `object` target admits/);
  });

  it('refuses a list whose every member is excluded', () => {
    const engine = makeEngine();
    expect(() => engine.registerHook(EVENT, () => {}, {
      object: ['account', 'contact'],
      excludeObjects: ['account', 'contact'],
    })).toThrow(/can never fire/);
    // A wider exclusion list still cancels the allow face entirely.
    expect(() => engine.registerHook(EVENT, () => {}, {
      object: ['account'],
      excludeObjects: ['account', 'contact', 'lead'],
    })).toThrow(/ADR-0078/);
  });

  it('accepts a PARTIAL cancellation — that is what the exclusion face is for', async () => {
    const engine = makeEngine();
    register(engine, 'pair', { object: ['account', 'contact'], excludeObjects: ['contact'] });

    expect(await dispatch(engine, 'account')).toEqual(['pair']);
    expect(await dispatch(engine, 'contact')).toEqual([]);
  });

  it('leaves an OPEN allow face alone — a finite list cannot empty it', () => {
    const engine = makeEngine();
    // `'*'` and an absent `object` admit objects that do not exist yet (probe D
    // above), so no enumerated exclusion list can prove the entry inert. The one
    // exclusion that would — `'*'` — is already refused by #5928.
    expect(() => engine.registerHook(EVENT, () => {}, {
      object: '*',
      excludeObjects: ['account', 'contact'],
    })).not.toThrow();
    expect(() => engine.registerHook(EVENT, () => {}, {
      excludeObjects: ['account', 'contact'],
    })).not.toThrow();
  });

  it('does not fire on a non-overlapping exclusion', () => {
    const engine = makeEngine();
    expect(() => engine.registerHook(EVENT, () => {}, {
      object: 'account',
      excludeObjects: 'lead',
    })).not.toThrow();
  });

  it('registers nothing when it refuses', async () => {
    const engine = makeEngine();
    expect(() => register(engine, 'dead', {
      object: 'account',
      excludeObjects: 'account',
    })).toThrow();

    expect(await dispatch(engine, 'account')).toEqual([]);
    expect(gateOpen(engine, 'account')).toBe(false);
  });

  it('reports both faces in the message so the overlap is visible', () => {
    const engine = makeEngine();
    const message = (() => {
      try {
        engine.registerHook(EVENT, () => {}, { object: 'account', excludeObjects: 'account' });
        return '';
      } catch (e) { return (e as Error).message; }
    })();
    expect(message).toContain('["account"]');
    expect(message).toContain('ADR-0078');
  });
});

describe('[#5928] registration log reports the exclusion face', () => {
  it("carries `excludeObjects` in the 'Registered hook' debug record", () => {
    const logger = makeLogger();
    const engine = new ObjectQL({ logger });
    engine.registerHook(EVENT, () => {}, { excludeObjects: ['sys_audit_log', 'sys_job'] });

    const record = logger.debug.mock.calls.find((c) => c[0] === 'Registered hook');
    expect(record).toBeDefined();
    // A log printing only `object` would describe this entry as a plain global
    // hook, which is precisely what it is not.
    expect(record![1]).toMatchObject({
      event: EVENT,
      excludeObjects: ['sys_audit_log', 'sys_job'],
    });
  });
});

/*
 * ── The property: the gate is never tighter than the dispatch ───────────────
 *
 * `hasHooksFor` gates a READ of the whole matched row set on the bulk write
 * path (#5038, #5284). The asymmetry its comment records is the reason this is
 * a property test and not a spot check:
 *
 *   gate LOOSER than dispatch  → a wasted query. Cost.
 *   gate TIGHTER than dispatch → hooks that were going to fire are silently
 *                                dropped. Correctness, and silent.
 *
 * So the assertion is the implication `dispatched ⇒ gate open`, over every
 * combination of the two scope faces — never an equality, which would forbid
 * the legitimate looseness (`hasHooksFor` deliberately ignores
 * `skipAutomations`).
 */
describe('[#5928] property: hasHooksFor is never tighter than triggerHooks', () => {
  const SCOPES: Array<{ object?: string | string[]; excludeObjects?: string | string[] }> = [
    {},
    { object: '*' },
    { object: 'account' },
    { object: ['account', 'contact'] },
    { excludeObjects: 'account' },
    { excludeObjects: ['account', 'sys_job'] },
    { object: '*', excludeObjects: 'account' },
    { object: '*', excludeObjects: ['account', 'sys_job'] },
    { object: ['account', 'contact'], excludeObjects: 'contact' },
    // `{ object: ['account','contact'], excludeObjects: ['account','contact'] }`
    // used to sit here. #6573 refuses a fully-cancelled scope at registration,
    // so it can no longer be registered at all — and a scope that cannot exist
    // cannot violate the gate/dispatch property. Its refusal is pinned below.
    { object: 'account', excludeObjects: 'lead' },
    { excludeObjects: [] },
  ];
  const OBJECTS = ['account', 'contact', 'lead', 'sys_job', 'late_object'];

  it('holds for every single-entry scope × object pair', async () => {
    for (const scope of SCOPES) {
      for (const object of OBJECTS) {
        const engine = makeEngine();
        register(engine, 'h', scope);

        const dispatched = (await dispatch(engine, object)).length > 0;
        const open = gateOpen(engine, object);

        if (dispatched && !open) {
          throw new Error(
            `gate TIGHTER than dispatch for ${JSON.stringify(scope)} on '${object}': `
            + 'a hook fired that hasHooksFor said could not',
          );
        }
        // With one shared matcher and a single entry the two agree exactly;
        // asserting that here would catch a drift the implication tolerates.
        expect(open).toBe(dispatched);
      }
    }
  });

  /*
   * Realism, not detection power. Measured against a deliberately broken build
   * (gate applies the exclusion, dispatch reads the allow face only) the
   * single-entry matrix above fails with the offending scope named, while THIS
   * case still passes: once a global entry is in the set, the gate is open for
   * every object, so no violation can surface. Kept because coexisting
   * registrations are the real deployment shape — just do not read it as the
   * assertion with teeth.
   */
  it('holds for the whole scope set registered at once', async () => {
    const engine = makeEngine();
    SCOPES.forEach((scope, i) => register(engine, `h${i}`, scope));

    for (const object of OBJECTS) {
      const dispatched = (await dispatch(engine, object)).length > 0;
      expect(gateOpen(engine, object) || !dispatched).toBe(true);
    }
  });

  it('holds when `skipAutomations` suppresses metadata-bound entries', async () => {
    // The one legal direction of disagreement: the gate stays open while the
    // dispatch suppresses. Loose, never tight.
    const engine = makeEngine();
    engine.registerHook(EVENT, () => { throw new Error('must not run'); }, {
      excludeObjects: ['sys_job'],
      meta: { name: 'metadata_bound' },
    });

    await engine.triggerHooks(EVENT, {
      object: 'account',
      event: EVENT,
      input: {},
      session: { skipAutomations: true },
    } as any);

    expect(gateOpen(engine, 'account')).toBe(true);
    expect(gateOpen(engine, 'sys_job')).toBe(false);
  });
});

describe('[#5928] hookMatchesObject — the one shared rule', () => {
  it('is the function both consumers read', () => {
    // Guards against a future edit re-introducing a hand-written copy: if this
    // rule ever disagrees with either consumer, the property tests above fail.
    const entry: Pick<HookEntry, 'object' | 'excludeObjects'> = {
      object: '*',
      excludeObjects: ['sys_job'],
    };
    expect(hookMatchesObject(entry, 'account')).toBe(true);
    expect(hookMatchesObject(entry, 'sys_job')).toBe(false);
    expect(hookMatchesObject({}, 'anything')).toBe(true);
    expect(hookMatchesObject({ object: [] }, 'account')).toBe(false);
  });

  it("keeps the truthiness read of `object: ''` — #6573 closed the door, not the matcher", () => {
    // #5928 pinned this reading as preserved-not-endorsed and filed #6573.
    // #6573's ruling: refuse `''` at REGISTRATION, and leave this read alone —
    // flipping it would silently convert a fires-on-everything hook into a
    // fires-on-nothing one, the same defect pointing the other way. So the
    // matcher still answers "global" for a hand-built entry...
    expect(hookMatchesObject({ object: '' }, 'account')).toBe(true);
    // ...and no live entry can carry `''`, because registration refuses it.
    // (The refusal itself is pinned in the #6573 block below.)
    const engine = makeEngine();
    expect(() => register(engine, 'blank', { object: '' })).toThrow();
  });
});

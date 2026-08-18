// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#9285] `ObjectQLPlugin`'s three registry reads must not answer a read that
 * could not run with an invented *"the registry holds nothing"*.
 *
 * All three used to spell the read `this.ql.registry?.getAllObjects?.() ?? []`,
 * which folds three different facts into one value: the registry answered and
 * holds nothing; the engine exposes no `registry`; the registry exposes no
 * `getAllObjects`. Only the first is truthfully "no objects". #8895 ruled this
 * family *discriminate or propagate*, and #9002 / #9154 applied it to the two
 * delete-cascade seams and the roll-up summary index; this closes the same
 * shape in the plugin, where the consequential seam is at BOOT.
 *
 * The three seams get three different answers, and the difference is the point:
 *
 *  1. `syncRegisteredSchemas` — PROPAGATES. Its next line is
 *     `if (allObjects.length === 0) return;`, so an invented empty answer means
 *     NO registered object's schema is synced to any driver — no table created,
 *     no column added — silently, at boot, with the plugin reporting a clean
 *     start. Failing the boot is more truthful than starting against a store
 *     whose DDL never ran.
 *  2. `reconcileFederatedBindings` — REPORTS at `error`, then degrades. The
 *     pass exists to NAME the federated objects it could not bind ("a boot with
 *     nothing to report says nothing"), so an unreadable registry making it
 *     report nothing is exactly the silence it was written to prevent. It is a
 *     post-hoc reconciliation run after every `start()`, deliberately not a
 *     boot gate, so it reports rather than throws.
 *  3. `runGovernanceInventory` — REPORTS at `warn`, then skips. This seam
 *     carried TWO independent swallows (`?.()` and a wrapping
 *     `try { … } catch { return [] }`), and feeding the audit an invented empty
 *     object set is worse than silence: with no objects, every handler declared
 *     ON an object reconciles as an "undeclared handler … REFUSED at dispatch",
 *     so an unreadable registry accused a healthy deployment. The inventory is
 *     warn-only and exception-proof by contract, so it must not propagate.
 *
 * ⚠️ This pins a STRUCTURAL close, not a live defect — re-derived on this tree.
 * `SchemaRegistry.getAllObjects()` is a walk over in-memory `Map`s calling
 * `resolveObject()`, which returns `undefined` on every failure branch it
 * models and never throws; the fold below it is spreads and comparisons, with
 * no I/O and no driver. And `ObjectQL.registry` is a getter over a
 * field-initialized `SchemaRegistry`, so for a real engine neither optional
 * link can short-circuit either. The failure is therefore injected AT the
 * registry — and the injection IS the statement that nothing shipped reaches
 * these seams today. The reach that is real is a duck-typed `ql`: an
 * incomplete test double, which #9154 measured shipping in nine suites at once.
 *
 * One case is labelled PRESERVED rather than fixed, because the ablation said
 * so: a throwing registry already propagated out of `syncRegisteredSchemas`
 * before #9285 (its `?.` chain short-circuits on ABSENCE, never on a throw, and
 * that seam had no `catch`). Seam 2's defect was the structural half alone. The
 * test is kept — relabelled — because it fails the day someone wraps this read
 * in a `try/catch`, which is how seam 3 acquired its second swallow.
 *
 * Every failure case is paired with a POSITIVE CONTROL in the same describe —
 * a genuinely empty registry, and a populated one that still does the work — so
 * a plugin that had stopped syncing/binding/auditing altogether could not pass
 * any of this vacuously.
 */

import { describe, it, expect } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

/* Fixtures are typed as `ServiceObject` rather than left to inference, so this
 * file adds nothing to `@objectstack/objectql`'s TEST_DEBT ledger (#5278). */
const acct: ServiceObject = {
  name: 'acct',
  label: 'Account',
  fields: { id: { name: 'id', label: 'ID', type: 'text' as const } },
};

/** A federated object — the input `reconcileFederatedBindings` exists for. */
const remoteAcct: ServiceObject = {
  name: 'remote_acct',
  label: 'Remote account',
  fields: { id: { name: 'id', label: 'ID', type: 'text' as const } },
  external: { remoteName: 'acct_remote' },
};

/** An object that DECLARES the action the engine has a handler for. */
const acctWithAction: ServiceObject = {
  ...acct,
  actions: [{ name: 'ping', label: 'Ping', type: 'script' as const, body: 'return 1;' }],
};

interface Recorded {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  args: unknown[];
}

function recordingLogger() {
  const records: Recorded[] = [];
  const push = (level: Recorded['level']) => (message: string, ...args: unknown[]) =>
    void records.push({ level, message: String(message), args });
  return {
    records,
    logger: { debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') },
    at(level: Recorded['level']) {
      return records.filter((r) => r.level === level);
    },
  };
}

/** The error object every "registry throws" test asserts the IDENTITY of. */
const INJECTED = new Error('registry read exploded');

/**
 * The three shapes the old `?.()` / `?? []` spelling folded together, injected
 * at the registry itself.
 *
 * `throws` shadows the prototype method with an own property; the other two
 * shadow the `registry` GETTER with an own property, which is the only way to
 * express "this engine's registry does not implement the method" / "this engine
 * has no registry" against a real class. Both are exactly the duck-typed `ql`
 * an incomplete test double produces.
 */
type Injection = 'throws' | 'no-method' | 'no-registry';

function injectRegistryFailure(engine: ObjectQL, how: Injection): void {
  if (how === 'throws') {
    (engine.registry as any).getAllObjects = () => {
      throw INJECTED;
    };
    return;
  }
  Object.defineProperty(engine, 'registry', {
    value: how === 'no-registry' ? undefined : { getObject: () => undefined },
    configurable: true,
  });
}

/** A driver that records the DDL it was asked for. */
function recordingDriver() {
  const synced: string[] = [];
  const bound: string[] = [];
  return {
    synced,
    bound,
    driver: {
      name: 'default',
      supports: {},
      async syncSchema(tableName: string) {
        synced.push(tableName);
      },
      async registerExternalObject(obj: { name: string }) {
        bound.push(obj.name);
      },
      async find() {
        return [];
      },
    },
  };
}

function makePlugin(objects: ServiceObject[], driver?: unknown) {
  const rec = recordingLogger();
  const engine = new ObjectQL({ logger: rec.logger } as any);
  if (driver) engine.registerDriver(driver as any);
  for (const obj of objects) engine.registerObject(obj as any);
  const plugin = new ObjectQLPlugin();
  (plugin as any).ql = engine;
  return { rec, engine, plugin, ctx: { logger: rec.logger } as any };
}

// ───────────────────────────────────────────────────────────────────────────
// Seam 2 — syncRegisteredSchemas: PROPAGATE
// ───────────────────────────────────────────────────────────────────────────

describe('#9285 seam 2 — syncRegisteredSchemas propagates a registry it could not read', () => {
  /**
   * ⚠️ PRESERVED behaviour, not fixed behaviour — measured, and labelled as
   * such because reverse verification proved it green in BOTH directions.
   *
   * Seam 2's swallow was the OPTIONAL-CHAIN half only: `?? []` never caught
   * anything, because `?.` short-circuits on absence, not on a throw, and this
   * seam had no `catch` (unlike seam 3). So a throwing registry propagated here
   * before #9285 too. This test therefore pins nothing about the fix — its job
   * is the opposite one, and a real one: it fails the day someone "hardens"
   * this seam by wrapping the read in a `try/catch`, which is exactly how
   * seam 3 acquired its second swallow.
   */
  it('a THROWING registry already propagated, and must keep propagating (preserved, not fixed)', async () => {
    const { plugin, engine, ctx, rec } = makePlugin([acct], recordingDriver().driver);
    injectRegistryFailure(engine, 'throws');

    await expect((plugin as any).syncRegisteredSchemas(ctx)).rejects.toBe(INJECTED);
    // …and it did NOT quietly become "nothing to sync": no pass-complete line.
    expect(rec.at('info').filter((r) => /complete/i.test(r.message))).toHaveLength(0);
  });

  it('fails on a registry that does not implement getAllObjects, naming the consequence', async () => {
    const { plugin, engine, ctx } = makePlugin([acct], recordingDriver().driver);
    injectRegistryFailure(engine, 'no-method');

    // The `?.()` half of the swallow: a STRUCTURAL omission that never throws,
    // so before #9285 this was byte-identical to an empty registry.
    await expect((plugin as any).syncRegisteredSchemas(ctx)).rejects.toThrow(
      /syncRegisteredSchemas: the object registry could not be read/,
    );
    await expect((plugin as any).syncRegisteredSchemas(ctx)).rejects.toThrow(
      /NOT "no objects are registered"/,
    );
  });

  it('fails when the engine exposes no registry at all', async () => {
    const { plugin, engine, ctx } = makePlugin([acct], recordingDriver().driver);
    injectRegistryFailure(engine, 'no-registry');

    await expect((plugin as any).syncRegisteredSchemas(ctx)).rejects.toThrow(
      /the engine exposes no `registry`/,
    );
  });

  it('positive control — a genuinely EMPTY registry still returns quietly', async () => {
    const { plugin, ctx, rec } = makePlugin([], recordingDriver().driver);

    await expect((plugin as any).syncRegisteredSchemas(ctx)).resolves.toBeUndefined();
    expect(rec.at('error')).toHaveLength(0);
  });

  it('positive control — a readable registry still syncs every object it holds', async () => {
    const d = recordingDriver();
    const { plugin, ctx, rec } = makePlugin([acct], d.driver);

    await (plugin as any).syncRegisteredSchemas(ctx);

    expect(d.synced).toHaveLength(1);
    expect(rec.at('error')).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Seam 1 — reconcileFederatedBindings: REPORT at error, then degrade
// ───────────────────────────────────────────────────────────────────────────

describe('#9285 seam 1 — reconcileFederatedBindings reports the unreadable registry instead of reporting nothing', () => {
  for (const how of ['throws', 'no-method', 'no-registry'] as Injection[]) {
    it(`reports at error and does not throw (registry ${how})`, async () => {
      const { plugin, engine, ctx, rec } = makePlugin([remoteAcct], recordingDriver().driver);
      injectRegistryFailure(engine, how);

      // Exception-proof: this pass runs at `kernel:ready`, after every
      // `start()`, and is deliberately not a boot gate.
      await expect((plugin as any).reconcileFederatedBindings(ctx)).resolves.toBeUndefined();

      const errors = rec.at('error');
      expect(errors).toHaveLength(1);
      // CONSEQUENCE — named, not merely "something failed".
      expect(errors[0].message).toMatch(/reconciliation did NOT run/);
      expect(errors[0].message).toMatch(/stays registered and served/);
      expect(errors[0].message).toMatch(/no such table/);
      // The invention itself, called out so the reader cannot read this as
      // "there were none".
      expect(errors[0].message).toMatch(/NOT "no federated objects to bind"/);
      // FIX.
      expect(errors[0].message).toMatch(/restart \(or trigger a metadata reload\)/);
      // `Logger.error` is `(message, error?, meta?)` — the cause rides slot 2.
      expect(errors[0].args[0]).toBeInstanceOf(Error);
    });
  }

  it('preserves the injected error as the reported cause', async () => {
    const { plugin, engine, ctx, rec } = makePlugin([remoteAcct], recordingDriver().driver);
    injectRegistryFailure(engine, 'throws');

    await (plugin as any).reconcileFederatedBindings(ctx);

    expect(rec.at('error')[0].args[0]).toBe(INJECTED);
  });

  it('positive control — a readable registry with NO federated objects stays silent', async () => {
    const { plugin, ctx, rec } = makePlugin([acct], recordingDriver().driver);

    await (plugin as any).reconcileFederatedBindings(ctx);

    expect(rec.at('error')).toHaveLength(0);
  });

  it('positive control — a readable registry still binds its federated objects', async () => {
    const d = recordingDriver();
    const { plugin, ctx, rec } = makePlugin([remoteAcct], d.driver);

    await (plugin as any).reconcileFederatedBindings(ctx);

    expect(d.bound).toEqual(['remote_acct']);
    expect(rec.at('error')).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Seam 3 — runGovernanceInventory: REPORT at warn, then skip (BOTH swallows)
// ───────────────────────────────────────────────────────────────────────────

/** The false accusation an invented empty object set produces. */
const UNDECLARED_WARN = /registered handlers with NO declaration/;
const SKIPPED_WARN = /inventory SKIPPED/;

function governancePlugin(how?: Injection) {
  const built = makePlugin([acctWithAction], recordingDriver().driver);
  built.engine.registerAction('acct', 'ping', async () => 1);
  if (how) injectRegistryFailure(built.engine, how);
  // `runGovernanceInventory` probes a metadata service; a kernel without one
  // is the ordinary case and the seam under test is downstream of it.
  built.ctx.getService = () => undefined;
  return built;
}

describe('#9285 seam 3 — runGovernanceInventory reports both swallows instead of auditing an invented empty set', () => {
  for (const how of ['throws', 'no-method', 'no-registry'] as Injection[]) {
    it(`warns that the audit was SKIPPED and accuses nobody (registry ${how})`, async () => {
      const { plugin, ctx, rec } = governancePlugin(how);

      // Warn-only and exception-proof BY CONTRACT: a diagnostic must never be
      // the reason a kernel fails to boot.
      await expect((plugin as any).runGovernanceInventory(ctx)).resolves.toBeUndefined();

      const warns = rec.at('warn');
      const skipped = warns.filter((r) => SKIPPED_WARN.test(r.message));
      expect(skipped).toHaveLength(1);
      expect(skipped[0].message).toMatch(/could not be read/);
      // The whole point of seam 3: an empty object set does not merely audit
      // nothing, it accuses every object-declared action of being undeclared.
      expect(warns.filter((r) => UNDECLARED_WARN.test(r.message))).toHaveLength(0);
      // `warn` is `(message, meta?)` — the cause rides slot 1, not slot 2.
      expect(skipped[0].args[0]).toMatchObject({ error: expect.any(String) });
    });
  }

  it('leaves the fingerprint untouched, so the NEXT successful run is not suppressed as unchanged', async () => {
    const { plugin, engine, ctx, rec } = governancePlugin('throws');
    (plugin as any).lastGovernanceFingerprint = 'previous-run';

    await (plugin as any).runGovernanceInventory(ctx);
    expect((plugin as any).lastGovernanceFingerprint).toBe('previous-run');

    // Recover the registry, drop the declaration: the audit must now speak.
    delete (engine.registry as any).getAllObjects;
    engine.registerObject(acct as any);
    engine.registry.invalidate('acct');
    rec.records.length = 0;

    await (plugin as any).runGovernanceInventory(ctx);
    expect(rec.at('warn').filter((r) => UNDECLARED_WARN.test(r.message))).toHaveLength(1);
  });

  it('positive control — a readable registry audits, and a DECLARED handler is not accused', async () => {
    const { plugin, ctx, rec } = governancePlugin();

    await (plugin as any).runGovernanceInventory(ctx);

    expect(rec.at('warn')).toHaveLength(0);
    expect((plugin as any).lastGovernanceFingerprint).toBe('');
  });

  it('positive control — a readable registry DOES accuse a genuinely undeclared handler', async () => {
    const built = makePlugin([acct], recordingDriver().driver);
    built.engine.registerAction('acct', 'ping', async () => 1);
    built.ctx.getService = () => undefined;

    await (built.plugin as any).runGovernanceInventory(built.ctx);

    expect(built.rec.at('warn').filter((r) => UNDECLARED_WARN.test(r.message))).toHaveLength(1);
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #15292 — the documented boot posture: dev boot TOLERATES a malformed stack
// and REPORTS it; `os validate` / build / publish are the doors that refuse.
//
// What this file pins is the posture and its DIVISION, not any diagnostic's
// wording. The wording of the malformed-metadata diagnostic is the subject of
// a sibling change and is deliberately NOT asserted here — a pin on today's
// text would turn an intended improvement into a failing test, and the posture
// is what the docblock and `content/docs/plugins/packages.mdx` now claim.
//
// ── Why the division needs a pin of its own ────────────────────────────────
// Two DIFFERENT malformations arrive at this plugin, and the file's own
// comment at the `new AppPlugin(stack)` branch used to read as though one
// branch caught both ("a malformed stack throws HERE"). It does not.
// `AppPlugin`'s constructor reads `manifest.id` / `manifest.name` and nothing
// else, so a malformed `packages[]` walks past it and is refused one branch
// later: `AppPlugin.init()`'s LAST statement hands the bundle to the kernel's
// `manifest` service, whose `register()` calls `resolveArtifactPackageOrder`
// unguarded, and DevPlugin's child-`init()` loop degrades that refusal to an
// `error` line.
//
// ⛔ The lazy `collections` getter is NOT on that path. It is not read during
// `AppPlugin.init()` at all — its first read is in `AppPlugin.start()`, where
// it reaches the same refusal on the same bytes. The third case below is the
// falsifier for the superseded wording: with the `manifest` service's
// `register()` replaced by a no-op, the same malformed-`packages[]` `init()`
// resolves clean.
//
// The two malformations are exact COMPLEMENTS — each fires in one branch and
// is invisible to the other — which is why a clean boot past one says nothing
// about the other, and why the healthy control below is not optional: without
// it, two instruments that both simply always threw would produce the same
// green.

import { describe, it, expect } from 'vitest';
import { AppPlugin } from '@objectstack/runtime';
import { resolveArtifactPackageOrder } from '@objectstack/core';
import { DevPlugin } from './dev-plugin';

/** A `packages[]` entry with its body inlined instead of wrapped as `{ manifest: … }`. */
const MALFORMED_PACKAGES = {
  manifest: { id: 'com.acme.crm', name: 'crm', label: 'CRM', version: '1.0.0' },
  packages: [{ id: 'com.acme.crm.core', name: 'core', version: '1.0.0', type: 'package' }],
};

/** An envelope that plainly carries an app but never says which app it is. */
const MISSING_IDENTITY = { objects: [{ name: 'task', label: 'Task' }] };

/** Neither malformation. The lit control for BOTH instruments below. */
const HEALTHY = {
  manifest: { id: 'com.acme.crm', name: 'crm', label: 'CRM', version: '1.0.0' },
  packages: [{ manifest: { id: 'com.acme.crm.core', name: 'core', version: '1.0.0', type: 'app' } }],
};

/** Every slot off but the app-metadata one, which is gated on `stack` alone. */
const ONLY_APP_METADATA = {
  objectql: false, driver: false, auth: false, server: false, rest: false,
  dispatcher: false, security: false, i18n: false, storage: false,
  'file-storage': false, realtime: false,
};

function mockCtx() {
  const lines: { level: string; text: string }[] = [];
  const rec = (level: string) => (...a: unknown[]) => lines.push({ level, text: a.join(' ') });
  const services = new Map<string, unknown>();
  const ctx = {
    logger: { info: rec('info'), debug: rec('debug'), warn: rec('warn'), error: rec('error') },
    getService: (n: string) => {
      if (services.has(n)) return services.get(n);
      throw new Error(`service '${n}' is not registered`);
    },
    getServices: () => new Map(),
    registerService: (n: string, s: unknown) => { services.set(n, s); },
    hook: () => {}, trigger: () => {}, getKernel: () => undefined,
  };
  return { ctx: ctx as never, lines };
}

/** What happened when `fn` ran: the thrown value, or `undefined` for a clean run. */
function raised(fn: () => unknown): { code?: string; status?: number; message: string } | undefined {
  try { fn(); return undefined; } catch (e) {
    const err = e as { code?: string; status?: number; message?: string };
    return { code: err?.code, status: err?.status, message: String(err?.message ?? e) };
  }
}

/** {@link raised}, for an awaited call. */
async function raisedAsync(
  fn: () => Promise<unknown>,
): Promise<{ code?: string; status?: number; message: string } | undefined> {
  try { await fn(); return undefined; } catch (e) {
    const err = e as { code?: string; status?: number; message?: string };
    return { code: err?.code, status: err?.status, message: String(err?.message ?? e) };
  }
}

/**
 * A kernel context carrying exactly one service: `manifest`. `register` is the
 * injection point — the real parse, or a no-op — which is what makes the
 * falsifier below a measurement rather than a restatement.
 */
function appCtx(register: (artifact: unknown) => void) {
  const noop = () => {};
  return {
    logger: { info: noop, debug: noop, warn: noop, error: noop },
    getService: (n: string) => {
      if (n === 'manifest') return { register };
      throw new Error(`service '${n}' is not registered`);
    },
    getServices: () => new Map(),
    registerService: noop,
    hook: noop, trigger: noop, getKernel: () => undefined,
  };
}

describe('#15292 — DevPlugin tolerates a malformed stack and reports it', () => {
  it('boots past a metadata malformation instead of refusing, and is not silent about it', async () => {
    const { ctx, lines } = mockCtx();
    const plugin = new DevPlugin({
      stack: MISSING_IDENTITY as never,
      services: ONLY_APP_METADATA,
      seedAdminUser: false,
    });

    // TOLERATES — the whole posture in one assertion. `os validate`, build and
    // publish are the doors that refuse this same stack.
    await expect(plugin.init(ctx)).resolves.toBeUndefined();

    // REPORTS — the transcript of a degraded boot is never the transcript of a
    // healthy one. The level is asserted; the wording deliberately is not.
    const errors = lines.filter((l) => l.level === 'error');
    expect(errors.length).toBeGreaterThan(0);

    // …and it really did skip the thing it reported, rather than reporting a
    // failure it then went on to recover from.
    expect(lines.some((l) => l.text.includes('App metadata loaded from stack definition'))).toBe(false);
  }, 60_000);

  it('the two malformations are exact complements — each is invisible to the other branch', () => {
    // Branch 1 — `new AppPlugin(stack)`, DevPlugin's §3. Reads the envelope's
    // identity, and nothing else.
    const ctorMissingId = raised(() => new AppPlugin(MISSING_IDENTITY as never));
    const ctorMalformedPkgs = raised(() => new AppPlugin(MALFORMED_PACKAGES as never));
    const ctorHealthy = raised(() => new AppPlugin(HEALTHY as never));

    // Branch 2 — the package-list parse. On a real boot it is reached from
    // `AppPlugin.init()`'s manifest registration (pinned below) and therefore
    // caught by DevPlugin's child-`init()` loop, not by §3.
    const parseMissingId = raised(() => resolveArtifactPackageOrder(MISSING_IDENTITY as never));
    const parseMalformedPkgs = raised(() => resolveArtifactPackageOrder(MALFORMED_PACKAGES as never));
    const parseHealthy = raised(() => resolveArtifactPackageOrder(HEALTHY as never));

    // The control: a stack with neither malformation is silent on BOTH
    // instruments. Without this row a pair of always-throwing instruments
    // would satisfy every assertion above it.
    expect(ctorHealthy).toBeUndefined();
    expect(parseHealthy).toBeUndefined();

    // A missing identity is the constructor's business, and only its business.
    expect(ctorMissingId?.message).toContain('no manifest.id / manifest.name');
    expect(parseMissingId).toBeUndefined();

    // A malformed `packages[]` is invisible to the constructor and is refused
    // by the parse — under ADR-0112, with a code and a status the bare
    // constructor `Error` above does not carry.
    expect(ctorMalformedPkgs).toBeUndefined();
    expect(parseMalformedPkgs?.code).toBe('INVALID_ARTIFACT_PACKAGE_ENTRY');
    expect(parseMalformedPkgs?.status).toBe(422);

    // The complement, stated as the single fact the docs now claim: no input
    // here trips both branches, so neither is a second opinion on the other.
    expect(ctorMissingId !== undefined && parseMissingId !== undefined).toBe(false);
    expect(ctorMalformedPkgs !== undefined && parseMalformedPkgs !== undefined).toBe(false);
  }, 60_000);

  it('the `packages[]` refusal surfaces from `AppPlugin.init()`\'s manifest registration, not from `collections`', async () => {
    // What the real `manifest` service's `register()` does first, and
    // unguarded: `ObjectQLPlugin.init` registers exactly this parse.
    const realRegister = (artifact: unknown) => { resolveArtifactPackageOrder(artifact); };

    // The measured path. `AppPlugin.init()`'s LAST statement is
    // `getService('manifest').register(payload)`, so the ADR-0112 refusal
    // arrives from there — with a code and a status, unlike the constructor's
    // bare `Error`.
    const viaManifest = await raisedAsync(
      () => new AppPlugin(MALFORMED_PACKAGES as never).init(appCtx(realRegister) as never),
    );
    expect(viaManifest?.code).toBe('INVALID_ARTIFACT_PACKAGE_ENTRY');
    expect(viaManifest?.status).toBe(422);

    // THE FALSIFIER for "a lazy getter first touched in `init()`". Same bundle,
    // same `init()`, `register()` replaced by a no-op: nothing else `init()`
    // runs — the `collections` getter included — touches `packages[]`, so this
    // resolves clean. Were `collections` read in `init()`, this row would throw.
    expect(await raisedAsync(
      () => new AppPlugin(MALFORMED_PACKAGES as never).init(appCtx(() => {}) as never),
    )).toBeUndefined();

    // THE LIT CONTROL for the first row: the real `register()` is not an
    // instrument that simply always throws.
    expect(await raisedAsync(
      () => new AppPlugin(HEALTHY as never).init(appCtx(realRegister) as never),
    )).toBeUndefined();
  }, 60_000);

  it('a whole DevPlugin boot tolerates a malformed `packages[]` and reports it on the child-`init()` loop\'s error line', async () => {
    // The end-to-end shape the docblock and the docs page claim, on the branch
    // §3's catch never sees. `objectql` is ON here — without it there is no
    // `manifest` service to register into, and the refusal under test cannot be
    // reached at all.
    const boot = async (stack: unknown) => {
      const { ctx, lines } = mockCtx();
      const plugin = new DevPlugin({
        stack: stack as never,
        services: { ...ONLY_APP_METADATA, objectql: true, driver: true },
        seedAdminUser: false,
      });
      await expect(plugin.init(ctx)).resolves.toBeUndefined();  // TOLERATES
      return lines;
    };

    const degraded = await boot(MALFORMED_PACKAGES);
    // The constructor ACCEPTED it — §3 logged its success line — which is the
    // whole point: this malformation is invisible to that branch.
    expect(degraded.some((l) => l.text.includes('App metadata loaded from stack definition'))).toBe(true);
    // REPORTS — on the child-`init()` loop's error line, carrying the refusal
    // verbatim. The refusal is asserted; the loop's own phrasing is not.
    const errors = degraded.filter((l) => l.level === 'error');
    expect(errors.some((l) => l.text.includes('is not a package entry'))).toBe(true);

    // THE LIT CONTROL. A boot that skipped something is never byte-identical to
    // a healthy one — so the healthy stack produces no error line at all.
    const healthy = await boot(HEALTHY);
    expect(healthy.filter((l) => l.level === 'error')).toEqual([]);
  }, 60_000);
});

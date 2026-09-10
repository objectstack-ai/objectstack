// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16013] The ONE classification six admission seams used to hand-write, and
 * the pins that make it able to FAIL.
 *
 * ## What this file is for
 *
 * The card that folded the copies is not a de-duplication card: its argument is
 * that "a quiet `catch` at any one of them re-opens #13906", and one tested
 * classification is worth more than six copies that must each stay correct
 * forever. So the value of the fold is entirely in these pins — they are what
 * six seams now share instead of six chances to write the decision wrong.
 *
 * ## Reading discipline
 *
 * Both rejections are driven at the PRODUCTION seam — a real `ObjectKernel`
 * whose registry rejects for a service nothing registered (the branded fact,
 * #13905) and whose `tenancy` factory THROWS (the unbranded one) — never by
 * throwing hand-made errors at the function under measurement. Each loud
 * assertion is paired with the reading that separates it from its twin: the
 * brand predicate's own answer on that same rejection. Without that pairing,
 * "the outage throws" would be satisfied by a helper that throws at everything,
 * which is the worse defect (every no-tenancy embedding refused).
 *
 * §3 holds the card's ⛔ constraint mechanically: this helper must never learn
 * how to REACH the service. That is not style — a helper that owned the
 * resolution would be wrong for `rest-server.ts`'s kernel-vs-provider branch
 * (asking twice lets a provider bound to the local kernel answer for a request
 * that resolved to another environment) or would grow a flag per seam, which is
 * the copies again with an extra step.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { ObjectKernel } from '../kernel.js';
import { ServiceLifecycle } from '../plugin-loader.js';
import { isServiceNotRegisteredError } from '../service-not-registered.js';

import { classifyAdmissionTenancyPosture } from './admission-tenancy-posture.js';
import type { TenancyPostureSource } from './api-key.js';
import {
  isAuthzStoreUnavailableError,
  AUTHZ_STORE_UNAVAILABLE_CODE,
  AUTHZ_STORE_UNAVAILABLE_STATUS,
} from './authz-store-unavailable.js';

const FACTORY_FAULT = 'tenancy factory exploded';

function freshKernel(): ObjectKernel {
  return new ObjectKernel({
    logger: { level: 'error' },
    gracefulShutdown: false,
    skipSystemValidation: true,
  });
}

/** A kernel whose `tenancy` service is registered and answers. */
async function kernelWithTenancy(service: unknown): Promise<ObjectKernel> {
  const kernel = freshKernel();
  kernel.registerServiceFactory('tenancy', () => service, ServiceLifecycle.SINGLETON);
  await kernel.bootstrap();
  return kernel;
}

/** A kernel whose `tenancy` service IS registered and cannot be built. */
async function kernelWithBrokenTenancy(): Promise<ObjectKernel> {
  const kernel = freshKernel();
  kernel.registerServiceFactory(
    'tenancy',
    () => { throw new Error(FACTORY_FAULT); },
    ServiceLifecycle.SINGLETON,
  );
  await kernel.bootstrap();
  return kernel;
}

/** A kernel that never heard of `tenancy` — the supported composition. */
async function kernelWithoutTenancy(): Promise<ObjectKernel> {
  const kernel = freshKernel();
  await kernel.bootstrap();
  return kernel;
}

// ---------------------------------------------------------------------------
// §1 — the two facts the registry can report, told apart (#13906 decision 1 A)
// ---------------------------------------------------------------------------

describe('[#16013] §1 — branded "never registered" vs every other rejection', () => {
  it('NEVER REGISTERED ⇒ quiet `undefined` — the supported no-tenancy composition', async () => {
    const kernel = await kernelWithoutTenancy();
    try {
      // ANTI-VACUITY CONTROL: this really is the BRANDED rejection, read off
      // the production registry rather than assumed. If the registry ever stops
      // branding it, the quiet answer below would be quiet for the wrong
      // reason — an outage wearing the no-tenancy composition's costume.
      const raw = await kernel.getServiceAsync<TenancyPostureSource>('tenancy').then(
        () => undefined,
        (err: unknown) => err,
      );
      expect(isServiceNotRegisteredError(raw)).toBe(true);

      await expect(
        classifyAdmissionTenancyPosture(() => kernel.getServiceAsync<TenancyPostureSource>('tenancy')),
      ).resolves.toBeUndefined();
    } finally {
      await kernel.shutdown();
    }
  });

  it('REGISTERED AND FAILED TO BUILD ⇒ the ADR-0112 outage, never a quiet `undefined`', async () => {
    const kernel = await kernelWithBrokenTenancy();
    try {
      // ANTI-VACUITY CONTROL, the other half: this rejection is NOT branded, so
      // the loud answer below is the classification working and not the
      // predicate misfiring.
      const raw = await kernel.getServiceAsync<TenancyPostureSource>('tenancy').then(
        () => undefined,
        (err: unknown) => err,
      );
      expect(isServiceNotRegisteredError(raw)).toBe(false);

      const err = await classifyAdmissionTenancyPosture(
        () => kernel.getServiceAsync<TenancyPostureSource>('tenancy'),
      ).then(() => undefined, (e: unknown) => e);

      // The ENVELOPE is the assertion (ADR-0112), not the message text.
      expect(isAuthzStoreUnavailableError(err)).toBe(true);
      expect(err).toMatchObject({
        code: AUTHZ_STORE_UNAVAILABLE_CODE,
        status: AUTHZ_STORE_UNAVAILABLE_STATUS,
        object: 'tenancy',
      });
      // ⛔ The original fault is not thrown away: an outage nobody can diagnose
      // is the next incident.
      expect(String((err as { cause?: unknown }).cause)).toContain(FACTORY_FAULT);
    } finally {
      await kernel.shutdown();
    }
  });

  it('SCOPED without a scope id ⇒ loud too — an unbranded rejection is an outage whatever produced it', async () => {
    const kernel = freshKernel();
    kernel.registerServiceFactory('tenancy', () => ({ posture: 'isolated' }), ServiceLifecycle.SCOPED);
    await kernel.bootstrap();
    try {
      const raw = await kernel.getServiceAsync<TenancyPostureSource>('tenancy').then(
        () => undefined,
        (err: unknown) => err,
      );
      // Reading first: a scoped registration resolved without a scope id may
      // reject, and if it does the rejection is NOT the "never registered"
      // brand. The pin follows the reading rather than asserting over it.
      if (raw === undefined) {
        expect(raw).toBeUndefined();
      } else {
        expect(isServiceNotRegisteredError(raw)).toBe(false);
        await expect(
          classifyAdmissionTenancyPosture(() => kernel.getServiceAsync<TenancyPostureSource>('tenancy')),
        ).rejects.toSatisfy(isAuthzStoreUnavailableError);
      }
    } finally {
      await kernel.shutdown();
    }
  });

  it('HEALTHY ⇒ the posture IN FORCE, read through the same reader the wall uses', async () => {
    const kernel = await kernelWithTenancy({ posture: 'isolated' });
    try {
      await expect(
        classifyAdmissionTenancyPosture(() => kernel.getServiceAsync<TenancyPostureSource>('tenancy')),
      ).resolves.toBe('isolated');
    } finally {
      await kernel.shutdown();
    }
  });
});

// ---------------------------------------------------------------------------
// §2 — the thunk contract the six seams depend on
// ---------------------------------------------------------------------------

describe('[#16013] §2 — the resolver is a THUNK, and the seams depend on how it is called', () => {
  it('a SYNCHRONOUS throw classifies identically — both directions', async () => {
    // The seams reach the service through accessors that can throw before ever
    // returning a promise (`PluginContext.getService` does exactly that). A
    // helper that only caught rejections would let a synchronous branded throw
    // become an outage, and a synchronous unbranded one escape unclassified.
    await expect(
      classifyAdmissionTenancyPosture(() => { throw new Error('accessor threw'); }),
    ).rejects.toSatisfy(isAuthzStoreUnavailableError);

    const kernel = await kernelWithoutTenancy();
    try {
      // …and the genuinely branded one, thrown synchronously out of the thunk.
      const raw = await kernel.getServiceAsync<TenancyPostureSource>('tenancy').then(
        () => undefined,
        (err: unknown) => err,
      );
      expect(isServiceNotRegisteredError(raw)).toBe(true);
      await expect(
        classifyAdmissionTenancyPosture(() => { throw raw; }),
      ).resolves.toBeUndefined();
    } finally {
      await kernel.shutdown();
    }
  });

  it('the service is asked EXACTLY ONCE — ⛔ never twice', async () => {
    // ⛔ Load-bearing for `rest-server.ts`: asking twice would let a provider
    // bound to the LOCAL kernel answer for a request that resolved to another
    // environment. A retry inside the shared classification would reintroduce
    // that at every seam at once.
    let asked = 0;
    await classifyAdmissionTenancyPosture(async () => {
      asked++;
      return { posture: 'single' };
    });
    expect(asked).toBe(1);

    asked = 0;
    await classifyAdmissionTenancyPosture(async () => {
      asked++;
      throw new Error('boom');
    }).catch(() => undefined);
    expect(asked).toBe(1);
  });

  it('an ABSENT service resolves quietly — `undefined` and `null` are not faults', async () => {
    await expect(classifyAdmissionTenancyPosture(async () => undefined)).resolves.toBeUndefined();
    await expect(classifyAdmissionTenancyPosture(async () => null)).resolves.toBeUndefined();
  });

  it('the reconciliation is `effectiveTenancyPosture`\'s, not a second reading', async () => {
    // ADR-0093 D4/D5: the service's own report, never `OS_TENANCY_POSTURE`.
    await expect(
      classifyAdmissionTenancyPosture(async () => ({ isolationActive: true })),
    ).resolves.toBe('isolated');
    await expect(
      classifyAdmissionTenancyPosture(async () => ({ isolationActive: false })),
    ).resolves.toBe('single');
  });
});

// ---------------------------------------------------------------------------
// §3 — ⛔ the constraint the card exists to protect: classification ONLY
// ---------------------------------------------------------------------------

describe('[#16013] §3 — the helper must never learn how to REACH the service', () => {
  const SOURCE = readFileSync(new URL('./admission-tenancy-posture.ts', import.meta.url), 'utf8');
  const DECL = 'export async function classifyAdmissionTenancyPosture';
  /**
   * The IMPLEMENTATION, sliced BY SYMBOL from its declaration to end of file.
   *
   * ⚠️ Why a slice and ⛔ not a comment-stripped whole file: the module doc
   * NAMES several of the forbidden symbols on purpose — it exists to say why
   * they are not here — so a whole-file reading would have to strip comments,
   * and a private stripper is its own defect class
   * (`pnpm check:comment-mask-adoption`). The slice needs no stripping at all,
   * and the test below asserts that fact rather than assuming it.
   */
  const IMPL = SOURCE.slice(SOURCE.indexOf(DECL));

  it('the sliced region really is the implementation, and really is comment-free', () => {
    // The reading's own preconditions, measured — an `indexOf` miss would make
    // every assertion below run over the WHOLE file and pass for the wrong
    // reason (or fail for one).
    expect(SOURCE.indexOf(DECL)).toBeGreaterThan(0);
    expect(IMPL.startsWith(DECL)).toBe(true);
    expect(IMPL).not.toContain('/*');
    expect(IMPL).not.toContain('//');
  });

  it('names no accessor, no kernel and no context — the resolution stays at each seam', () => {
    for (const forbidden of ['getServiceAsync', 'getKernel', 'PluginContext', 'getService(']) {
      expect(IMPL).not.toContain(forbidden);
    }
    // POSITIVE CONTROL for the reading: the real body is inside the slice.
    expect(IMPL).toContain('isServiceNotRegisteredError');
    expect(IMPL).toContain('AuthzStoreUnavailableError');
  });

  it('takes exactly one parameter — a per-seam flag would be the copies with extra steps', () => {
    expect(classifyAdmissionTenancyPosture).toHaveLength(1);
  });
});

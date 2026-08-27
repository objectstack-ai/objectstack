// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#12601] The load-bearing consequence: `unwrapProxyToPlain`
// (`body-runner.ts`) snapshots a hook body's `ctx.input` through
// `Object.entries` over the REAL flat-input Proxy from `@objectstack/objectql`.
// A sandboxed body reading `ctx.input.id` — for a record whose payload also
// declares a field literally named `id` — sees the ENVELOPE's value now BY
// CONTRACT (`getOwnPropertyDescriptor` and `get` agree, per the maintainer
// ruling on #12601), not by the accident of #12578's `ownKeys` widening
// happening to line up with `get`'s pre-existing wrapper-first read. This is
// the path the original #12601 finding measured, and the one that would
// silently regress if `getOwnPropertyDescriptor` ever went back to checking
// `data` first.
//
// ## ⚠️ REBUILD IS LOAD-BEARING FOR THIS FILE — determined, not assumed
//
// `packages/runtime/vitest.config.ts` does not alias `@objectstack/objectql`
// to source (registered in `KNOWN_UNALIASED_TEST_IMPORTS`,
// `scripts/check-test-source-alias.mjs`), so `wrapDeclarativeHook` below
// resolves through `exports` to `objectql/dist` — an edit to
// `packages/objectql/src/hook-wrappers.ts` that is not rebuilt is INVISIBLE
// here, and the dangerous direction is an ablation of the objectql half
// staying GREEN, certifying a pin that measured a stale artifact.
// `pnpm --filter @objectstack/objectql build` before running this file.
//
// ## This file is a CONSEQUENCE pin, not the ablation discriminator
//
// Measured: this test is ALREADY GREEN before the #12601 fix lands, because
// `unwrapProxyToPlain`'s `Object.entries` walk happened to line up anyway —
// `ownKeys` already listed the colliding name (#12578), the pre-fix
// descriptor trap reported the payload's own descriptor as `enumerable:
// true` (an ordinary assigned field), which passes `Object.entries`'s
// filter, and the VALUE then came from `get` — which always resolved the
// wrapper. That is exactly "by accident": correct today for a reason that
// has nothing to do with reserved-name precedence and would not survive,
// say, a payload that defined its colliding field non-enumerable. The
// instrument that actually disagreed — `getOwnPropertyDescriptor`'s VALUE —
// is pinned as the discriminator in
// `packages/objectql/src/hook-input-envelope-precedence.test.ts`; THIS file
// pins that the composition with the sandbox snapshot keeps holding once
// that trap is fixed, so a future regression of the trap has a second,
// consequence-level tripwire even though this file alone cannot distinguish
// "by accident" from "by contract".
//
// ## Why this composition and not a hand-rolled double
//
// `body-runner.test.ts`'s own flat-input double (`ownKeys`/`getOwnPropertyDescriptor`
// modelling `Object.getOwnPropertyNames`/`Reflect.getOwnPropertyDescriptor`
// directly on the backing object) does not implement wrapper-key precedence
// at all — it has no envelope/payload split to disagree about. The subject
// here is specifically the composition of objectql's REAL Proxy (its
// reserved-name precedence) with the sandbox's REAL `unwrapProxyToPlain`
// (its `Object.entries` walk) — a boundary no unit mock on either side alone
// exercises.

import { describe, it, expect } from 'vitest';
import { wrapDeclarativeHook } from '@objectstack/objectql';
import { hookBodyRunnerFactory } from './body-runner.js';
import { QuickJSScriptRunner } from './quickjs-runner.js';

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

describe('[#12601] a sandboxed hook body sees the envelope value for a reserved name colliding with a payload field', () => {
  it('`ctx.input.id` inside the VM is the envelope id, and the payload write-back is unaffected', async () => {
    const runner = new QuickJSScriptRunner();
    const factory = hookBodyRunnerFactory(runner, { ql: {}, appId: 'crm' });
    const fn = factory({
      name: 'envelope_precedence_probe',
      object: 'case',
      events: ['beforeUpdate'],
      body: {
        language: 'js',
        // Written back through the flat proxy's `set` trap — a non-reserved
        // key, so it lands in `data` and is observable from outside the VM.
        source: 'return { observed_id: ctx.input.id };',
        capabilities: [],
      },
    } as any);
    expect(typeof fn).toBe('function');

    const wrapped = wrapDeclarativeHook(
      { name: 'wrap_envelope_precedence_probe', object: 'case', event: 'beforeUpdate' } as any,
      (async (ctx: any) => { await fn!(ctx); }) as any,
      { logger: silentLogger },
    );

    const raw: any = { data: { id: 'PAYLOAD-ID', subject: 'help' }, options: {}, id: 'WRAPPER-ID' };
    await wrapped({ object: 'case', event: 'beforeUpdate', input: raw } as any);

    // The sandboxed body observed the ENVELOPE's id, not the payload's.
    expect(raw.data.observed_id).toBe('WRAPPER-ID');
    // The payload's own `id` field is untouched — it was never visible to the
    // sandbox, and the merge-back never overwrote it.
    expect(raw.data.id).toBe('PAYLOAD-ID');
  });

  it('POSITIVE CONTROL — a non-colliding record field passes through the snapshot unaffected', async () => {
    const runner = new QuickJSScriptRunner();
    const factory = hookBodyRunnerFactory(runner, { ql: {}, appId: 'crm' });
    const fn = factory({
      name: 'control_probe',
      object: 'case',
      events: ['beforeUpdate'],
      body: {
        language: 'js',
        source: 'return { observed_subject: ctx.input.subject };',
        capabilities: [],
      },
    } as any);

    const wrapped = wrapDeclarativeHook(
      { name: 'wrap_control_probe', object: 'case', event: 'beforeUpdate' } as any,
      (async (ctx: any) => { await fn!(ctx); }) as any,
      { logger: silentLogger },
    );

    const raw: any = { data: { id: 'PAYLOAD-ID', subject: 'help' }, options: {}, id: 'WRAPPER-ID' };
    await wrapped({ object: 'case', event: 'beforeUpdate', input: raw } as any);

    expect(raw.data.observed_subject).toBe('help');
  });
});

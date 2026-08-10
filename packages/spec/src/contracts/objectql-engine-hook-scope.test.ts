// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5928] The `objectql` slot's hook-registration contract carries BOTH scope
 * faces.
 *
 * `IObjectQLEngine.registerHook` is the declaration consumers outside
 * `packages/objectql` program against — it is how a plugin knows what it may
 * pass without reaching for `any`. Until #5928 it declared one face, `object`,
 * an allow list; "global, except these objects" had no spelling, which is what
 * blocked the audit plugin from moving its skip list out of the handler and onto
 * the registration where the #5038 / #5284 per-object gates can read it.
 *
 * The declaration and the engine that implements it move in ONE PR on purpose:
 * shipping this half alone would leave `packages/spec` advertising an option the
 * engine ignores — a declared-but-unenforced window, the failure this repo keeps
 * paying to close.
 *
 * The behaviour itself (`matches = allowMatches && !excludeMatches`, the refused
 * shapes, the gate-vs-dispatch property) is pinned in
 * `packages/objectql/src/hook-exclude-objects.test.ts`: only objectql can
 * execute a dispatch, and spec must not depend on it. What is assertable HERE is
 * the shape of the contract, so that is all this file claims.
 */

import { describe, it, expect } from 'vitest';
import type { IObjectQLEngine } from './objectql-engine';

/**
 * Exact type equality. Written as a VALUE assertion below (`const x: Equals<…> =
 * true`) rather than the bare `type _X = Expect<…>` alias the older contract
 * tests use: an unused type alias is a `noUnusedLocals` error under
 * `tsconfig.test.json`, which is why those files carry measured entries in
 * `test-typecheck-debt.json`. That ledger is shrink-only, so a new file earns
 * its way in by having no errors at all.
 */
type Equals<A, B> = (<G>() => G extends A ? 1 : 2) extends (<G>() => G extends B ? 1 : 2) ? true : false;

type RegisterHookOptions = NonNullable<Parameters<IObjectQLEngine['registerHook']>[2]>;

describe('[#5928] IObjectQLEngine.registerHook scope faces', () => {
  it('declares `excludeObjects` in both accepted spellings', () => {
    // Fails to COMPILE if the declared type is anything else — `true` is not
    // assignable to `false`.
    const declared: Equals<
      RegisterHookOptions['excludeObjects'], string | string[] | undefined
    > = true;
    // Mirrors `object` exactly — one vocabulary for both faces, so a caller
    // never has to remember that one takes a list and the other a single name.
    const mirrorsAllowFace: Equals<
      RegisterHookOptions['excludeObjects'], RegisterHookOptions['object']
    > = true;

    expect(declared).toBe(true);
    expect(mirrorsAllowFace).toBe(true);
  });

  it('keeps the option optional — an allow-only registration stays legal', () => {
    // Every registration that compiled before #5928 still compiles: the face is
    // additive, and absent means "subtract nothing".
    const allowOnly: RegisterHookOptions = { object: 'account', priority: 50 };
    const global: RegisterHookOptions = {};
    expect(allowOnly.excludeObjects).toBeUndefined();
    expect(global.excludeObjects).toBeUndefined();
  });

  it('admits the shape the audit plugin needs — global minus a static list', () => {
    // The registration #5860 is blocked on: no `object`, so global, minus the
    // platform tables the writer must not recurse into.
    const auditScope: RegisterHookOptions = {
      excludeObjects: ['sys_audit_log', 'sys_job', 'sys_metadata'],
      packageId: 'plugin-audit',
    };
    expect(auditScope.excludeObjects).toHaveLength(3);

    // …and the explicit-wildcard spelling of the same intent.
    const starred: RegisterHookOptions = { object: '*', excludeObjects: 'sys_audit_log' };
    expect(starred.excludeObjects).toBe('sys_audit_log');
  });

  it('is satisfiable by an implementation typed against the contract', () => {
    // A structural check that the widened options do not break implementors:
    // this is how a host or a test double declares the member.
    const calls: Array<{ event: string; excludeObjects?: string | string[] }> = [];
    const registerHook: IObjectQLEngine['registerHook'] = (event, _handler, options) => {
      calls.push({ event, excludeObjects: options?.excludeObjects });
    };

    registerHook('afterUpdate', () => {}, { excludeObjects: ['sys_audit_log'] });
    registerHook('afterInsert', () => {});

    expect(calls).toEqual([
      { event: 'afterUpdate', excludeObjects: ['sys_audit_log'] },
      { event: 'afterInsert', excludeObjects: undefined },
    ]);
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// ADR-0103 — engine-owned write guard for the `engine-owned` / `append-only` buckets.
// #3355 — `system` left this guard in v17: it was renamed `system-data` with a
// WRITABLE default, which puts it with `platform` / `config` on the unguarded side.

import { describe, it, expect } from 'vitest';
import { assertEngineOwnedWriteAllowed, ENGINE_OWNED_BUCKETS } from './system-write-guard.js';
import { isPermissionDeniedError } from './errors.js';

// A real user, not system-elevated → a user-context write.
const USER_CTX = { userId: 'u1', isSystem: false };
// System-elevated (plugin/boot/import) → bypasses.
const SYSTEM_CTX = { userId: 'u1', isSystem: true };
// No session (raw-engine / transaction context) → bypasses.
const CONTEXTLESS = { transaction: {} };

const engineOwned = { name: 'sys_automation_run', managedBy: 'engine-owned' };
const appendOnly = { name: 'sys_audit_log', managedBy: 'append-only' };
// #3355 — the platform tables that used to be `system` + a `userActions` re-open
// block. They now sit in `system-data`, which this guard does not cover at all;
// the pin below asserts they pass for the NEW reason (out of scope) as well as
// they passed for the old one (userActions opened the verb).
const systemData = { name: 'sys_user_position', managedBy: 'system-data' };
// An `append-only` member that opens a verb — the in-scope bucket still honours
// `userActions`, which is what keeps this guard affordance-keyed, not name-keyed.
const writable = {
  name: 'sys_audit_note',
  managedBy: 'append-only',
  userActions: { create: true, edit: true, delete: true },
};

/** Assert a call throws a PERMISSION_DENIED (403) error. */
function expectDenied(fn: () => void): void {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown, 'expected a PermissionDeniedError to be thrown').toBeDefined();
  expect(isPermissionDeniedError(thrown)).toBe(true);
  expect((thrown as any).statusCode).toBe(403);
}

describe('assertEngineOwnedWriteAllowed (ADR-0103)', () => {
  it('scopes to the engine-owned and append-only buckets', () => {
    expect([...ENGINE_OWNED_BUCKETS].sort()).toEqual(['append-only', 'engine-owned']);
  });

  // #3355 pin: the retired bucket must not linger in the guard's scope set, and
  // its successor must not be added to it. A writable-default bucket has nothing
  // to fail closed on, and listing it would deny the very writes it exists to allow.
  it('scopes out the retired `system` bucket and its `system-data` successor', () => {
    expect(ENGINE_OWNED_BUCKETS.has('system')).toBe(false);
    expect(ENGINE_OWNED_BUCKETS.has('system-data')).toBe(false);
  });

  describe('engine-owned / append-only objects', () => {
    it('rejects user-context insert/update/delete on an explicit engine-owned object', () => {
      for (const op of ['insert', 'update', 'delete', 'upsert', 'purge', 'transfer', 'restore']) {
        expectDenied(() => assertEngineOwnedWriteAllowed(engineOwned, op, USER_CTX));
      }
    });

    it('rejects user-context writes to append-only objects too', () => {
      expectDenied(() => assertEngineOwnedWriteAllowed(appendOnly, 'update', USER_CTX));
      expectDenied(() => assertEngineOwnedWriteAllowed(appendOnly, 'delete', USER_CTX));
    });

    it('allows reads (find/findOne/count/aggregate) even under user context', () => {
      for (const op of ['find', 'findOne', 'count', 'aggregate', 'get', 'list']) {
        expect(() => assertEngineOwnedWriteAllowed(engineOwned, op, USER_CTX)).not.toThrow();
      }
    });

    it('bypasses isSystem-elevated writes', () => {
      for (const op of ['insert', 'update', 'delete']) {
        expect(() => assertEngineOwnedWriteAllowed(engineOwned, op, SYSTEM_CTX)).not.toThrow();
      }
    });

    it('bypasses context-less engine/service writes (no userId)', () => {
      for (const op of ['insert', 'update', 'delete']) {
        expect(() => assertEngineOwnedWriteAllowed(engineOwned, op, CONTEXTLESS)).not.toThrow();
        expect(() => assertEngineOwnedWriteAllowed(engineOwned, op, undefined)).not.toThrow();
      }
    });

    // #3712 — a schedule-triggered flow run carries only its run id. The guard
    // keys on the PRINCIPAL, so provenance alone reads exactly like no context:
    // the run id neither admits nor refuses a write on its own.
    it('treats a provenance-only context exactly like no context', () => {
      for (const op of ['insert', 'update', 'delete']) {
        expect(() => assertEngineOwnedWriteAllowed(engineOwned, op, { flowRunId: 'run_1' })).not.toThrow();
      }
    });
  });

  describe('the writable set (an in-scope bucket + userActions)', () => {
    it('allows user-context insert/update/delete when userActions opened them', () => {
      for (const op of ['insert', 'update', 'delete']) {
        expect(() => assertEngineOwnedWriteAllowed(writable, op, USER_CTX)).not.toThrow();
      }
    });

    it('allows only the opened verbs — a partial userActions still guards the rest', () => {
      const editOnly = { name: 'sys_thing', managedBy: 'append-only', userActions: { edit: true } };
      expect(() => assertEngineOwnedWriteAllowed(editOnly, 'update', USER_CTX)).not.toThrow();
      expectDenied(() => assertEngineOwnedWriteAllowed(editOnly, 'insert', USER_CTX));
      expectDenied(() => assertEngineOwnedWriteAllowed(editOnly, 'delete', USER_CTX));
    });
  });

  describe('out of scope', () => {
    // #3355 equivalence pin. `sys_user_position` passed this guard in v16 because
    // its `userActions` block opened the verb; it passes in v17 because the guard
    // no longer covers its bucket. Same answer, different reason — and this test
    // is what makes "no enforcement moved" a fact rather than an assertion in a
    // PR description. It goes red if `system-data` is ever added to
    // ENGINE_OWNED_BUCKETS (which would deny delegated admin its RBAC writes).
    it('never denies a `system-data` write, with or without userActions', () => {
      for (const op of ['insert', 'update', 'delete', 'upsert', 'transfer', 'restore']) {
        expect(() => assertEngineOwnedWriteAllowed(systemData, op, USER_CTX)).not.toThrow();
        expect(() => assertEngineOwnedWriteAllowed(
          { ...systemData, userActions: { create: true, edit: true, delete: true } },
          op,
          USER_CTX,
        )).not.toThrow();
      }
    });

    it('ignores platform / config / system-data buckets (no guard)', () => {
      for (const bucket of ['platform', 'config', 'system-data']) {
        expect(() =>
          assertEngineOwnedWriteAllowed({ name: 'x', managedBy: bucket }, 'delete', USER_CTX),
        ).not.toThrow();
      }
    });

    it('ignores better-auth (handled by plugin-auth identity guard, not this one)', () => {
      expect(() =>
        assertEngineOwnedWriteAllowed({ name: 'sys_user', managedBy: 'better-auth' }, 'update', USER_CTX),
      ).not.toThrow();
    });

    it('ignores unmanaged objects and unknown schemas', () => {
      expect(() => assertEngineOwnedWriteAllowed({ name: 'crm_lead' }, 'delete', USER_CTX)).not.toThrow();
      expect(() => assertEngineOwnedWriteAllowed(undefined, 'delete', USER_CTX)).not.toThrow();
    });
  });
});

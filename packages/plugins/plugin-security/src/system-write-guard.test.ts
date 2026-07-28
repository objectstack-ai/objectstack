// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// ADR-0103 — engine-owned write guard for the `engine-owned` / `system` / `append-only` buckets.

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
// A `system` object with no userActions still resolves locked → engine-owned.
const lockedSystem = { name: 'sys_thing', managedBy: 'system' };
const appendOnly = { name: 'sys_audit_log', managedBy: 'append-only' };
const writable = {
  name: 'sys_user_position',
  managedBy: 'system',
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
  it('scopes to the engine-owned, system and append-only buckets', () => {
    expect([...ENGINE_OWNED_BUCKETS].sort()).toEqual(['append-only', 'engine-owned', 'system']);
  });

  describe('engine-owned / system / append-only objects', () => {
    it('rejects user-context insert/update/delete on an explicit engine-owned object', () => {
      for (const op of ['insert', 'update', 'delete', 'upsert', 'purge', 'transfer', 'restore']) {
        expectDenied(() => assertEngineOwnedWriteAllowed(engineOwned, op, USER_CTX));
      }
    });

    it('rejects user-context writes to a locked `system` object (no userActions)', () => {
      expectDenied(() => assertEngineOwnedWriteAllowed(lockedSystem, 'insert', USER_CTX));
      expectDenied(() => assertEngineOwnedWriteAllowed(lockedSystem, 'delete', USER_CTX));
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

  describe('the writable set (system + userActions)', () => {
    it('allows user-context insert/update/delete when userActions opened them', () => {
      for (const op of ['insert', 'update', 'delete']) {
        expect(() => assertEngineOwnedWriteAllowed(writable, op, USER_CTX)).not.toThrow();
      }
    });

    it('allows only the opened verbs — a partial userActions still guards the rest', () => {
      const editOnly = { name: 'sys_thing', managedBy: 'system', userActions: { edit: true } };
      expect(() => assertEngineOwnedWriteAllowed(editOnly, 'update', USER_CTX)).not.toThrow();
      expectDenied(() => assertEngineOwnedWriteAllowed(editOnly, 'insert', USER_CTX));
      expectDenied(() => assertEngineOwnedWriteAllowed(editOnly, 'delete', USER_CTX));
    });
  });

  describe('out of scope', () => {
    it('ignores platform / config buckets (no guard)', () => {
      for (const bucket of ['platform', 'config']) {
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

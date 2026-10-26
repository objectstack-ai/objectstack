/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
// `UIActionSchema` — NOT the legacy `ActionSchema` from `crud.ts`, which is
// deprecated, requires `type: 'action'`, and inherits an OPTIONAL `name` from
// `BaseSchema`. `TransactionManager.executeTransaction` takes a
// `(action: UIActionSchema) => …` executor, so the fixtures below have to be
// authored in that vocabulary or they are asserting against a type the
// implementation never sees.
import type { DataSource, ActionResult, UIActionSchema } from '@object-ui/types';
import {
  TransactionManager,
  type TransactionProgressEvent,
} from '../TransactionManager';

function createMockDataSource(): DataSource {
  return {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation((_res, data) =>
      Promise.resolve({ id: 'new-1', ...data }),
    ),
    update: vi.fn().mockImplementation((_res, _id, data) =>
      Promise.resolve({ id: _id, ...data }),
    ),
    delete: vi.fn().mockResolvedValue(true),
    getObjectSchema: vi.fn().mockResolvedValue({}),
  };
}

function makeAction(name: string): UIActionSchema {
  return { name, label: name, type: 'script' };
}

function makeExecutor(results: Record<string, ActionResult>): (action: UIActionSchema) => Promise<ActionResult> {
  return async (action) => results[action.name] || { success: true };
}

describe('TransactionManager', () => {
  let ds: DataSource;
  let manager: TransactionManager;

  beforeEach(() => {
    ds = createMockDataSource();
    manager = new TransactionManager(ds, { maxRetries: 2, retryDelay: 10 });
  });

  describe('executeTransaction', () => {
    it('should execute all actions successfully', async () => {
      const executor = makeExecutor({
        'step1': { success: true, data: { id: 1 } },
        'step2': { success: true, data: { id: 2 } },
      });

      const result = await manager.executeTransaction(
        {
          name: 'test-txn',
          actions: [makeAction('step1'), makeAction('step2')],
        },
        executor,
      );

      expect(result.success).toBe(true);
      expect(result.actionResults).toHaveLength(2);
      expect(result.rolledBack).toBeUndefined();
    });

    it('should return failure and mark as rolled back on action failure', async () => {
      const executor = makeExecutor({
        'step1': { success: true },
        'step2': { success: false, error: 'Step 2 failed' },
      });

      const result = await manager.executeTransaction(
        {
          name: 'failing-txn',
          actions: [makeAction('step1'), makeAction('step2')],
        },
        executor,
      );

      expect(result.success).toBe(false);
      expect(result.rolledBack).toBe(true);
      expect(result.error).toContain('Step 2 failed');
    });

    it('should retry on conflict when configured', async () => {
      let attempts = 0;
      const executor = async () => {
        attempts++;
        if (attempts < 3) {
          return { success: false, error: 'Conflict' };
        }
        return { success: true };
      };

      const result = await manager.executeTransaction(
        {
          name: 'retry-txn',
          actions: [makeAction('conflicting')],
          retryOnConflict: true,
          maxRetries: 3,
        },
        executor,
      );

      expect(result.success).toBe(true);
      expect(attempts).toBe(3);
    });

    it('should emit progress events', async () => {
      const progressEvents: TransactionProgressEvent[] = [];
      manager.onProgress(event => progressEvents.push({ ...event }));

      const executor = makeExecutor({
        'a': { success: true },
        'b': { success: true },
      });

      await manager.executeTransaction(
        {
          name: 'progress-txn',
          actions: [makeAction('a'), makeAction('b')],
        },
        executor,
      );

      expect(progressEvents.length).toBeGreaterThan(0);
      const lastEvent = progressEvents[progressEvents.length - 1];
      expect(lastEvent.completed).toBe(2);
      expect(lastEvent.percentage).toBe(100);
    });

    it('should handle empty actions list', async () => {
      const result = await manager.executeTransaction(
        { name: 'empty', actions: [] },
        async () => ({ success: true }),
      );

      expect(result.success).toBe(true);
      expect(result.actionResults).toHaveLength(0);
    });

    it('should handle executor throwing errors', async () => {
      const executor = async () => {
        throw new Error('Executor crashed');
      };

      const result = await manager.executeTransaction(
        {
          name: 'error-txn',
          actions: [makeAction('crash')],
        },
        executor,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Executor crashed');
    });

    it('should generate unique transaction IDs', async () => {
      const executor = async () => ({ success: true });

      const result1 = await manager.executeTransaction(
        { name: 'txn1', actions: [] },
        executor,
      );
      const result2 = await manager.executeTransaction(
        { name: 'txn2', actions: [] },
        executor,
      );

      expect(result1.transactionId).not.toBe(result2.transactionId);
    });
  });

  describe('Optimistic Updates', () => {
    it('should apply and confirm optimistic updates', () => {
      const update = manager.applyOptimisticUpdate({
        type: 'update',
        resource: 'orders',
        recordId: '123',
        optimisticData: { status: 'completed' },
        previousData: { status: 'pending' },
      });

      expect(update.confirmed).toBe(false);
      expect(update.rolledBack).toBe(false);

      const confirmed = manager.confirmOptimisticUpdate(update.id);
      expect(confirmed).toBe(true);
    });

    it('should rollback optimistic updates and return previous data', () => {
      const previousData = { status: 'pending', amount: 100 };
      const update = manager.applyOptimisticUpdate({
        type: 'update',
        resource: 'orders',
        recordId: '456',
        optimisticData: { status: 'shipped' },
        previousData,
      });

      const restored = manager.rollbackOptimisticUpdate(update.id);
      expect(restored).toEqual(previousData);
    });

    it('should return undefined for unknown update rollback', () => {
      const restored = manager.rollbackOptimisticUpdate('nonexistent');
      expect(restored).toBeUndefined();
    });

    it('should track pending updates', () => {
      manager.applyOptimisticUpdate({
        type: 'create',
        resource: 'items',
        optimisticData: { name: 'New Item' },
      });

      const update2 = manager.applyOptimisticUpdate({
        type: 'update',
        resource: 'items',
        recordId: '1',
        optimisticData: { name: 'Updated' },
      });

      expect(manager.getPendingUpdates()).toHaveLength(2);

      manager.confirmOptimisticUpdate(update2.id);
      expect(manager.getPendingUpdates()).toHaveLength(1);
    });

    it('should clear all optimistic updates', () => {
      manager.applyOptimisticUpdate({
        type: 'create',
        resource: 'items',
        optimisticData: { name: 'test' },
      });

      manager.clearOptimisticUpdates();
      expect(manager.getPendingUpdates()).toHaveLength(0);
    });
  });

  describe('executeBatch', () => {
    it('should process all items successfully', async () => {
      const items = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];

      const result = await manager.executeBatch('items', 'create', items);

      expect(result.success).toBe(true);
      expect(result.succeeded).toBe(3);
      expect(result.failed).toBe(0);
      expect(ds.create).toHaveBeenCalledTimes(3);
    });

    it('should handle update operations', async () => {
      const items = [
        { id: '1', name: 'Updated A' },
        { id: '2', name: 'Updated B' },
      ];

      const result = await manager.executeBatch('items', 'update', items);

      expect(result.success).toBe(true);
      expect(result.succeeded).toBe(2);
      expect(ds.update).toHaveBeenCalledTimes(2);
    });

    it('should handle delete operations', async () => {
      const items = [{ id: '1' }, { id: '2' }];

      const result = await manager.executeBatch('items', 'delete', items);

      expect(result.success).toBe(true);
      expect(result.succeeded).toBe(2);
      expect(ds.delete).toHaveBeenCalledTimes(2);
    });

    it('should report errors for items missing IDs on update', async () => {
      const items = [
        { id: '1', name: 'A' },
        { name: 'B' }, // Missing ID
      ];

      const result = await manager.executeBatch('items', 'update', items);

      expect(result.success).toBe(false);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors[0].error).toContain('Missing ID');
    });

    it('should retry failed operations when configured', async () => {
      let callCount = 0;
      (ds.create as any).mockImplementation(() => {
        callCount++;
        if (callCount <= 2) throw new Error('Temporary failure');
        return Promise.resolve({ id: 'new', name: 'test' });
      });

      const result = await manager.executeBatch(
        'items',
        'create',
        [{ name: 'test' }],
        { retryOnError: true, maxRetries: 3 },
      );

      expect(result.success).toBe(true);
      expect(callCount).toBe(3);
    });

    it('should emit progress events', async () => {
      const progressEvents: TransactionProgressEvent[] = [];

      await manager.executeBatch(
        'items',
        'create',
        [{ name: 'A' }, { name: 'B' }],
        { onProgress: event => progressEvents.push({ ...event }) },
      );

      expect(progressEvents.length).toBeGreaterThan(0);
    });

    it('should try bulk operation first if available', async () => {
      ds.bulk = vi.fn().mockResolvedValue([{ id: '1' }, { id: '2' }]);

      const result = await manager.executeBatch('items', 'create', [
        { name: 'A' },
        { name: 'B' },
      ]);

      expect(result.success).toBe(true);
      expect(ds.bulk).toHaveBeenCalled();
      expect(ds.create).not.toHaveBeenCalled();
    });

    it('should fall back to individual processing when bulk fails', async () => {
      ds.bulk = vi.fn().mockRejectedValue(new Error('Bulk not supported'));

      const result = await manager.executeBatch('items', 'create', [
        { name: 'A' },
      ]);

      expect(result.success).toBe(true);
      expect(ds.create).toHaveBeenCalled();
    });
  });

  describe('Rollback Operations', () => {
    it('should rollback created records on transaction failure', async () => {
      let step = 0;
      // Underscore-prefixed: this executor sequences on the call counter rather
      // than on which action it was handed, and `noUnusedParameters` is on.
      const executor = async (_action: UIActionSchema) => {
        step++;
        if (step === 1) {
          // First action succeeds and records an operation
          manager.recordOperation({
            type: 'create',
            resource: 'orders',
            result: { id: 'created-1' },
          });
          return { success: true };
        }
        return { success: false, error: 'Failed' };
      };

      await manager.executeTransaction(
        { name: 'rollback-test', actions: [makeAction('step1'), makeAction('fail')] },
        executor,
      );

      // The created record should be deleted during rollback
      expect(ds.delete).toHaveBeenCalledWith('orders', 'created-1');
    });

    it('should rollback updated records by restoring previous state', async () => {
      let step = 0;
      const executor = async () => {
        step++;
        if (step === 1) {
          manager.recordOperation({
            type: 'update',
            resource: 'orders',
            id: '100',
            previousState: { status: 'pending' },
          });
          return { success: true };
        }
        return { success: false, error: 'Failed' };
      };

      await manager.executeTransaction(
        { name: 'rollback-update', actions: [makeAction('step1'), makeAction('fail')] },
        executor,
      );

      expect(ds.update).toHaveBeenCalledWith('orders', '100', { status: 'pending' });
    });

    it('should rollback deleted records by re-creating them', async () => {
      let step = 0;
      const executor = async () => {
        step++;
        if (step === 1) {
          manager.recordOperation({
            type: 'delete',
            resource: 'orders',
            id: '200',
            previousState: { id: '200', name: 'Test Order' },
          });
          return { success: true };
        }
        return { success: false, error: 'Failed' };
      };

      await manager.executeTransaction(
        { name: 'rollback-delete', actions: [makeAction('step1'), makeAction('fail')] },
        executor,
      );

      expect(ds.create).toHaveBeenCalledWith('orders', { id: '200', name: 'Test Order' });
    });
  });

  describe('Progress Listener Management', () => {
    it('should support unsubscribe from progress events', async () => {
      const events: TransactionProgressEvent[] = [];
      const unsubscribe = manager.onProgress(e => events.push(e));

      await manager.executeTransaction(
        { name: 'txn', actions: [makeAction('a')] },
        async () => ({ success: true }),
      );

      const count1 = events.length;
      unsubscribe();

      await manager.executeTransaction(
        { name: 'txn2', actions: [makeAction('b')] },
        async () => ({ success: true }),
      );

      expect(events.length).toBe(count1);
    });
  });
});

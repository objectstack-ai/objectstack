/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ActionEngine } from '../ActionEngine';
import type { ActionDef } from '../ActionRunner';

describe('ActionEngine', () => {
  let engine: ActionEngine;

  beforeEach(() => {
    engine = new ActionEngine({ data: { status: 'active' } });
  });

  describe('registerAction', () => {
    it('registers an action by name', () => {
      engine.registerAction({ name: 'save', type: 'api', endpoint: '/save' });
      expect(engine.getAction('save')).toBeDefined();
      expect(engine.getAction('save')?.type).toBe('api');
    });

    it('throws if action has no name or type', () => {
      expect(() => engine.registerAction({} as ActionDef)).toThrow('Action must have a name or type');
    });

    it('registers with locations', () => {
      engine.registerAction(
        { name: 'delete', type: 'api' },
        { locations: ['record_header', 'list_item'] }
      );
      expect(engine.getActionsForLocation('record_header')).toHaveLength(1);
      expect(engine.getActionsForLocation('list_toolbar')).toHaveLength(0);
    });

    it('auto-registers keyboard shortcuts', () => {
      engine.registerAction(
        { name: 'save', type: 'api' },
        { shortcut: 'ctrl+s' }
      );
      expect(engine.getShortcuts()).toHaveLength(1);
      expect(engine.getShortcuts()[0].keys).toBe('ctrl+s');
    });
  });

  describe('registerActions', () => {
    it('registers multiple actions from array', () => {
      engine.registerActions([
        { name: 'save', type: 'api', endpoint: '/save' },
        { name: 'delete', type: 'api', endpoint: '/delete' },
      ]);
      expect(engine.getAction('save')).toBeDefined();
      expect(engine.getAction('delete')).toBeDefined();
    });

    it('does not harvest the retired `shortcut` / `bulkEnabled` keys from metadata', () => {
      // spec 17 retired both as `retiredKey()` tombstones — a declaration
      // carrying either no longer parses, so reading them here made two dead
      // options look load-bearing. A host may still pass them explicitly to
      // `registerAction`; they are just not sourced from authored metadata.
      engine.registerActions([
        { name: 'stale', type: 'api', shortcut: 'ctrl+k', bulkEnabled: true } as never,
      ]);
      expect(engine.getAction('stale')).toBeDefined();
      expect(engine.getShortcuts()).toHaveLength(0);
      expect(engine.getBulkActions().map((a) => a.name)).not.toContain('stale');
    });
  });

  describe('unregisterAction', () => {
    it('removes action and its shortcuts', () => {
      engine.registerAction({ name: 'save', type: 'api' }, { shortcut: 'ctrl+s' });

      engine.unregisterAction('save');

      expect(engine.getAction('save')).toBeUndefined();
      expect(engine.getShortcuts()).toHaveLength(0);
    });
  });

  describe('getActionsForLocation', () => {
    it('returns actions sorted by priority', () => {
      engine.registerAction({ name: 'delete', type: 'api' }, { locations: ['list_toolbar'], priority: 200 });
      engine.registerAction({ name: 'create', type: 'modal' }, { locations: ['list_toolbar'], priority: 10 });
      engine.registerAction({ name: 'export', type: 'api' }, { locations: ['list_toolbar'], priority: 100 });

      const actions = engine.getActionsForLocation('list_toolbar');
      expect(actions).toHaveLength(3);
      expect(actions[0].name).toBe('create');
      expect(actions[1].name).toBe('export');
      expect(actions[2].name).toBe('delete');
    });
  });

  describe('getBulkActions', () => {
    it('returns only bulk-enabled actions', () => {
      engine.registerAction({ name: 'delete', type: 'api' }, { bulkEnabled: true });
      engine.registerAction({ name: 'edit', type: 'modal' }, { bulkEnabled: false });
      
      expect(engine.getBulkActions()).toHaveLength(1);
      expect(engine.getBulkActions()[0].name).toBe('delete');
    });
  });

  describe('handleShortcut', () => {
    it('executes action for matching shortcut', async () => {
      engine.registerAction(
        { name: 'save', type: 'script', target: '"saved"' },
        { shortcut: 'ctrl+s' }
      );

      const result = await engine.handleShortcut('ctrl+s');
      expect(result).not.toBeNull();
      expect(result?.success).toBe(true);
    });

    it('normalizes shortcut key order', async () => {
      engine.registerAction(
        { name: 'save', type: 'script', target: '"saved"' },
        { shortcut: 'ctrl+shift+s' }
      );

      // Different order should still match
      const result = await engine.handleShortcut('shift+ctrl+s');
      expect(result).not.toBeNull();
      expect(result?.success).toBe(true);
    });

    it('returns null for unregistered shortcut', async () => {
      const result = await engine.handleShortcut('ctrl+z');
      expect(result).toBeNull();
    });
  });

  describe('executeBulk', () => {
    it('executes action on multiple records sequentially', async () => {
      engine.registerAction(
        { name: 'approve', type: 'script', target: '"approved"' },
        { bulkEnabled: true }
      );

      const result = await engine.executeBulk('approve', [
        { id: '1', name: 'Record 1' },
        { id: '2', name: 'Record 2' },
      ]);

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(0);
    });

    it('fails if action is not bulk-enabled', async () => {
      engine.registerAction({ name: 'edit', type: 'modal' }, { bulkEnabled: false });

      const result = await engine.executeBulk('edit', [{ id: '1' }]);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toContain('does not support bulk');
    });

    it('fails if action is not found', async () => {
      const result = await engine.executeBulk('nonexistent', [{ id: '1' }]);
      expect(result.results[0].success).toBe(false);
    });
  });

  describe('executeAction', () => {
    it('returns error for unknown action', async () => {
      const result = await engine.executeAction('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Action not found');
    });
  });

  describe('clear', () => {
    it('removes all actions and shortcuts', () => {
      engine.registerAction({ name: 'save', type: 'api' }, { shortcut: 'ctrl+s' });

      engine.clear();
      
      expect(engine.getAction('save')).toBeUndefined();
      expect(engine.getShortcuts()).toHaveLength(0);
    });
  });
});

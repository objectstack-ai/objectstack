/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionRunner, type ActionContext } from '../ActionRunner';

describe('ActionRunner — ParamCollectionHandler', () => {
  let runner: ActionRunner;
  let context: ActionContext;

  beforeEach(() => {
    context = {
      data: { id: 1, name: 'Test' },
      record: { id: 1, status: 'active' },
      user: { id: 'u1', role: 'admin' },
    };
    runner = new ActionRunner(context);
  });

  // ==========================================================================
  // Param collection before execution
  // ==========================================================================

  describe('param collection', () => {
    it('should call paramCollectionHandler when actionParams are defined', async () => {
      const paramHandler = vi.fn().mockResolvedValue({ owner_email: 'alice@example.com' });
      runner.setParamCollectionHandler(paramHandler);

      const onClick = vi.fn();
      await runner.execute({
        onClick,
        actionParams: [
          { name: 'owner_email', label: 'Owner Email', type: 'text', required: true },
        ],
      });

      expect(paramHandler).toHaveBeenCalledOnce();
      expect(paramHandler.mock.calls[0][0]).toEqual([
        { name: 'owner_email', label: 'Owner Email', type: 'text', required: true },
      ]);
      expect(onClick).toHaveBeenCalledOnce();
    });

    it('should cancel action when paramCollectionHandler returns null', async () => {
      const paramHandler = vi.fn().mockResolvedValue(null);
      runner.setParamCollectionHandler(paramHandler);

      const onClick = vi.fn();
      const result = await runner.execute({
        onClick,
        actionParams: [
          { name: 'owner_email', label: 'Owner Email', type: 'text', required: true },
        ],
      });

      expect(paramHandler).toHaveBeenCalledOnce();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Action cancelled by user (params)');
      expect(onClick).not.toHaveBeenCalled();
    });

    it('should merge collected params into action.params', async () => {
      const paramHandler = vi.fn().mockResolvedValue({
        owner_email: 'alice@example.com',
        notify: true,
      });
      runner.setParamCollectionHandler(paramHandler);

      const handler = vi.fn().mockResolvedValue({ success: true });
      runner.registerHandler('custom_action', handler);

      await runner.execute({
        type: 'custom_action',
        params: { existing: 'value' },
        actionParams: [
          { name: 'owner_email', label: 'Owner Email', type: 'text' },
          { name: 'notify', label: 'Notify', type: 'boolean' },
        ],
      });

      expect(handler).toHaveBeenCalledOnce();
      const calledAction = handler.mock.calls[0][0];
      expect(calledAction.params).toEqual({
        existing: 'value',
        owner_email: 'alice@example.com',
        notify: true,
      });
    });

    it('should skip param collection when no paramCollectionHandler is set', async () => {
      const onClick = vi.fn();
      const result = await runner.execute({
        onClick,
        actionParams: [
          { name: 'test', label: 'Test', type: 'text' },
        ],
      });

      // Should proceed normally without param collection
      expect(result.success).toBe(true);
      expect(onClick).toHaveBeenCalledOnce();
    });

    it('should skip param collection when actionParams is empty', async () => {
      const paramHandler = vi.fn();
      runner.setParamCollectionHandler(paramHandler);

      const onClick = vi.fn();
      await runner.execute({
        onClick,
        actionParams: [],
      });

      expect(paramHandler).not.toHaveBeenCalled();
      expect(onClick).toHaveBeenCalledOnce();
    });

    it('should skip param collection when actionParams is not provided', async () => {
      const paramHandler = vi.fn();
      runner.setParamCollectionHandler(paramHandler);

      const onClick = vi.fn();
      await runner.execute({ onClick });

      expect(paramHandler).not.toHaveBeenCalled();
      expect(onClick).toHaveBeenCalledOnce();
    });
  });
});

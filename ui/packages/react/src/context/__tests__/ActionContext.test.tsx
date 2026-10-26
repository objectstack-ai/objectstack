/**
 * Tests for ActionContext — ActionProvider, useAction, useHasActionProvider
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { ActionProvider, useAction, useHasActionProvider } from '../ActionContext';

describe('ActionContext', () => {
  describe('useAction without ActionProvider', () => {
    it('falls back to local ActionRunner with default state', () => {
      const { result } = renderHook(() => useAction());

      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.result).toBeNull();
      expect(typeof result.current.execute).toBe('function');
      expect(typeof result.current.executeChain).toBe('function');
      expect(typeof result.current.updateContext).toBe('function');
      expect(result.current.runner).toBeDefined();
    });
  });

  describe('useHasActionProvider', () => {
    it('returns false without provider', () => {
      const { result } = renderHook(() => useHasActionProvider());

      expect(result.current).toBe(false);
    });

    it('returns true with provider', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(ActionProvider, { context: {}, children });

      const { result } = renderHook(() => useHasActionProvider(), { wrapper });

      expect(result.current).toBe(true);
    });
  });

  describe('ActionProvider basic', () => {
    it('children can access execute function', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(ActionProvider, { context: {}, children });

      const { result } = renderHook(() => useAction(), { wrapper });

      expect(typeof result.current.execute).toBe('function');
      expect(typeof result.current.executeChain).toBe('function');
      expect(typeof result.current.updateContext).toBe('function');
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.result).toBeNull();
    });
  });

  describe('ActionProvider execute', () => {
    it('executes a toast action and returns result', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(ActionProvider, { context: {}, children });

      const { result } = renderHook(() => useAction(), { wrapper });

      let actionResult: any;
      await act(async () => {
        actionResult = await result.current.execute({
          type: 'script',
          target: 'true',
          toast: { showOnSuccess: true },
          successMessage: 'Done!',
        });
      });

      expect(actionResult.success).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.result).toEqual(actionResult);
      expect(result.current.error).toBeNull();
    });
  });

  describe('ActionProvider execute error', () => {
    it('executes an action that fails and sets error state', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(ActionProvider, { context: {}, children });

      const { result } = renderHook(() => useAction(), { wrapper });

      let actionResult: any;
      await act(async () => {
        actionResult = await result.current.execute({
          onClick: vi.fn().mockRejectedValue(new Error('boom')),
        });
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(actionResult.success).toBe(false);
      expect(result.current.error).toBeTruthy();
      expect(result.current.result?.success).toBe(false);
    });
  });

  describe('ActionProvider executeChain', () => {
    it('executes a chain of actions', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(ActionProvider, { context: {}, children });

      const { result } = renderHook(() => useAction(), { wrapper });

      let chainResult: any;
      await act(async () => {
        chainResult = await result.current.executeChain([
          { type: 'script', target: 'true' },
          { type: 'script', target: 'true' },
        ]);
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(chainResult.success).toBe(true);
      expect(result.current.result).toEqual(chainResult);
      expect(result.current.error).toBeNull();
    });
  });

  describe('ActionProvider updateContext', () => {
    it('updateContext is callable', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(ActionProvider, { context: {}, children });

      const { result } = renderHook(() => useAction(), { wrapper });

      expect(() => {
        result.current.updateContext({ record: { id: 1 } });
      }).not.toThrow();
    });
  });

  describe('ActionProvider with handlers', () => {
    it('invokes onToast handler when a toast action is executed', async () => {
      const onToast = vi.fn();
      const onNavigate = vi.fn();

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(ActionProvider, {
          context: {},
          onToast,
          onNavigate,
          children,
        });

      const { result } = renderHook(() => useAction(), { wrapper });

      await act(async () => {
        await result.current.execute({
          type: 'script',
          target: 'true',
          toast: { showOnSuccess: true },
          successMessage: 'Saved!',
        });
      });

      expect(onToast).toHaveBeenCalledWith('Saved!', expect.objectContaining({ type: 'success' }));
    });
  });
});

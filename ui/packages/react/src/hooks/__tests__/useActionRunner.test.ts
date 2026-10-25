/**
 * Tests for useActionRunner hook
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useActionRunner } from '../useActionRunner';

describe('useActionRunner', () => {
  it('returns initial state with loading=false, error=null, result=null', () => {
    const { result } = renderHook(() => useActionRunner());

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.result).toBeNull();
  });

  it('exposes runner, execute, and updateContext', () => {
    const { result } = renderHook(() => useActionRunner());

    expect(result.current.runner).toBeDefined();
    expect(typeof result.current.execute).toBe('function');
    expect(typeof result.current.updateContext).toBe('function');
  });

  it('handles options with context key format', () => {
    const { result } = renderHook(() =>
      useActionRunner({ context: { data: { name: 'test' } } }),
    );

    expect(result.current.runner).toBeDefined();
    expect(result.current.loading).toBe(false);
  });

  it('handles plain context object format (backwards compat)', () => {
    const { result } = renderHook(() =>
      useActionRunner({ data: { name: 'test' } }),
    );

    expect(result.current.runner).toBeDefined();
    expect(result.current.loading).toBe(false);
  });

  it('sets loading=true during execution and loading=false after', async () => {
    let resolveAction: () => void;
    const pendingAction = new Promise<void>((resolve) => {
      resolveAction = resolve;
    });

    const { result } = renderHook(() => useActionRunner());

    let executePromise: Promise<unknown>;
    act(() => {
      executePromise = result.current.execute({
        onClick: () => pendingAction,
      });
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });

    await act(async () => {
      resolveAction!();
      await executePromise;
    });

    expect(result.current.loading).toBe(false);
  });

  it('sets result on successful action execution', async () => {
    const onNavigate = vi.fn();
    const { result } = renderHook(() =>
      useActionRunner({ context: {}, onNavigate }),
    );

    await act(async () => {
      await result.current.execute({
        type: 'navigation',
        navigate: { to: '/dashboard' },
      });
    });

    // A navigation succeeds silently: it announces no toast (objectui#12755).
    expect(result.current.result).toEqual({ success: true, silent: true });
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(onNavigate).toHaveBeenCalledWith(
      '/dashboard',
      expect.objectContaining({ external: false }),
    );
  });

  it('sets error on failed action execution (catch path)', async () => {
    const { result } = renderHook(() => useActionRunner());

    await act(async () => {
      await result.current.execute({
        onClick: () => {
          throw new Error('Something went wrong');
        },
      });
    });

    expect(result.current.error).toBe('Something went wrong');
    expect(result.current.result).toEqual({
      success: false,
      error: 'Something went wrong',
    });
    expect(result.current.loading).toBe(false);
  });

  it('updateContext calls runner.updateContext', () => {
    const { result } = renderHook(() => useActionRunner());

    const spy = vi.spyOn(result.current.runner, 'updateContext');

    act(() => {
      result.current.updateContext({ data: { id: 42 } });
    });

    expect(spy).toHaveBeenCalledWith({ data: { id: 42 } });
  });

  it('accepts handler options (onToast, onNavigate, etc.)', async () => {
    const onToast = vi.fn();
    const onNavigate = vi.fn();

    const { result } = renderHook(() =>
      useActionRunner({
        context: {},
        onToast,
        onNavigate,
      }),
    );

    await act(async () => {
      await result.current.execute({
        type: 'navigation',
        navigate: { to: '/settings' },
        successMessage: 'Navigated!',
      });
    });

    expect(onNavigate).toHaveBeenCalledWith(
      '/settings',
      expect.objectContaining({ external: false }),
    );
    expect(onToast).toHaveBeenCalledWith(
      'Navigated!',
      expect.objectContaining({ type: 'success' }),
    );
  });
});

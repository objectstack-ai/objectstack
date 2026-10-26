/**
 * objectui#10193 (ruling B) — `SessionUserScope.adopt` REPORTS that it dropped
 * a previous owner's state, so the owner of state derived from that storage in
 * memory (the UI language) can re-derive it.
 *
 * Asserted three ways, because each has a different reader: the return value
 * (the direct caller), the subscription (a live listener), and the count (a
 * reader that mounts after the purge and must still see it).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSessionOwnerChangeCount, subscribeSessionOwnerChange } from '../index';
import { SessionUserScope } from '../ActiveOrganizationStorage';

const POINTER_KEY = 'auth-session-user-id';

beforeEach(() => {
  localStorage.clear();
  SessionUserScope._resetForTests();
});

describe('adopt reports an owner change', () => {
  it('reports a change of owner by return value, subscription and count', () => {
    localStorage.setItem(POINTER_KEY, 'u_a');
    const before = getSessionOwnerChangeCount();
    const listener = vi.fn(() => {
      // Notified after the adopt settled: the arriving owner is current and
      // the previous owner's storage is already gone.
      expect(SessionUserScope.current()).toBe('u_b');
      expect(localStorage.getItem('objectui-locale-seed')).toBeNull();
    });
    localStorage.setItem('objectui-locale-seed', 'ja');
    const unsubscribe = subscribeSessionOwnerChange(listener);

    expect(SessionUserScope.adopt('u_b')).toBe(true);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSessionOwnerChangeCount()).toBe(before + 1);
    unsubscribe();
  });

  it.each([
    ['a first-ever owner (no pointer persisted)', null, 'u_a'],
    ['the same owner again', 'u_a', 'u_a'],
  ])('reports nothing for %s', (_label, pointer, arriving) => {
    if (pointer) localStorage.setItem(POINTER_KEY, pointer);
    const before = getSessionOwnerChangeCount();
    const listener = vi.fn();
    const unsubscribe = subscribeSessionOwnerChange(listener);

    expect(SessionUserScope.adopt(arriving)).toBe(false);

    expect(listener).not.toHaveBeenCalled();
    expect(getSessionOwnerChangeCount()).toBe(before);
    unsubscribe();
  });

  it('an unsubscribed listener hears nothing, and a throwing one does not break adopt', () => {
    localStorage.setItem(POINTER_KEY, 'u_a');
    const gone = vi.fn();
    subscribeSessionOwnerChange(gone)();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unsubscribe = subscribeSessionOwnerChange(() => {
      throw new Error('listener bug');
    });

    expect(() => SessionUserScope.adopt('u_b')).not.toThrow();
    expect(SessionUserScope.current()).toBe('u_b');
    expect(gone).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    unsubscribe();
    warn.mockRestore();
  });
});

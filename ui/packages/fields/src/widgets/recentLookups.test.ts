import { describe, it, expect, beforeEach } from 'vitest';
import { getRecentLookupIds, pushRecentLookupId } from './recentLookups';

describe('recentLookups', () => {
  beforeEach(() => localStorage.clear());

  it('returns [] when nothing stored', () => {
    expect(getRecentLookupIds('acc')).toEqual([]);
  });

  it('stores and returns ids most-recent-first', () => {
    pushRecentLookupId('acc', 'a');
    pushRecentLookupId('acc', 'b');
    expect(getRecentLookupIds('acc')).toEqual(['b', 'a']);
  });

  it('de-dupes and moves a re-picked id to the front', () => {
    pushRecentLookupId('acc', 'a');
    pushRecentLookupId('acc', 'b');
    pushRecentLookupId('acc', 'a');
    expect(getRecentLookupIds('acc')).toEqual(['a', 'b']);
  });

  it('caps at 5 entries', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) pushRecentLookupId('acc', id);
    const ids = getRecentLookupIds('acc');
    expect(ids).toHaveLength(5);
    expect(ids[0]).toBe('g');
    expect(ids).not.toContain('a');
  });

  it('scopes per object name', () => {
    pushRecentLookupId('acc', 'a');
    pushRecentLookupId('prod', 'x');
    expect(getRecentLookupIds('acc')).toEqual(['a']);
    expect(getRecentLookupIds('prod')).toEqual(['x']);
  });

  it('ignores empty/nullish ids and object names', () => {
    pushRecentLookupId('acc', '');
    pushRecentLookupId('acc', null);
    pushRecentLookupId('', 'a');
    expect(getRecentLookupIds('acc')).toEqual([]);
  });
});

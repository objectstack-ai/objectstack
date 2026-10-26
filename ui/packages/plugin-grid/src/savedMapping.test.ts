import { describe, it, expect } from 'vitest';
import {
  asSavedMapping, buildSourceRows, summarizeSavedMapping, savedMappingToDisplayIndexMap,
  type SavedMapping,
} from './savedMapping';

const M: SavedMapping = {
  name: 'inquiry_feed',
  label: 'Inquiry feed',
  targetObject: 'inquiry',
  sourceFormat: 'csv',
  fieldMapping: [
    { source: 'Full Name', target: 'name' },
    { source: 'Channel', target: 'source', transform: 'map', params: { valueMap: { Web: 'website' } } },
    { source: ['City', 'Street'], target: 'address', transform: 'join', params: { separator: ', ' } },
    { source: 'ignored', target: 'tier', transform: 'constant', params: { value: 'gold' } },
  ],
  mode: 'upsert',
  upsertKey: ['email'],
};

describe('asSavedMapping', () => {
  it('accepts a well-formed mapping and rejects junk', () => {
    expect(asSavedMapping(M)).toBe(M);
    expect(asSavedMapping({ name: 'x' })).toBeNull();
    expect(asSavedMapping({ name: 'x', targetObject: 'o' })).toBeNull(); // no fieldMapping
    expect(asSavedMapping(null)).toBeNull();
    expect(asSavedMapping('nope')).toBeNull();
  });
});

describe('buildSourceRows', () => {
  it('keys rows by SOURCE header (all columns, raw), applying corrections', () => {
    const headers = ['Full Name', 'Channel', 'Junk'];
    const rows = [['Ada', 'Web', 'drop'], ['Bob', 'Ref', 'drop2']];
    const corrections = { 1: { 1: 'Referral' } }; // row 1, col 1 fixed
    expect(buildSourceRows(headers, rows, corrections)).toEqual([
      { 'Full Name': 'Ada', Channel: 'Web', Junk: 'drop' },
      { 'Full Name': 'Bob', Channel: 'Referral', Junk: 'drop2' },
    ]);
  });

  it('skips blank header columns', () => {
    expect(buildSourceRows(['A', ''], [['1', '2']], {})).toEqual([{ A: '1' }]);
  });
});

describe('summarizeSavedMapping', () => {
  it('renders source → target (transform) per entry, joining arrays', () => {
    expect(summarizeSavedMapping(M)).toEqual([
      { source: 'Full Name', target: 'name', transform: '' },
      { source: 'Channel', target: 'source', transform: 'map' },
      { source: 'City + Street', target: 'address', transform: 'join' },
      { source: 'ignored', target: 'tier', transform: 'constant' },
    ]);
  });
});

describe('savedMappingToDisplayIndexMap', () => {
  it('maps single-source rename/transform entries to column indices, case-insensitively', () => {
    const headers = ['full name', 'CHANNEL', 'extra'];
    // 'Full Name'→name (idx 0), 'Channel'→source (idx 1); join/constant omitted.
    expect(savedMappingToDisplayIndexMap(M, headers)).toEqual({ 0: 'name', 1: 'source' });
  });

  it('omits entries whose source header is absent from the file', () => {
    expect(savedMappingToDisplayIndexMap(M, ['nothing'])).toEqual({});
  });
});

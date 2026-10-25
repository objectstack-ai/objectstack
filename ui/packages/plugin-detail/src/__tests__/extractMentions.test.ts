import { describe, it, expect } from 'vitest';
import { extractMentions } from '../extractMentions';

describe('extractMentions', () => {
  const suggestions = [
    { id: 'u1', label: 'QA Test' },
    { id: 'u2', label: 'Alice' },
    { id: 'u3', label: 'Anna Lee' },
    { id: 'u4', label: 'Anna' },
    { id: 'u5', label: '王小明' },
  ];

  it('returns [] for empty text or empty suggestions', () => {
    expect(extractMentions('', suggestions)).toEqual([]);
    expect(extractMentions('hi @Alice', [])).toEqual([]);
  });

  it('resolves a single @label', () => {
    expect(extractMentions('hey @Alice please look', suggestions)).toEqual([
      'u2',
    ]);
  });

  it('handles labels containing spaces', () => {
    expect(extractMentions('cc @QA Test fyi', suggestions)).toEqual(['u1']);
  });

  it('prefers longest match (Anna Lee over Anna)', () => {
    const r = extractMentions('@Anna Lee ping', suggestions);
    expect(r).toContain('u3');
    expect(r).not.toContain('u4');
  });

  it('still matches @Anna alone', () => {
    expect(extractMentions('@Anna ping', suggestions)).toEqual(['u4']);
  });

  it('does not match partial prefixes', () => {
    expect(extractMentions('@AliceWonderland', suggestions)).toEqual([]);
  });

  it('handles CJK labels', () => {
    expect(extractMentions('@王小明 看一下', suggestions)).toEqual(['u5']);
  });

  it('de-duplicates repeated mentions', () => {
    expect(extractMentions('@Alice and @Alice', suggestions)).toEqual(['u2']);
  });

  it('ignores unknown @tokens', () => {
    expect(extractMentions('@stranger hi @Alice', suggestions)).toEqual(['u2']);
  });
});

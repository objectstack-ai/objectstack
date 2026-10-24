import { describe, expect, it } from 'vitest';
import { matchAiChatShortcut } from '../AiChatPage';

const ev = (over: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }>) => ({
  key: 'o',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
});

describe('matchAiChatShortcut', () => {
  it('maps ⌘⇧O and Ctrl⇧O to new-chat', () => {
    expect(matchAiChatShortcut(ev({ key: 'O', metaKey: true, shiftKey: true }))).toBe('new-chat');
    expect(matchAiChatShortcut(ev({ key: 'o', ctrlKey: true, shiftKey: true }))).toBe('new-chat');
  });

  it('maps ⌘⇧S to toggle-list', () => {
    expect(matchAiChatShortcut(ev({ key: 'S', metaKey: true, shiftKey: true }))).toBe('toggle-list');
  });

  it('requires the shift modifier', () => {
    expect(matchAiChatShortcut(ev({ key: 'o', metaKey: true }))).toBeNull();
    expect(matchAiChatShortcut(ev({ key: 's', ctrlKey: true }))).toBeNull();
  });

  it('requires a ⌘/Ctrl modifier and rejects Alt', () => {
    expect(matchAiChatShortcut(ev({ key: 'o', shiftKey: true }))).toBeNull();
    expect(matchAiChatShortcut(ev({ key: 'o', metaKey: true, shiftKey: true, altKey: true }))).toBeNull();
  });

  it('ignores unrelated keys', () => {
    expect(matchAiChatShortcut(ev({ key: 'k', metaKey: true, shiftKey: true }))).toBeNull();
  });
});

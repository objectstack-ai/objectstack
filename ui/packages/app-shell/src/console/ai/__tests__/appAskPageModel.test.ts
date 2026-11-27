// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37788 — the AI inquiry page's rules that need no React (ui
 * ADR-0057 Amendment A4): which navigation entry is the page's, the copy its
 * `params` declare and the neutral fallback, the conversation key, and which
 * conversation an address may restore.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { AI_CHAT_COMPONENT_REF } from '@objectstack/spec/ui';
import {
  askPageConversationScope,
  askPageCreateMetadata,
  conversationBelongsToAskPage,
  findAiChatNavEntry,
  readAiChatPageCopy,
  recentAskPageConversations,
  MAX_ASK_RECENT,
} from '../appAskPageModel';
import { componentRefToUrlSegments } from '../../../services/componentRegistry';
import { isAppAskPagePath } from '../../../layout/consoleRoutePaths';

const askEntry = {
  id: 'nav_ask',
  type: 'component',
  label: 'Ask',
  componentRef: AI_CHAT_COMPONENT_REF,
  params: { title: 'Ask about our policies', suggestions: ['How do I apply?'] },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('findAiChatNavEntry', () => {
  it('finds the entry in navigation, inside a group', () => {
    const app = {
      navigation: [
        { id: 'nav_home', type: 'object', objectName: 'policy' },
        { id: 'grp', type: 'group', children: [askEntry] },
      ],
    };
    expect(findAiChatNavEntry(app)?.id).toBe('nav_ask');
  });

  it('finds the entry in an area when the top navigation has none', () => {
    const app = { navigation: [], areas: [{ id: 'a1', navigation: [] }, { id: 'a2', navigation: [askEntry] }] };
    expect(findAiChatNavEntry(app)?.id).toBe('nav_ask');
  });

  it('ignores other component entries; no entry is undefined', () => {
    const app = { navigation: [{ id: 'x', type: 'component', componentRef: 'metadata:resource' }] };
    expect(findAiChatNavEntry(app)).toBeUndefined();
    expect(findAiChatNavEntry(undefined)).toBeUndefined();
  });
});

describe('readAiChatPageCopy', () => {
  it('reads the declared copy', () => {
    expect(
      readAiChatPageCopy({
        ...askEntry,
        params: {
          title: 'T',
          subtitle: 'S',
          placeholder: 'P',
          suggestions: ['a', 'b', 'c', 'd'],
        },
      }),
    ).toEqual({ title: 'T', subtitle: 'S', placeholder: 'P', suggestions: ['a', 'b', 'c', 'd'] });
  });

  it('an omitted key is absent, so the page falls back to its neutral copy', () => {
    expect(readAiChatPageCopy({ ...askEntry, params: { title: 'Only a title' } })).toEqual({
      title: 'Only a title',
      subtitle: undefined,
      placeholder: undefined,
      suggestions: [],
    });
    expect(readAiChatPageCopy({ ...askEntry, params: undefined })).toEqual({ suggestions: [] });
    expect(readAiChatPageCopy(undefined)).toEqual({ suggestions: [] });
  });

  it('a record the spec refuses declares nothing, and the console says why', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readAiChatPageCopy({ ...askEntry, params: { title: 'T', agent: 'build' } })).toEqual({ suggestions: [] });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('the conversation key and its app', () => {
  it('keys the thread app:PKG:ask, never the drawer\'s product-only key', () => {
    expect(askPageConversationScope('com.acme.policy')).toBe('app:com.acme.policy:ask');
    expect(askPageCreateMetadata('com.acme.policy')).toEqual({ activePackageId: 'com.acme.policy' });
  });

  it('restores only a conversation this app\'s page created', () => {
    expect(conversationBelongsToAskPage({ metadata: { activePackageId: 'com.acme.policy' } }, 'com.acme.policy')).toBe(true);
    expect(conversationBelongsToAskPage({ metadata: { activePackageId: 'com.other' } }, 'com.acme.policy')).toBe(false);
    expect(conversationBelongsToAskPage({}, 'com.acme.policy')).toBe(false);
    expect(conversationBelongsToAskPage(null, 'com.acme.policy')).toBe(false);
  });
});

describe('isAppAskPagePath', () => {
  it('spells the ai:chat component route', () => {
    const segments = componentRefToUrlSegments(AI_CHAT_COMPONENT_REF).join('/');
    expect(isAppAskPagePath(`/apps/brightrule/component/${segments}`)).toBe(true);
    expect(isAppAskPagePath('/apps/brightrule/component/ai/chat/')).toBe(true);
    expect(isAppAskPagePath('/apps/brightrule/component/metadata/resource')).toBe(false);
    expect(isAppAskPagePath('/apps/brightrule/policy')).toBe(false);
    expect(isAppAskPagePath('/ai')).toBe(false);
  });
});

describe('recentAskPageConversations (objectstack#37790)', () => {
  const PKG = 'com.acme.policy';
  const ours = (id: string) => ({ id, metadata: { activePackageId: PKG } });

  it('keeps only the rows this app\'s page created, in the order given', () => {
    const rows = [
      ours('a'),
      { id: 'other-app', metadata: { activePackageId: 'com.other' } },
      { id: 'drawer' },
      { id: 'drawer-meta', metadata: { surface: 'drawer' } },
      ours('b'),
    ];
    expect(recentAskPageConversations(rows, PKG).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('lists at most the newest few', () => {
    const rows = Array.from({ length: MAX_ASK_RECENT + 3 }, (_, i) => ours(`c${i}`));
    const recent = recentAskPageConversations(rows, PKG);
    expect(recent).toHaveLength(MAX_ASK_RECENT);
    expect(recent[0].id).toBe('c0');
  });

  it('is empty when no row is this app\'s', () => {
    expect(recentAskPageConversations([{ id: 'drawer' }], PKG)).toEqual([]);
    expect(recentAskPageConversations([], PKG)).toEqual([]);
  });
});

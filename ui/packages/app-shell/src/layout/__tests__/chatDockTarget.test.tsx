/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#34608 (ui ADR-0057 as amended) — the drawer's target: the old
 * full-page chat addresses parse into what the drawer shows (acceptance 4 of
 * the card: an old `/_console/ai/build/ID` link shows that conversation), a
 * target prints back to the address a host without a drawer navigates to, and
 * the per-tab storage round-trips — and never inside a frame (objectstack#26470).
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  aiAddressOf,
  ambientAppPackage,
  dockTargetFollowsApp,
  parseAiAddress,
  placeDockTarget,
  readBuilderHandoffState,
  readStoredDockFullWindow,
  readStoredDockTarget,
  sameDockTarget,
  writeStoredDockFullWindow,
  writeStoredDockTarget,
  DOCK_TARGET_STORAGE_KEY,
} from '../chatDockTarget';

const ownTop = Object.getOwnPropertyDescriptor(window, 'top');

afterEach(() => {
  if (ownTop) Object.defineProperty(window, 'top', ownTop);
  window.sessionStorage.clear();
});

describe('parseAiAddress — the old full-page addresses', () => {
  it('reads the agent and the conversation, under the console mount prefix too', () => {
    expect(parseAiAddress('/_console/ai/build/c-42', '')).toEqual({ agent: 'build', conversationId: 'c-42' });
    expect(parseAiAddress('/ai/ask', '')).toEqual({ agent: 'ask' });
  });

  it('reads ?package= and ?new= (the ADR-0070 "Edit with AI" address)', () => {
    expect(parseAiAddress('/ai/build', '?package=app.crm&new=1')).toEqual({
      agent: 'build',
      packageId: 'app.crm',
      fresh: true,
    });
  });

  it('bare /ai is the ambient thread (no target); the older ?agent= still names the agent', () => {
    expect(parseAiAddress('/ai', '')).toBeUndefined();
    expect(parseAiAddress('/_console/ai', '?agent=ask')).toEqual({ agent: 'ask' });
  });

  it('decodes escaped segments, and keeps a malformed escape as written', () => {
    expect(parseAiAddress('/ai/sales%2Fbot/c%201', '')).toEqual({ agent: 'sales/bot', conversationId: 'c 1' });
    expect(parseAiAddress('/ai/%E0%A4%A', '')).toEqual({ agent: '%E0%A4%A' });
  });
});

describe('aiAddressOf — the address a host without a drawer navigates to', () => {
  const route = (agent: string) => (agent === 'metadata_assistant' ? 'build' : agent);

  it('prints the agent by its route name, the conversation, the package and the fresh flag', () => {
    expect(aiAddressOf({ agent: 'metadata_assistant', conversationId: 'c 1' }, route)).toBe('/ai/build/c%201');
    expect(aiAddressOf({ agent: 'build', packageId: 'app.crm', fresh: true }, route)).toBe(
      '/ai/build?package=app.crm&new=1',
    );
    expect(aiAddressOf(undefined, route)).toBe('/ai');
  });

  it('round-trips through parseAiAddress', () => {
    const target = { agent: 'build', conversationId: 'c-9', packageId: 'app.crm' };
    const [path, search = ''] = aiAddressOf(target, route).split('?');
    expect(parseAiAddress(path, search ? `?${search}` : '')).toEqual(target);
  });
});

describe('the per-tab storage', () => {
  it('round-trips a target and clears on undefined', () => {
    writeStoredDockTarget({ agent: 'build', conversationId: 'c-1', fresh: false });
    expect(readStoredDockTarget()).toEqual({ agent: 'build', conversationId: 'c-1' });
    writeStoredDockTarget(undefined);
    expect(window.sessionStorage.getItem(DOCK_TARGET_STORAGE_KEY)).toBeNull();
    expect(readStoredDockTarget()).toBeUndefined();
  });

  it('reads malformed storage as the ambient thread', () => {
    window.sessionStorage.setItem(DOCK_TARGET_STORAGE_KEY, '{not json');
    expect(readStoredDockTarget()).toBeUndefined();
    window.sessionStorage.setItem(DOCK_TARGET_STORAGE_KEY, JSON.stringify({ agent: 7, handoffPrompt: 'x' }));
    expect(readStoredDockTarget()).toBeUndefined();
  });

  it('round-trips the full-window flag', () => {
    expect(readStoredDockFullWindow()).toBe(false);
    writeStoredDockFullWindow(true);
    expect(readStoredDockFullWindow()).toBe(true);
    writeStoredDockFullWindow(false);
    expect(readStoredDockFullWindow()).toBe(false);
  });

  it('inside a frame it neither reads nor writes the host page’s keys (objectstack#26470)', () => {
    writeStoredDockTarget({ agent: 'ask' });
    writeStoredDockFullWindow(true);
    Object.defineProperty(window, 'top', { configurable: true, get: () => ({}) });
    expect(readStoredDockTarget()).toBeUndefined();
    expect(readStoredDockFullWindow()).toBe(false);
    writeStoredDockTarget({ agent: 'build' });
    writeStoredDockFullWindow(false);
    if (ownTop) Object.defineProperty(window, 'top', ownTop);
    expect(readStoredDockTarget()).toEqual({ agent: 'ask' });
    expect(readStoredDockFullWindow()).toBe(true);
  });
});

describe('sameDockTarget and readBuilderHandoffState', () => {
  it('compares targets by what they name, ignoring absent members', () => {
    expect(sameDockTarget({ agent: 'build', fresh: false }, { agent: 'build' })).toBe(true);
    expect(sameDockTarget(undefined, {})).toBe(true);
    expect(sameDockTarget({ agent: 'build' }, { agent: 'ask' })).toBe(false);
  });

  it('reads only non-empty strings from navigation state', () => {
    expect(readBuilderHandoffState({ handoffPrompt: '  build a CRM ', parentConversationId: 3 })).toEqual({
      handoffPrompt: 'build a CRM',
      parentConversationId: undefined,
    });
    expect(readBuilderHandoffState(null)).toEqual({});
  });
});

describe('a target belongs to an app (objectstack#35014)', () => {
  it('the ambient app is the authorable package; a built-in or no app is app-less', () => {
    expect(ambientAppPackage('app.crm')).toBe('app.crm');
    expect(ambientAppPackage('com.objectstack.setup')).toBeUndefined();
    expect(ambientAppPackage(undefined)).toBeUndefined();
  });

  it('placing stamps the app in view, null outside any app, and never re-stamps', () => {
    expect(placeDockTarget({ agent: 'build', conversationId: 'c1' }, 'app.crm')).toEqual({
      agent: 'build',
      conversationId: 'c1',
      app: 'app.crm',
    });
    expect(placeDockTarget({ agent: 'build' }, undefined)).toEqual({ agent: 'build', app: null });
    expect(placeDockTarget({ agent: 'build', app: 'app.crm' }, 'app.notes')).toEqual({
      agent: 'build',
      app: 'app.crm',
    });
    // A target naming nothing is the ambient thread, wherever it was opened.
    expect(placeDockTarget({}, 'app.crm')).toBeUndefined();
    expect(placeDockTarget({ app: 'app.crm' }, 'app.crm')).toBeUndefined();
    expect(placeDockTarget(undefined, 'app.crm')).toBeUndefined();
  });

  it.each([
    ['opened in the app in view', { conversationId: 'c1', app: 'app.crm' }, 'app.crm', true],
    ['opened in another app', { conversationId: 'c1', app: 'app.crm' }, 'app.notes', false],
    ['opened in an app, now app-less', { conversationId: 'c1', app: 'app.crm' }, undefined, false],
    ['opened app-less, now app-less', { conversationId: 'c1', app: null }, undefined, true],
    ['opened app-less, now in an app', { conversationId: 'c1', app: null }, 'app.crm', false],
    ['naming the app in view, opened elsewhere', { packageId: 'app.crm', app: null }, 'app.crm', true],
    ['naming another app, opened elsewhere', { packageId: 'app.crm', app: null }, 'app.notes', false],
    ['not placed yet', { conversationId: 'c1' }, 'app.notes', true],
  ] as const)('%s → %s', (_label, target, app, shown) => {
    expect(dockTargetFollowsApp(target, app)).toBe(shown);
  });

  it('the stamp round-trips through the per-tab storage, null included', () => {
    writeStoredDockTarget({ agent: 'build', conversationId: 'c1', app: 'app.crm' });
    expect(readStoredDockTarget()).toEqual({ agent: 'build', conversationId: 'c1', app: 'app.crm' });
    writeStoredDockTarget({ agent: 'build', app: null });
    expect(readStoredDockTarget()).toEqual({ agent: 'build', app: null });
    writeStoredDockTarget({ agent: 'build' });
    expect(readStoredDockTarget()).toEqual({ agent: 'build' });
  });
});

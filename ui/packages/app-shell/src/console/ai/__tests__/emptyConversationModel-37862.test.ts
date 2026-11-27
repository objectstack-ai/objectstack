// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37862 — the empty conversation's rules with no React: the
 * greeting's time of day and name, the kind of page the drawer sits on, and
 * which suggestions each place offers with what a click on one does.
 */

import { describe, it, expect } from 'vitest';
import {
  appHomeSuggestions,
  drawerSuggestions,
  greetingForHour,
  greetingName,
  pageKindOfSurface,
} from '../emptyConversationModel';

const t = (_key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? _key);

describe('greetingForHour (objectstack#37862)', () => {
  it('greets by Home\'s keys at each boundary', () => {
    expect(greetingForHour(0).key).toBe('home.greetingNight');
    expect(greetingForHour(4).key).toBe('home.greetingNight');
    expect(greetingForHour(5).key).toBe('home.greetingMorning');
    expect(greetingForHour(11).key).toBe('home.greetingMorning');
    expect(greetingForHour(12).key).toBe('home.greetingAfternoon');
    expect(greetingForHour(17).key).toBe('home.greetingAfternoon');
    expect(greetingForHour(18).key).toBe('home.greetingEvening');
    expect(greetingForHour(22).key).toBe('home.greetingEvening');
    expect(greetingForHour(23).key).toBe('home.greetingNight');
  });
});

describe('greetingName (objectstack#37862)', () => {
  it('is the display name, else the email before @, else nothing', () => {
    expect(greetingName({ name: '  Dana Lee ', email: 'dana@acme.test' })).toBe('Dana Lee');
    expect(greetingName({ name: '', email: 'dana@acme.test' })).toBe('dana');
    expect(greetingName({})).toBe('');
    expect(greetingName(undefined)).toBe('');
  });
});

describe('pageKindOfSurface (objectstack#37862)', () => {
  it('reads the kind off the surface the console sends', () => {
    expect(pageKindOfSurface({ artifact: { type: 'object', name: 'deal' }, selection: { kind: 'record', id: 'd1' } })).toBe('record');
    expect(pageKindOfSurface({ artifact: { type: 'object', name: 'deal' } })).toBe('list');
    expect(pageKindOfSurface({ artifact: { type: 'object', name: 'deal' }, selection: { kind: 'view', id: 'v' } })).toBe('list');
    expect(pageKindOfSurface({ artifact: { type: 'dashboard', name: 'pipeline' } })).toBe('dashboard');
    expect(pageKindOfSurface({ artifact: { type: 'report', name: 'won' } })).toBe('report');
    expect(pageKindOfSurface({ artifact: { type: 'page', name: 'welcome' } })).toBeUndefined();
    expect(pageKindOfSurface(undefined)).toBeUndefined();
  });
});

describe('drawerSuggestions (objectstack#37862)', () => {
  const record = { artifact: { type: 'object', name: 'deal' }, selection: { kind: 'record', id: 'd1' } };

  it('ask on a record: the record\'s two suggestions, which fill', () => {
    const s = drawerSuggestions(t, { agentName: 'ask', agentLabel: 'Ask', surface: record });
    expect(s.map((x) => x.text)).toEqual(['Summarize this record', 'What is related to this record?']);
    expect(s.every((x) => x.mode === 'fill')).toBe(true);
  });

  it('ask on a list, a dashboard or a report: that page\'s suggestions, which send', () => {
    for (const surface of [
      { artifact: { type: 'object', name: 'deal' } },
      { artifact: { type: 'dashboard', name: 'pipeline' } },
      { artifact: { type: 'report', name: 'won' } },
    ]) {
      const s = drawerSuggestions(t, { agentName: 'ask', agentLabel: 'Ask', surface });
      expect(s).toHaveLength(2);
      expect(s.every((x) => x.mode === 'send')).toBe(true);
    }
    expect(drawerSuggestions(t, { agentName: 'ask', agentLabel: 'Ask', surface: { artifact: { type: 'report', name: 'won' } } })[0].text)
      .toBe('Summarize this report');
  });

  it('ask on a page with no kind: the agent\'s starters, which send', () => {
    const s = drawerSuggestions(t, { agentName: 'ask', agentLabel: 'Ask', surface: undefined });
    expect(s.map((x) => x.text).join(' ')).toMatch(/How many users/);
    expect(s.every((x) => x.mode === 'send')).toBe(true);
  });

  it('another agent on a record: its own starters, never the record\'s', () => {
    const s = drawerSuggestions(t, { agentName: 'build', agentLabel: 'Build', surface: record });
    expect(s.map((x) => x.text)).not.toContain('Summarize this record');
    expect(s.every((x) => x.mode === 'send')).toBe(true);
  });
});

describe('appHomeSuggestions (objectstack#37862)', () => {
  it('an app\'s own suggestions send, in the declared order', () => {
    expect(appHomeSuggestions(['B', 'A'])).toEqual([
      { text: 'B', mode: 'send' },
      { text: 'A', mode: 'send' },
    ]);
  });
});

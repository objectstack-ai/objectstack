// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `componentRef: 'ai:chat'` navigation entries: their `params` are judged by
 * `AiChatNavParamsSchema` at every navigation door, an app carries at most one
 * such entry, and every other component entry keeps its open `params` record.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { AppSchema, NavigationItemSchema } from './app.zod';
import {
  AI_CHAT_COMPONENT_REF,
  AiChatNavParamsSchema,
  checkAiChatNavParams,
  checkAppSingleAiChatEntry,
} from './ai-chat-nav-params.zod';
import * as uiBarrel from './index';

const askEntry = (params?: unknown, id = 'nav_ask') => ({
  id,
  type: 'component' as const,
  label: 'Ask AI',
  componentRef: AI_CHAT_COMPONENT_REF,
  ...(params === undefined ? {} : { params }),
});

const app = (extra: Record<string, unknown>) => ({ name: 'policy_desk', label: 'Policy Desk', ...extra });

function issuesOf(result: { success: boolean; error?: { issues: readonly { path: PropertyKey[]; message: string }[] } }) {
  return (result.error?.issues ?? []).map((i) => ({ path: i.path.join('.'), message: i.message }));
}

describe('AiChatNavParamsSchema — the shape', () => {
  it('accepts every key at its bounds, and an empty record', () => {
    expect(AiChatNavParamsSchema.safeParse({}).success).toBe(true);
    const full = {
      title: 't'.repeat(60),
      subtitle: 's'.repeat(200),
      placeholder: 'p'.repeat(100),
      suggestions: ['a', 'b', 'c', 'q'.repeat(100)],
    };
    expect(AiChatNavParamsSchema.safeParse(full).success).toBe(true);
  });

  it.each([
    ['title too long', { title: 't'.repeat(61) }, 'title'],
    ['empty title', { title: '' }, 'title'],
    ['subtitle too long', { subtitle: 's'.repeat(201) }, 'subtitle'],
    ['placeholder too long', { placeholder: 'p'.repeat(101) }, 'placeholder'],
    ['title not a string', { title: 42 }, 'title'],
    ['more than 4 suggestions', { suggestions: ['a', 'b', 'c', 'd', 'e'] }, 'suggestions'],
    ['zero suggestions', { suggestions: [] }, 'suggestions'],
    ['an empty suggestion', { suggestions: ['a', ''] }, 'suggestions.1'],
    ['suggestions not an array', { suggestions: 'a' }, 'suggestions'],
  ])('refuses %s at its own path', (_label, params, path) => {
    const r = AiChatNavParamsSchema.safeParse(params);
    expect(r.success).toBe(false);
    expect(issuesOf(r).map((i) => i.path)).toContain(path);
  });

  it('refuses an unknown key, and answers `agent` / `scope` with why they are not configurable', () => {
    for (const key of ['color', 'agent', 'scope']) {
      const r = AiChatNavParamsSchema.safeParse({ [key]: 'x' });
      expect(r.success, key).toBe(false);
    }
    const agent = issuesOf(AiChatNavParamsSchema.safeParse({ agent: 'build' }));
    expect(agent.map((i) => i.message).join('\n')).toContain('platform `ask` agent');
    const scope = issuesOf(AiChatNavParamsSchema.safeParse({ scope: 'app' }));
    expect(scope.map((i) => i.message).join('\n')).toContain('prefer this app');
  });

  it('is exported from the ui barrel, with its two checks', () => {
    expect(uiBarrel.AiChatNavParamsSchema).toBe(AiChatNavParamsSchema);
    expect(uiBarrel.checkAiChatNavParams).toBe(checkAiChatNavParams);
    expect(uiBarrel.checkAppSingleAiChatEntry).toBe(checkAppSingleAiChatEntry);
    expect(uiBarrel.AI_CHAT_COMPONENT_REF).toBe('ai:chat');
  });

  it('projects to JSON Schema as a closed object with the four keys', () => {
    const json = z.toJSONSchema(AiChatNavParamsSchema) as {
      additionalProperties?: unknown;
      properties?: Record<string, unknown>;
    };
    expect(json.additionalProperties).toBe(false);
    expect(Object.keys(json.properties ?? {}).sort()).toEqual(['placeholder', 'subtitle', 'suggestions', 'title']);
  });
});

describe('ai:chat params — judged at every navigation door', () => {
  it('the navigation union refuses bad params at `params.<key>`', () => {
    const r = NavigationItemSchema.safeParse(askEntry({ suggestions: ['a', 'b', 'c', 'd', 'e'] }));
    expect(r.success).toBe(false);
    expect(issuesOf(r).map((i) => i.path)).toContain('params.suggestions');
  });

  it('an app reports the issue at `navigation.<i>.params.<key>`', () => {
    const r = AppSchema.safeParse(app({ navigation: [{ id: 'nav_home', type: 'url', url: '/' }, askEntry({ tone: 'warm' })] }));
    expect(r.success).toBe(false);
    expect(issuesOf(r).map((i) => i.path)).toContain('navigation.1.params');
    const wrongType = AppSchema.safeParse(app({ navigation: [askEntry({ title: 7 })] }));
    expect(issuesOf(wrongType).map((i) => i.path)).toContain('navigation.0.params.title');
  });

  it('reaches nested children and areas', () => {
    const nested = AppSchema.safeParse(app({
      navigation: [{ id: 'grp', type: 'group', label: 'Help', children: [askEntry({ title: '' })] }],
    }));
    expect(issuesOf(nested).map((i) => i.path)).toContain('navigation.0.children.0.params.title');
    const inArea = AppSchema.safeParse(app({
      areas: [{ id: 'area_main', label: 'Main', navigation: [askEntry({ placeholder: 'p'.repeat(101) })] }],
    }));
    expect(issuesOf(inArea).map((i) => i.path)).toContain('areas.0.navigation.0.params.placeholder');
  });

  it('accepts a valid entry, and one with no params at all', () => {
    const ok = AppSchema.safeParse(app({
      navigation: [askEntry({ title: 'Ask about our policies', suggestions: ['How many leave days do I get?'] })],
    }));
    expect(ok.success, JSON.stringify(issuesOf(ok))).toBe(true);
    expect(AppSchema.safeParse(app({ navigation: [askEntry()] })).success).toBe(true);
  });

  it('control: any other component entry keeps arbitrary params', () => {
    const other = {
      id: 'nav_perm', type: 'component', label: 'Perms', componentRef: 'setup:permission_matrix',
      params: { anything: { nested: [1, 2] }, suggestions: ['a', 'b', 'c', 'd', 'e', 'f'], title: 7 },
    };
    const r = AppSchema.safeParse(app({ navigation: [other] }));
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
  });
});

describe('ai:chat — at most one entry per app', () => {
  it('refuses a second entry at its own path, naming the first', () => {
    const r = AppSchema.safeParse(app({
      navigation: [askEntry({}, 'nav_ask'), { id: 'grp', type: 'group', label: 'More', children: [askEntry({}, 'nav_ask_2')] }],
    }));
    expect(r.success).toBe(false);
    const issues = issuesOf(r);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('navigation.1.children.0');
    expect(issues[0].message).toContain('`nav_ask`');
    expect(issues[0].message).toContain('at most one');
  });

  it('counts entries across navigation and areas', () => {
    const r = AppSchema.safeParse(app({
      navigation: [askEntry({}, 'nav_ask')],
      areas: [{ id: 'area_main', label: 'Main', navigation: [askEntry({}, 'nav_ask_area')] }],
    }));
    expect(issuesOf(r).map((i) => i.path)).toEqual(['areas.0.navigation.0']);
  });

  it('control: one entry plus other component entries parses', () => {
    const r = AppSchema.safeParse(app({
      navigation: [askEntry({}), { id: 'nav_m', type: 'component', label: 'Meta', componentRef: 'metadata:directory' }],
    }));
    expect(r.success, JSON.stringify(issuesOf(r))).toBe(true);
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #27948 (ruling A, step 2): an action's `description`, each param's
 * `helpText` and an `outcomeMessages` entry become ADR-0032 `template` slots,
 * as `confirmText` / `successMessage` already are (#24814). A parsed slot is
 * the `{ dialect: 'template', source }` envelope, so the extraction walk must
 * seed the envelope's `source` exactly as it seeds the bare string — read as
 * a plain value, the envelope was recorded like an absent key and nothing was
 * left to translate.
 *
 * Both action walks are driven (the object's own `actions[]` and the top-level
 * `actions[]`), the regression `i18n-walk-output-parity` exists for.
 */
import { describe, it, expect } from 'vitest';
import { collectExpectedEntries } from '../src/utils/i18n-extract.js';

const envelope = (source: string) => ({ dialect: 'template', source });

/** One action carrying the three slots, either as strings or as envelopes. */
function action(name: string, wrap: (s: string) => unknown, extra: Record<string, unknown> = {}) {
  return {
    name,
    label: 'Pause',
    type: 'script',
    target: 'pause',
    description: wrap('Pause {{ record.name }}?'),
    params: [{ name: 'reason', label: 'Reason', type: 'text', helpText: wrap('Why pause {{ record.name }}?') }],
    outcomeMessages: { paused: wrap('Paused {{ result.name }}.') },
    ...extra,
  };
}

function config(wrap: (s: string) => unknown): any {
  return {
    objects: [{ name: 'crm_account', label: 'Account', fields: { name: { label: 'Name' } }, actions: [action('pause_account', wrap)] }],
    actions: [action('pause_all', wrap, { objectName: 'crm_account' }), action('pause_global', wrap)],
  };
}

/** `path → sourceValue` for the three slots on every action walk. */
function seeds(wrap: (s: string) => unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const e of collectExpectedEntries(config(wrap))) {
    const key = e.path.join('.');
    if (key.startsWith('metadataForms.')) continue;
    if (/\.(description|helpText|outcomeMessages\.paused)$/.test(key) && /pause_(account|all|global)/.test(key)) {
      out[key] = e.sourceValue;
    }
  }
  return out;
}

describe('i18n extraction reads the template envelope on description / helpText / outcomeMessages (#27948)', () => {
  it('seeds each envelope exactly as the bare string, on every action walk', () => {
    const fromStrings = seeds((s) => s);
    const fromEnvelopes = seeds(envelope);
    // 3 actions × 3 slots, every one seeded with the authored sentence.
    expect(Object.keys(fromStrings)).toHaveLength(9);
    expect(Object.values(fromStrings).every((v) => typeof v === 'string' && v.includes('{{'))).toBe(true);
    expect(fromEnvelopes).toEqual(fromStrings);
  });

  it('an inline locale map is still authored, never seeded (unchanged)', () => {
    const map = { en: 'Pause it?', 'zh-CN': '暂停？' };
    const entry = collectExpectedEntries({
      objects: [],
      actions: [{ name: 'pause_map', label: 'Pause', type: 'script', target: 'pause', description: map }],
    } as any).find((e) => e.path.join('.') === 'globalActions.pause_map.description');
    expect(entry).toBeDefined();
    expect(entry?.sourceValue).not.toEqual(map);
  });
});

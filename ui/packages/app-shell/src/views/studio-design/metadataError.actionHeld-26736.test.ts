// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26736 — the Data pillar holds an action that is only unfinished,
 * and places a refused one on the action.
 *
 * The card: switching what an action does, or its Type, left a draft the spec
 * refuses (a script body with no source, an api action with no endpoint), and
 * the autosave sent it. Every later save of the object was refused, and the
 * strip said only "the server refused this draft". Now:
 *
 *  - `actionHeldInput` asks the spec's own `ActionSchema` of each action. When
 *    every issue is an input the inspector offers and the author has not
 *    filled yet, the pillar holds the object unsent (`objectHeldEdit`) and
 *    names that input on that action, as it does for a field with no options.
 *  - Anything else is finished but wrong: it is sent, and a refusal at
 *    `actions.INDEX…` is placed on that action (`objectSaveRefusal`), with a
 *    selection that opens it.
 *
 * Each "held" case is paired with the spec's own refusal of the same action,
 * so the hold is never stricter than the contract. The pillar that acts on it
 * is pinned in `DataPillar.actionRefusal-26736.test.tsx`.
 */

import { describe, expect, it } from 'vitest';
import { ActionSchema } from '@objectstack/spec/ui';
import { actionHeldInput, objectHeldEdit, objectSaveRefusal } from './metadataError';
import { t, tFormat } from '../metadata-admin/i18n';

type Action = Record<string, unknown>;

const refused = (action: Action): boolean => !ActionSchema.safeParse(action).success;

const object = (actions: Action[]) => ({
  name: 'invoice',
  label: 'Invoice',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
  actions,
});

const base: Action = { name: 'invoice_send', label: 'Send', objectName: 'invoice', locations: ['record_more'] };
const DESCRIPTION = 'Send the invoice to its customer once it has been approved by finance.';

describe('actionHeldInput — an action waiting for an input is held (objectstack#26736)', () => {
  it.each([
    ['"Run a script" before a source is typed', { ...base, type: 'script', body: { language: 'expression' } }, 'engine.inspector.action.scriptBody'],
    ['a script source cleared', { ...base, type: 'script', body: { language: 'js', source: '' } }, 'engine.inspector.action.scriptBody'],
    ['a script with neither a body nor a target', { ...base, type: 'script' }, 'engine.inspector.action.scriptBody'],
    ['Type switched to API before the endpoint', { ...base, type: 'api' }, 'engine.inspector.action.target.api.label'],
    ['Type switched to URL before the address', { ...base, type: 'url', target: '' }, 'engine.inspector.action.target.url.label'],
    ['exposed to AI before a description', { ...base, type: 'script', body: { language: 'expression', source: 'true' }, ai: { exposed: true } }, 'engine.inspector.action.aiDescription'],
    ['an AI description still being typed', { ...base, type: 'script', body: { language: 'expression', source: 'true' }, ai: { exposed: true, description: 'Send it' } }, 'engine.inspector.action.aiDescription'],
  ] as const)('%s', (_, action, input) => {
    expect(refused(action as Action)).toBe(true);
    expect(actionHeldInput(action)).toBe(input);
  });

  it.each([
    ['a body left on an api action (refused, not unfinished)', { ...base, type: 'api', target: '/api/v1/x', body: { language: 'expression', source: 'true' } }],
    ['the flat aiExposed the inspector used to write', { ...base, type: 'script', body: { language: 'expression', source: 'true' }, aiExposed: true }],
    ['a Body Shape typed as JSON text', { ...base, type: 'api', target: '/api/v1/x', bodyShape: '{"wrap":"payload"}' }],
    ['a body naming no language', { ...base, type: 'script', body: { source: 'true' } }],
  ] as const)('not held — %s: sent, so its refusal shows', (_, action) => {
    expect(refused(action as Action)).toBe(true);
    expect(actionHeldInput(action)).toBeNull();
  });

  it('not held — an action the spec accepts', () => {
    const action = { ...base, type: 'script', body: { language: 'expression', source: 'true' }, ai: { exposed: true, description: DESCRIPTION } };
    expect(refused(action)).toBe(false);
    expect(actionHeldInput(action)).toBeNull();
  });
});

describe('objectHeldEdit — the Data pillar holds the object for it (objectstack#26736)', () => {
  it('names the input on the action by its label, and selects the action', () => {
    const body = object([
      { ...base, name: 'invoice_ok', label: 'OK', type: 'script', body: { language: 'expression', source: 'true' } },
      { ...base, type: 'script', body: { language: 'expression' } },
    ]);
    expect(objectHeldEdit(body, 'en')).toEqual({
      clause: tFormat('engine.studio.held.actionNeedsInput', 'en', { input: t('engine.inspector.action.scriptBody', 'en'), action: 'Send' }),
      target: { kind: 'action', id: 'invoice_send' },
    });
  });

  it('control: an object whose actions all parse is not held', () => {
    expect(objectHeldEdit(object([{ ...base, type: 'script', body: { language: 'expression', source: 'true' } }]), 'en')).toBeNull();
  });

  it('control: a field the write guard holds still comes first', () => {
    const body = { ...object([{ ...base, type: 'api' }]), fields: [{ name: 'status', label: 'Status', type: 'select' }] };
    expect(objectHeldEdit(body, 'en')?.target).toEqual({ kind: 'field', id: 'status' });
  });
});

describe('objectSaveRefusal — a refusal is placed on the action it names (objectstack#26736)', () => {
  const refusal = (path: string, message: string) =>
    Object.assign(new Error('[invalid_metadata] object/invoice failed spec validation'), {
      status: 422,
      issues: [{ path, message, code: 'custom' }],
    });

  it('a key under the action that the inspector edits: named with its input', () => {
    const sent = object([{ ...base, type: 'api', target: '/api/v1/x', body: { language: 'expression', source: 'true' } }]);
    const out = objectSaveRefusal(refusal('actions.0.body', '`body` only runs for `type: \'script\'`'), sent, 'en');
    expect(out.message).toContain(
      tFormat('engine.studio.refusal.actionInput', 'en', { input: t('engine.inspector.action.scriptBody', 'en'), action: 'Send' }),
    );
    expect(out.target).toEqual({ kind: 'action', id: 'invoice_send' });
    expect(out.detail).toBeDefined();
  });

  it('a key on the action itself (the flat aiExposed): named by the action', () => {
    const sent = object([{ ...base, type: 'script', body: { language: 'expression', source: 'true' }, aiExposed: true }]);
    const out = objectSaveRefusal(refusal('actions.0', 'Unrecognized key: "aiExposed"'), sent, 'en');
    expect(out.message).toContain(tFormat('engine.studio.refusal.action', 'en', { action: 'Send' }));
    expect(out.target).toEqual({ kind: 'action', id: 'invoice_send' });
  });

  it('control: a field path is still placed on the field', () => {
    const sent = object([]);
    expect(objectSaveRefusal(refusal('fields.0.label', 'Invalid input'), sent, 'en').target).toEqual({ kind: 'field', id: 'title' });
  });

  it('control: a path the editor cannot place stays unlocated', () => {
    const sent = object([]);
    expect(objectSaveRefusal(refusal('actions.3.body', 'x'), sent, 'en').message).toBe(t('engine.studio.refusal.unlocated', 'en'));
  });
});

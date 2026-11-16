// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#34062, ruling 6913660232] A sentence a flow writes into a record is
// written in the ORGANIZATION's language — on a real boot: the app's declared
// `i18n.defaultLocale`, the `translations` the stack loads into the i18n
// service, the settings service's `localization.locale`, the record-change
// trigger, the REST trigger door and the ObjectQL engine the row lands in.
//
// The app declares `i18n.defaultLocale: 'zh-CN'` and no Localization row is
// written until the last case, so the language the platform answers for the
// organization is the app's own. Each flow writes one note with three fields:
//
//   - `reason`: marked as text, translated in zh-CN and ja-JP;
//   - `detail`: marked as text, translated in no locale;
//   - `kind`: a bare string — a literal, never translated.
//
// Boots a fixture stack of its own, so it stays out of `SHARED_SHOWCASE`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { defineStack } from '@objectstack/spec';

const CASE = 'rtx_case';
const NOTE = 'rtx_note';
const ON_CHANGE = 'rtx_escalate';
const BY_HAND = 'rtx_escalate_now';
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

const REASON = 'Auto-escalated: {{ priority }} priority';
const DETAIL = 'Raised for {{ priority }}';

/** The note write both flows end in, reading the `priority` variable; `via` names the run. */
const writeNote = (via: unknown) => ({
  id: 'write_note', type: 'create_record', label: 'Write note',
  config: {
    objectName: NOTE,
    fields: {
      via,
      reason: { dialect: 'template', source: REASON },
      detail: { dialect: 'template', source: DETAIL },
      kind: 'escalation',
    },
  },
});

const fixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.flow-record-text-org-locale',
    namespace: 'rtx',
    version: '0.0.0',
    type: 'app',
    name: 'Flow Record Text Org Locale Fixture',
    description: 'A flow writes a translated sentence into a record (#34062).',
  },
  requires: ['automation', 'triggers'],
  i18n: { defaultLocale: 'zh-CN', supportedLocales: ['zh-CN', 'en-US', 'ja-JP'] },
  objects: [
    {
      name: CASE, label: 'Case', sharingModel: 'public_read_write',
      fields: { title: { type: 'text', label: 'Title' }, priority: { type: 'text', label: 'Priority' } },
    },
    {
      name: NOTE, label: 'Note', sharingModel: 'public_read_write',
      fields: {
        via: { type: 'text', label: 'Via' },
        reason: { type: 'text', label: 'Reason' },
        detail: { type: 'text', label: 'Detail' },
        kind: { type: 'text', label: 'Kind' },
      },
    },
  ],
  flows: [
    {
      name: ON_CHANGE, label: 'Escalate on create', type: 'record_change', status: 'active',
      // The case is inserted by a system write, so the run holds no trigger user.
      runAs: 'system',
      variables: [{ name: 'priority', type: 'text' }],
      nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { objectName: CASE, triggerType: 'record-after-create' } },
        { id: 'read', type: 'assignment', label: 'Read', config: { assignments: { priority: { dialect: 'cel', source: 'record.priority' } } } },
        writeNote({ dialect: 'cel', source: "'rc:' + record.title" }),
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'read' },
        { id: 'e2', source: 'read', target: 'write_note' },
        { id: 'e3', source: 'write_note', target: 'end' },
      ],
    },
    {
      name: BY_HAND, label: 'Escalate now', type: 'autolaunched', status: 'active',
      variables: [{ name: 'priority', type: 'text', isInput: true }, { name: 'via', type: 'text', isInput: true }],
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        writeNote({ dialect: 'cel', source: 'via' }),
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'write_note' },
        { id: 'e2', source: 'write_note', target: 'end' },
      ],
    },
  ],
  translations: [
    {
      'zh-CN': {
        flows: {
          [ON_CHANGE]: { records: { write_note: { fields: { reason: '自动升级：{{ priority }} 优先级' } } } },
          [BY_HAND]: { records: { write_note: { fields: { reason: '自动升级：{{ priority }} 优先级' } } } },
        },
      },
      'en-US': {
        flows: {
          [BY_HAND]: { records: { write_note: { fields: { reason: 'EN: escalated, {{ priority }}' } } } },
        },
      },
      'ja-JP': {
        flows: {
          [ON_CHANGE]: { records: { write_note: { fields: { reason: '自動エスカレーション：{{ priority }} 優先度' } } } },
        },
      },
    },
  ],
} as never);

describe('dogfood: a flow writes a marked field in the organization\'s language (#34062)', () => {
  let stack: VerifyStack;
  let token: string;
  let ql: any;

  /** The one note a run wrote with `via`, waited for briefly: an after-create run lands with its write. */
  const noteVia = async (via: string): Promise<Record<string, unknown>> => {
    for (let i = 0; i < 50; i++) {
      const rows = await ql.find(NOTE, { where: { via }, context: SYSTEM_CTX });
      if (rows.length > 0) {
        expect(rows, `one note via ${via}`).toHaveLength(1);
        return rows[0];
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`no note was written via ${via}`);
  };

  /** A record nobody wrote as a person: the trigger's run carries no user and no locale. */
  const systemCase = async (title: string, priority: string) => {
    await ql.insert(CASE, { title, priority }, { context: SYSTEM_CTX });
  };

  /** Start the hand-run flow as the signed-in admin, in a stated language. */
  const runByHand = async (via: string, locale: string) => {
    const res = await stack.api(`/automation/${BY_HAND}/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Accept-Language': locale },
      body: JSON.stringify({ params: { priority: 'High', via } }),
    });
    const text = await res.text();
    expect(res.status, `POST /automation/${BY_HAND}/trigger: ${text.slice(0, 300)}`).toBeLessThan(300);
    return JSON.parse(text);
  };

  beforeAll(async () => {
    stack = await bootStack(fixtureStack, { automation: true, extraPlugins: [new RecordChangeTriggerPlugin()] });
    token = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('a record-change run with no user writes the zh-CN translation, holes filled; an untranslated mark and a bare string as authored', async () => {
    await systemCase('Printer down', 'High');
    const note = await noteVia('rc:Printer down');
    expect(note.reason).toBe('自动升级：High 优先级');
    // A missing translation writes the authored text, and the run completed.
    expect(note.detail).toBe('Raised for High');
    // A bare string is the literal it spells.
    expect(note.kind).toBe('escalation');
  });

  it('a run a person started in en-US still writes the organization\'s zh-CN — never the starter\'s language', async () => {
    await runByHand('button-en', 'en-US');
    const note = await noteVia('button-en');
    expect(note.reason).toBe('自动升级：High 优先级');
    // CONTROL: the en-US entry exists and is not what was written.
    expect(note.reason).not.toBe('EN: escalated, High');
  });

  it('a Localization setting somebody set wins over the app default', async () => {
    const settings = stack.kernel.getService('settings') as {
      set(namespace: string, key: string, value: unknown, ctx?: object): Promise<unknown>;
      get(namespace: string, key: string, ctx?: object): Promise<{ value: unknown; source: string }>;
    };
    await settings.set('localization', 'locale', 'ja-JP', {});
    expect((await settings.get('localization', 'locale', {})).source).not.toBe('default');

    await systemCase('Server down', 'Low');
    const note = await noteVia('rc:Server down');
    expect(note.reason).toBe('自動エスカレーション：Low 優先度');
    // CONTROL: the untranslated mark still writes the authored text under the setting.
    expect(note.detail).toBe('Raised for Low');
  });
});

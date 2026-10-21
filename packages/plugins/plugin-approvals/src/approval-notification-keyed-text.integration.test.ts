// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24978] Every approval notification carries its text as catalog keys, and
 * a non-English approver reads it in their own language.
 *
 * ## The defect
 *
 * Each notification sentence — `approval.requested`, the reminders, the SLA
 * notices, the decision outcomes, the out-of-office notices and the rest — was
 * an English literal built at emit, and no catalog held it, so a zh-CN, ja-JP
 * or es-ES approver read English (measured on HotCRM).
 *
 * ## What this pins
 *
 * Driven through the real `ApprovalService` on a real `ObjectQL` over
 * `SqlDriver` (better-sqlite3, in-memory, real DDL):
 *
 *  1. the battery the body pins drive reaches every call site, and EACH emit
 *     carries `keyedText`: a `messages.<id>` title key the catalog holds, and a
 *     body key exactly where the body is the service's own sentence — never for
 *     a person's own words (a comment, a question, a send-back note);
 *  2. the keys render, through the REAL messaging renderer over the kernel's
 *     in-memory `i18n` service loaded with this plugin's own bundle, to the very
 *     literal the payload carries in `en` (one English, whichever path), and to
 *     a different sentence in each of zh-CN, ja-JP and es-ES — the object label
 *     included, from the app's `objects.<object>.label`;
 *  3. end to end, a REAL `MessagingService` with its inbox channel: one
 *     opening reaches a zh-CN approver in Chinese, an English approver in
 *     English, and an approver with no locale in the deployment default's
 *     language; the decision outcome reaches the zh-CN submitter in Chinese
 *     with the decider's comment as written.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { createMemoryI18n } from '@objectstack/core';
import { SysNotification } from '@objectstack/platform-objects';
import { APPROVAL_REVISE_NODE_TYPE } from '@objectstack/spec/automation';
import {
  MessagingService,
  NotificationTextRenderer,
  createInboxChannel,
  InboxMessage,
  NotificationReceipt,
  type NotificationTextKeys,
} from '@objectstack/service-messaging';
import { ApprovalService } from './approval-service.js';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { ApprovalsTranslations } from './translations/index.js';
import { approvalMessages, enMessages } from './translations/messages.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] } as any;
const asUser = (userId: string) => ({ userId, positions: [], permissions: [] }) as any;
const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;

const ORG = 'org_keyed';

const sysUser = {
  name: 'sys_user',
  label: 'User',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    email: { name: 'email', label: 'Email', type: 'text' as const },
    locale: { name: 'locale', label: 'Locale', type: 'text' as const },
  },
};
const deal = {
  name: 'crm_deal',
  label: 'Deal',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' as const },
  },
};

const FLOW = {
  name: 'deal_review',
  nodes: [
    { id: 'review', type: 'approval' },
    { id: 'rework', type: APPROVAL_REVISE_NODE_TYPE },
  ],
  edges: [{ id: 'e_revise', source: 'review', target: 'rework', label: 'revise' }],
};

/** The app's own object labels — what a real app's language pack would carry. */
const DEAL_LABELS: Record<string, string> = { 'zh-CN': '商机', 'ja-JP': '商談', 'es-ES': 'Oportunidad' };

/** The kernel's in-memory i18n service with this plugin's bundle and the app's labels loaded. */
function i18nWithBundle(defaultLocale?: string) {
  const i18n = createMemoryI18n();
  for (const [locale, data] of Object.entries(ApprovalsTranslations)) {
    i18n.loadTranslations(locale, data as Record<string, unknown>);
  }
  for (const [locale, label] of Object.entries(DEAL_LABELS)) {
    i18n.loadTranslations(locale, { objects: { crm_deal: { label } } });
  }
  if (defaultLocale) i18n.setDefaultLocale(defaultLocale);
  return i18n;
}

async function packageObjects(): Promise<any[]> {
  let manifest: any;
  const ctx: any = {
    getService: (name: string) => {
      if (name === 'manifest') return { register: (m: any) => { manifest = m; } };
      throw new Error(`no service '${name}'`);
    },
    logger: silent,
  };
  await new ApprovalsServicePlugin().init(ctx);
  return manifest.objects;
}

async function bootEngine(users: Array<Record<string, unknown>>): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(new SqlDriver({
    client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true,
  }), true);
  await engine.init();
  for (const def of [sysUser, deal, SysNotification, InboxMessage, NotificationReceipt, ...(await packageObjects())]) {
    engine.registry.registerObject(def as any, 'approvals-test', 'approvals-test');
  }
  await engine.syncSchemas();
  // A real `single` install's Default Organization: the system writes below
  // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
  await installDefaultOrganization(engine);
  for (const u of users) await engine.insert('sys_user', u, { context: SYSTEM } as any);
  return engine;
}

function approvalService(engine: ObjectQL, clock: () => Date): ApprovalService {
  return new ApprovalService({
    engine: engine as any,
    clock: { now: clock },
    automation: {
      resume: async () => ({ status: 'completed' }),
      cancelRun: async () => undefined,
      getRun: async (runId: string) => ({ id: runId, status: 'paused' }),
      getFlow: async () => FLOW,
    } as any,
    logger: silent,
  });
}

interface Emitted {
  topic: string;
  audience: string[];
  source?: { object: string; id: string };
  payload?: { title?: string; body?: string };
  keyedText?: NotificationTextKeys;
}

/** The `messages.<id>` keys the catalog holds. */
const CATALOG_KEYS = new Set(Object.keys(enMessages).map((id) => `messages.${id}`));
/** The sites whose body is a person's own words — keyed title, literal body. */
const OWN_WORDS = new Set(['approval.comment@thread', 'approval.request_info@thread', 'approval.returned@revise']);
/** A literal no catalog sentence spells — so a render that fell back is told apart from one that rendered. */
const SENTINEL = { title: '<<not rendered>>', body: '<<not rendered>>' };

describe('#24978 — every approval notification carries its text as catalog keys', () => {
  let engine: ObjectQL;
  let now = Date.parse('2026-10-01T09:00:00.000Z');
  const emits: Emitted[] = [];
  const ids: Record<string, string> = {};
  const siteOf = (e: Emitted): string => {
    const key = Object.keys(ids).find((k) => ids[k] === e.source?.id) ?? '?';
    const toSubmitter = e.topic === 'approval.sla_breached' && e.audience.join() === 'u_sub' ? '>submitter' : '';
    return `${e.topic}@${key}${toSubmitter}`;
  };

  beforeAll(async () => {
    engine = await bootEngine([
      { id: 'u_sub', name: 'Sam Submitter', email: 'sam@example.com' },
      { id: 'u_alice', name: 'Alice', email: 'alice@example.com' },
      { id: 'u_bob', name: 'Bob', email: 'bob@example.com' },
      { id: 'u_ooo', name: 'Olive Away', email: 'olive@example.com' },
      { id: 'u_boss', name: 'Boss', email: 'boss@example.com' },
    ]);
    const svc = approvalService(engine, () => new Date(now += 1000));
    svc.attachMessaging({ async emit(input) { emits.push(input as Emitted); } });
    const open = async (key: string, approvers: any[], extra: Record<string, unknown> = {}) => {
      await engine.insert('crm_deal', { id: `D_${key}`, title: key, organization_id: ORG }, { context: SYSTEM } as any);
      const row: any = await svc.openNodeRequest({
        object: 'crm_deal', recordId: `D_${key}`, runId: `run_${key}`, nodeId: 'review', flowName: FLOW.name,
        config: { approvers, behavior: 'first_response', ...extra } as any,
        submitterId: 'u_sub', record: { id: `D_${key}`, title: key },
      }, asUser('u_sub'));
      ids[key] = row.id;
      return row;
    };

    await open('thread', [{ type: 'position', value: 'legal' }, { type: 'user', value: 'u_alice' }], { behavior: 'unanimous' });
    await svc.comment(ids.thread, { actorId: 'u_sub', comment: 'Attached the contract.' }, asUser('u_sub'));
    await svc.requestInfo(ids.thread, { actorId: 'u_alice', comment: 'Which cost centre?' }, asUser('u_alice'));
    await svc.remind(ids.thread, { actorId: 'u_sub' }, asUser('u_sub'));
    await svc.reassign(ids.thread, { actorId: 'u_alice', to: 'u_bob' }, asUser('u_alice'));

    await open('revise', [{ type: 'user', value: 'u_alice' }]);
    await svc.sendBack(ids.revise, { actorId: 'u_alice', comment: 'Split it by quarter.' } as any, asUser('u_alice'));
    await open('rework', [{ type: 'user', value: 'u_alice' }]);
    await svc.sendBack(ids.rework, { actorId: 'u_alice' } as any, asUser('u_alice'));
    await open('budget', [{ type: 'user', value: 'u_alice' }], { maxRevisions: 0 });
    await svc.sendBack(ids.budget, { actorId: 'u_alice' } as any, asUser('u_alice'));

    await open('approved', [{ type: 'user', value: 'u_alice' }]);
    await svc.decide(ids.approved, { decision: 'approve', actorId: 'u_alice' }, asUser('u_alice'));
    await open('rejected', [{ type: 'user', value: 'u_alice' }]);
    await svc.decide(ids.rejected, { decision: 'reject', actorId: 'u_alice', comment: 'Not this quarter.' }, asUser('u_alice'));

    // The delegation belongs to the deals' organization, where the request it
    // substitutes in is opened.
    await engine.insert('sys_approval_delegation', {
      id: 'dlg_1', delegator_id: 'u_ooo', delegate_id: 'u_bob', reason: 'leave', organization_id: ORG,
      valid_from: '2026-09-01T00:00:00.000Z', valid_until: '2026-12-31T00:00:00.000Z',
      created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
    }, { context: SYSTEM } as any);
    await open('ooo', [{ type: 'user', value: 'u_ooo' }]);

    await open('sla_notify', [{ type: 'user', value: 'u_alice' }],
      { escalation: { timeoutHours: 1, action: 'notify', escalateTo: 'u_boss', notifySubmitter: true } });
    await open('sla_reassign', [{ type: 'user', value: 'u_alice' }],
      { escalation: { timeoutHours: 1, action: 'reassign', escalateTo: 'u_boss', notifySubmitter: false } });
    now += 2 * 3600_000;
    expect(await svc.runEscalations()).toMatchObject({ escalated: 2 });
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('the battery reaches every topic an approval can notify', () => {
    expect(new Set(emits.map((e) => e.topic))).toEqual(new Set([
      'approval.requested', 'approval.reminder', 'approval.reassigned', 'approval.request_info',
      'approval.comment', 'approval.returned', 'approval.approved', 'approval.rejected',
      'approval.ooo_substituted', 'approval.ooo_skipped', 'approval.escalated', 'approval.sla_breached',
    ]));
    // Both SLA notices: the approvers' and the submitter's.
    expect(emits.filter((e) => e.topic === 'approval.sla_breached').map(siteOf).sort())
      .toEqual(['approval.sla_breached@sla_notify', 'approval.sla_breached@sla_notify>submitter']);
  });

  it('each emit carries a title key the catalog holds, and a body key exactly where the body is the service\'s own sentence', () => {
    const offenders: string[] = [];
    for (const e of emits) {
      const site = siteOf(e);
      const keys = e.keyedText;
      if (!keys?.titleKey || !CATALOG_KEYS.has(keys.titleKey)) offenders.push(`${site}: title key ${JSON.stringify(keys?.titleKey)}`);
      if (OWN_WORDS.has(site)) {
        if (keys?.bodyKey !== undefined) offenders.push(`${site}: a person's own words carry a body key`);
      } else if (!keys?.bodyKey || !CATALOG_KEYS.has(keys.bodyKey)) {
        offenders.push(`${site}: body key ${JSON.stringify(keys?.bodyKey)}`);
      }
    }
    expect(offenders).toEqual([]);
    // The control: the own-words sites are really in the battery.
    expect(new Set(emits.map(siteOf).filter((s) => OWN_WORDS.has(s)))).toEqual(OWN_WORDS);
  });

  it('the keys render to the literal itself in en, and to another sentence in each shipped locale — the object label included', () => {
    const i18n = i18nWithBundle();
    const renderer = new NotificationTextRenderer({ getData: () => undefined, getI18n: () => i18n });
    const offenders: string[] = [];
    for (const e of emits) {
      const site = siteOf(e);
      const keys = e.keyedText!;
      const en = renderer.render(keys, SENTINEL, 'en');
      if (en.title !== e.payload?.title) offenders.push(`${site} en title: ${en.title}`);
      if (keys.bodyKey && en.body !== e.payload?.body) offenders.push(`${site} en body: ${en.body}`);
      for (const locale of ['zh-CN', 'ja-JP', 'es-ES']) {
        const out = renderer.render(keys, SENTINEL, locale);
        if (out.title === SENTINEL.title || out.title === e.payload?.title) offenders.push(`${site} ${locale} title not rendered`);
        if (!keys.bodyKey) continue;
        if (out.body === SENTINEL.body || out.body === e.payload?.body || out.body.includes('{{')) {
          offenders.push(`${site} ${locale} body: ${out.body}`);
        }
        // Every body sentence names the record; in this locale, by this locale's label.
        if (!out.body.includes(`${DEAL_LABELS[locale]} D_`)) offenders.push(`${site} ${locale} body names no localized record: ${out.body}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every shipped locale carries every sentence, with the same holes', () => {
    const holes = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    for (const [locale, messages] of Object.entries(approvalMessages)) {
      expect(Object.keys(messages).sort(), locale).toEqual(Object.keys(enMessages).sort());
      for (const [id, text] of Object.entries(messages)) {
        expect(holes(text), `${locale} ${id}`).toEqual(holes(enMessages[id as keyof typeof enMessages]));
      }
    }
  });
});

describe('#24978 — end to end: a real messaging service renders each approver\'s notification in their language', () => {
  let engine: ObjectQL;
  let now = Date.parse('2026-10-01T09:00:00.000Z');

  beforeAll(async () => {
    engine = await bootEngine([
      { id: 'u_sub', name: 'Sun Submitter', email: 'sun@example.com', locale: 'zh-CN' },
      { id: 'u_zh', name: 'Zhang', email: 'zhang@example.com', locale: 'zh-CN' },
      { id: 'u_en', name: 'Ada', email: 'ada@example.com', locale: 'en' },
      { id: 'u_none', name: 'Nobody', email: 'nobody@example.com' },
    ]);
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  const inboxOf = async (userId: string) => {
    const rows = (await engine.find('sys_inbox_message', {
      where: { user_id: userId }, fields: ['topic', 'title', 'body_md'],
    }, { context: SYSTEM })) as any[];
    return rows.map((r) => ({ topic: r.topic, title: r.title, body: r.body_md }));
  };

  it('one opening: zh-CN in Chinese, en in English, no locale in the deployment default (ja-JP); the outcome reaches the zh-CN submitter in Chinese', async () => {
    const i18n = i18nWithBundle('ja-JP');
    const getData = () => engine as any;
    const messaging = new MessagingService({
      logger: silent,
      getData,
      textRenderer: new NotificationTextRenderer({
        getData, getI18n: () => i18n, getDefaultLocale: () => i18n.getDefaultLocale(), logger: silent,
      }),
    });
    messaging.registerChannel(createInboxChannel({ getData }));
    const svc = approvalService(engine, () => new Date(now += 1000));
    svc.attachMessaging(messaging as any);

    await engine.insert('crm_deal', { id: 'D_1', title: 'Big deal', organization_id: ORG }, { context: SYSTEM } as any);
    const request: any = await svc.openNodeRequest({
      object: 'crm_deal', recordId: 'D_1', runId: 'run_1', nodeId: 'review', flowName: FLOW.name,
      config: {
        approvers: [{ type: 'user', value: 'u_zh' }, { type: 'user', value: 'u_en' }, { type: 'user', value: 'u_none' }],
        behavior: 'first_response',
      } as any,
      submitterId: 'u_sub', record: { id: 'D_1', title: 'Big deal' },
    }, asUser('u_sub'));

    expect(await inboxOf('u_zh')).toEqual([
      { topic: 'approval.requested', title: '新的审批请求', body: '商机 D_1 正在等待您的审批决定。' },
    ]);
    expect(await inboxOf('u_en')).toEqual([
      { topic: 'approval.requested', title: 'Approval requested', body: 'A decision on Deal D_1 is waiting on you.' },
    ]);
    expect(await inboxOf('u_none')).toEqual([
      { topic: 'approval.requested', title: '承認依頼', body: '商談 D_1 について、あなたの承認判断が必要です。' },
    ]);

    await svc.decide(request.id, { decision: 'approve', actorId: 'u_en', comment: 'Looks good — ship it.' }, asUser('u_en'));
    expect(await inboxOf('u_sub')).toEqual([
      { topic: 'approval.approved', title: '请求已批准', body: '您的商机 D_1 已获批准。\n\nLooks good — ship it.' },
    ]);
  });
});

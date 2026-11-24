// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34374 PR2, ruling 6913660232 option B, parameter 7] A sentence an ACTION
 * writes into a record for people to read is written in the ORGANIZATION's
 * language — the action half of what `hook-text.integration.test.ts` pins for
 * hooks.
 *
 * The action declares it (`ActionSchema.texts`) and its sandboxed body asks
 * for it by key — `await ctx.text('email_subject', { subject })` — and the
 * runtime answers the translation at the action's own address
 * (`objects.<object>._actions.<action>.texts.<key>.message`, or
 * `globalActions.<action>.texts.<key>.message` for an object-less action) in
 * the organization's language (the Localization setting somebody set, else the
 * app's `i18n.defaultLocale`; never the caller's), the declared sentence on a
 * miss, its holes filled after.
 *
 * The HotCRM shape the release record names: a `send_email` script action
 * that logs an activity titled `'Email: ' + subject`, here written
 * `ctx.text('email_subject', { subject })`. Same wiring as the hook pin: the
 * REAL `ObjectQL` + REAL `SqlDriver` (better-sqlite3) + REAL
 * `QuickJSScriptRunner` behind `actionBodyRunnerFactory`, the handler
 * registered and dispatched through the engine's own `registerAction` /
 * `executeAction`, with the REAL in-memory `i18n` service. Every assertion
 * lands on the activity row the action stored.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { createMemoryI18n } from '@objectstack/core';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { actionBodyRunnerFactory } from './body-runner.js';
import { hookRefusalI18nReader } from './hook-refusal-catalogue.js';
import { QuickJSScriptRunner } from './quickjs-runner.js';

const CONTACT = { name: 'probe_text_contact', fields: { name: { type: 'text' } } };
const ACTIVITY = { name: 'probe_text_activity', fields: { subject: { type: 'text' }, related_id: { type: 'text' } } };

const ACTION_NAME = 'send_email';
const GLOBAL_KEY = 'global';
const EN = 'Email: {{ subject }}';
const ZH = '邮件：{{ subject }}';
const JA = 'メール：{{ subject }}';

/** The HotCRM body, its `'Email: ' + subject` written as a declared text asked for by key. */
const BODY_SOURCE = `
  var key = input.key || 'email_subject';
  var line = await ctx.text(key, { subject: input.subject });
  await ctx.api.object('${ACTIVITY.name}').insert({ subject: line, related_id: input.recordId || null });
  return { subject: line };
`;

const TEXTS = { email_subject: { message: EN, params: ['subject'] } };

const SYSTEM_READ: EngineQueryOptions = { context: { isSystem: true } };

/** What the `settings` service answers for `localization.locale`. */
type SettingsAnswer = { value?: unknown; source?: string } | (() => never);

interface StackOptions {
  /** The app's declared `i18n.defaultLocale`. */
  defaultLocale?: string;
  /** Translation bundles by locale. */
  bundles?: Record<string, Record<string, unknown>>;
  /** What the settings service answers; absent ⇒ the host has no settings service. */
  settings?: SettingsAnswer;
  /** Per-organization Localization answers, as a real settings store scopes them: an unscoped or other-organization read gets the `source: 'default'` placeholder. */
  orgSettings?: Record<string, { value: unknown; source: string }>;
  /** The action is object-less (`globalActions`) rather than bound to the contact object. */
  objectLess?: boolean;
  /** The action's declared texts; absent ⇒ {@link TEXTS}, `null` ⇒ none declared. */
  texts?: Record<string, unknown> | null;
  /** Collects every `logger.warn` line the runtime writes. */
  warnings?: string[];
}

/** A bundle carrying `sentence` at the bound address and `globalSentence` at the object-less one. */
function bundle(sentence: string | undefined, globalSentence?: string) {
  return {
    ...(sentence !== undefined
      ? { objects: { [CONTACT.name]: { _actions: { [ACTION_NAME]: { texts: { email_subject: { message: sentence } } } } } } }
      : {}),
    ...(globalSentence !== undefined
      ? { globalActions: { [ACTION_NAME]: { texts: { email_subject: { message: globalSentence } } } } }
      : {}),
  };
}

describe('#34374 PR2 — a script action writes its declared text in the organization\'s language (ctx.text)', () => {
  let engine: ObjectQL | null = null;
  let dir: string | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
  });

  async function reset(): Promise<void> {
    await engine?.destroy();
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
  }

  async function makeStack(options: StackOptions = {}) {
    dir = mkdtempSync(join(tmpdir(), 'os-34374-action-'));
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'data.sqlite') }, useNullAsDefault: true });
    await driver.initObjects([CONTACT, ACTIVITY]);
    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(CONTACT as any, 'probe');
    engine.registry.registerObject(ACTIVITY as any, 'probe');

    const i18n = createMemoryI18n();
    if (options.defaultLocale) i18n.setDefaultLocale(options.defaultLocale);
    for (const [locale, data] of Object.entries(options.bundles ?? {})) i18n.loadTranslations(locale, data);
    const asked: Array<{ tenantId?: string } | undefined> = [];
    const settings = options.settings === undefined && options.orgSettings === undefined ? undefined : {
      async get(_ns: string, _key: string, ctx?: { tenantId?: string }) {
        asked.push(ctx);
        if (options.orgSettings) {
          const scoped = ctx?.tenantId ? options.orgSettings[ctx.tenantId] : undefined;
          return scoped ?? { value: 'en-US', source: 'default' };
        }
        const answer = options.settings!;
        if (typeof answer === 'function') answer();
        return answer as { value?: unknown; source?: string };
      },
    };
    const services: Record<string, unknown> = { i18n, ...(settings ? { settings } : {}) };
    const getService = (name: string): unknown => {
      if (name in services) return services[name];
      throw new Error(`service '${name}' not registered`);
    };
    const logger = {
      debug: () => {}, info: () => {}, error: () => {},
      warn: (...args: unknown[]) => { options.warnings?.push(args.map(String).join(' ')); },
    };

    const texts = options.texts === undefined ? TEXTS : options.texts ?? undefined;
    const action = {
      name: ACTION_NAME,
      type: 'script',
      ...(options.objectLess ? {} : { objectName: CONTACT.name, object: CONTACT.name }),
      body: { language: 'js', source: BODY_SOURCE, capabilities: ['api.read', 'api.write'] },
      ...(texts ? { texts } : {}),
    };
    const handler = actionBodyRunnerFactory(new QuickJSScriptRunner(), {
      ql: engine, appId: 'probe', logger, i18n: hookRefusalI18nReader({ getService: getService as never }), getService,
    })(action);
    expect(handler, 'the action body must bind').toBeTypeOf('function');
    const objectKey = options.objectLess ? GLOBAL_KEY : CONTACT.name;
    engine.registerAction(objectKey, ACTION_NAME, handler!, 'probe');
    return { engine, asked, objectKey };
  }

  /**
   * Run the action as a caller whose own language is en-US, in organization
   * `org_a` — the context the REST and MCP action doors hand a handler
   * (`buildActionSession`: `session.organizationId` from the caller's
   * `tenantId`) — and answer the stored activity subjects. The
   * `ObjectRepository.execute` door, which passes no `session`, has its own case.
   */
  async function sendEmail(
    stack: { engine: ObjectQL; objectKey: string },
    params: { subject: string; key?: string },
  ): Promise<string[]> {
    const executionContext = { userId: 'u_probe', tenantId: 'org_a', locale: 'en-US' };
    await stack.engine.executeAction(stack.objectKey, ACTION_NAME, {
      params: { ...params, recordId: 'c1' },
      session: { userId: 'u_probe', organizationId: 'org_a' },
      executionContext,
    });
    const rows: any[] = await stack.engine.find(ACTIVITY.name, SYSTEM_READ);
    return rows.map((r) => r.subject);
  }

  it('writes the app default language\'s translation at the bound address for an en-US caller, holes filled; CONTROL: the globalActions sentence is not read', async () => {
    const stack = await makeStack({
      defaultLocale: 'zh-CN',
      bundles: { 'zh-CN': bundle(ZH, '（全局）邮件：{{ subject }}'), 'en-US': bundle('EN-US VARIANT {{ subject }}') },
    });
    expect(await sendEmail(stack, { subject: 'Q3 renewal' })).toEqual(['邮件：Q3 renewal']);
  }, 30000);

  it('an object-less action reads `globalActions.<action>.texts.<key>.message`; CONTROL: an object\'s sentence is not read', async () => {
    const stack = await makeStack({
      objectLess: true,
      defaultLocale: 'zh-CN',
      bundles: { 'zh-CN': bundle('（对象）邮件：{{ subject }}', ZH) },
    });
    expect(await sendEmail(stack, { subject: 'Q3 renewal' })).toEqual(['邮件：Q3 renewal']);
  }, 30000);

  it('writes the language somebody SET in Localization, asked for the caller\'s organization; CONTROL: the default placeholder does not count', async () => {
    const bundles = { 'zh-CN': bundle(ZH), 'ja-JP': bundle(JA) };
    const set = await makeStack({ defaultLocale: 'zh-CN', bundles, settings: { value: 'ja-JP', source: 'organization' } });
    expect(await sendEmail(set, { subject: 'Q3 renewal' })).toEqual(['メール：Q3 renewal']);
    expect(set.asked).toContainEqual({ tenantId: 'org_a' });
    await reset();

    const placeholder = await makeStack({ defaultLocale: 'zh-CN', bundles, settings: { value: 'en-US', source: 'default' } });
    expect(await sendEmail(placeholder, { subject: 'Q3 renewal' })).toEqual(['邮件：Q3 renewal']);
  }, 30000);

  it('through repo.execute (tenantId, no session) writes the language SET in Localization for the caller\'s organization', async () => {
    // `ObjectRepository.execute` hands the handler the caller's `tenantId` and
    // an elevated `executionContext`, but no `session`: the organization is read
    // off the body's own door caller (`executionContext.tenantId` first).
    const stack = await makeStack({
      defaultLocale: 'zh-CN',
      bundles: { 'zh-CN': bundle(ZH), 'ja-JP': bundle(JA) },
      orgSettings: { org_a: { value: 'ja-JP', source: 'organization' } },
    });
    await stack.engine
      .createContext({ userId: 'u_probe', tenantId: 'org_a' })
      .object(CONTACT.name)
      .execute(ACTION_NAME, { params: { subject: 'Q3 renewal', recordId: 'c1' } });
    const rows: any[] = await stack.engine.find(ACTIVITY.name, SYSTEM_READ);
    expect(rows.map((r) => r.subject)).toEqual(['メール：Q3 renewal']);
    expect(stack.asked).toContainEqual({ tenantId: 'org_a' });
  }, 30000);

  it('writes the declared sentence, holes filled, when the organization\'s language has no translation — and the action goes on', async () => {
    const stack = await makeStack({ defaultLocale: 'fr-FR', bundles: { 'zh-CN': bundle(ZH) } });
    expect(await sendEmail(stack, { subject: 'Q3 renewal' })).toEqual(['Email: Q3 renewal']);
  }, 30000);

  it('writes the declared sentence, filled, when the translation\'s holes do not render — never the braces; CONTROL: a translation that renders is written', async () => {
    const warnings: string[] = [];
    const broken = await makeStack({ defaultLocale: 'zh-CN', bundles: { 'zh-CN': bundle('邮件：{{ subject | shout }}') }, warnings });
    expect(await sendEmail(broken, { subject: 'Q3 renewal' })).toEqual(['Email: Q3 renewal']);
    expect(warnings.some((w) => w.includes(`action '${ACTION_NAME}': the zh-CN translation of its text 'email_subject' did not render`)
      && w.includes('so the declared text is written'))).toBe(true);
    await reset();

    const control = await makeStack({ defaultLocale: 'zh-CN', bundles: { 'zh-CN': bundle('邮件：{{ subject | upper }}') } });
    expect(await sendEmail(control, { subject: 'Q3 renewal' })).toEqual(['邮件：Q3 RENEWAL']);
  }, 30000);

  it('answers an unregistered Localization setting as not set (the app default writes); any other settings failure refuses the action with nothing written', async () => {
    const unregistered = await makeStack({
      defaultLocale: 'zh-CN', bundles: { 'zh-CN': bundle(ZH) },
      settings: () => { throw Object.assign(new Error('unknown key'), { code: 'SETTINGS_UNKNOWN_KEY' }); },
    });
    expect(await sendEmail(unregistered, { subject: 'Q3 renewal' })).toEqual(['邮件：Q3 renewal']);
    await reset();

    const broken = await makeStack({
      defaultLocale: 'zh-CN', bundles: { 'zh-CN': bundle(ZH) },
      settings: () => { throw Object.assign(new Error('settings store unavailable'), { code: 'SETTINGS_STORE_UNAVAILABLE' }); },
    });
    await expect(sendEmail(broken, { subject: 'Q3 renewal' })).rejects.toThrow(/settings store unavailable/);
    expect(await broken.engine.find(ACTIVITY.name, SYSTEM_READ)).toEqual([]);
  }, 30000);

  it('refuses a key the action does not declare, naming the action and the key, with nothing written', async () => {
    const stack = await makeStack({ defaultLocale: 'zh-CN', bundles: { 'zh-CN': bundle(ZH) } });
    await expect(sendEmail(stack, { subject: 'Q3 renewal', key: 'email_body' })).rejects.toThrow(
      /action 'send_email' asked for text 'email_body'.*declared: 'email_subject'/,
    );
    expect(await stack.engine.find(ACTIVITY.name, SYSTEM_READ)).toEqual([]);
  }, 30000);

  it('refuses ctx.text on an action that declares no texts, naming none declared', async () => {
    const stack = await makeStack({ defaultLocale: 'zh-CN', texts: null });
    await expect(sendEmail(stack, { subject: 'Q3 renewal' })).rejects.toThrow(
      /action 'send_email' asked for text 'email_subject'.*declared: none/,
    );
  }, 30000);
});

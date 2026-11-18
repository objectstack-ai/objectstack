// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34374, ruling 6913660232 option B, parameter 7] A sentence a hook writes
 * into a record for people to read is written in the ORGANIZATION's language.
 *
 * The hook declares it (`HookSchema.texts`) and asks for it by key —
 * `await ctx.text('follow_up_subject', { lead })` — and the runtime answers
 * the translation `hooks.<hook>.texts.<key>.message` in the organization's
 * language (the Localization setting somebody set, else the app's
 * `i18n.defaultLocale`; never the caller's), the declared sentence on a miss,
 * its holes filled after.
 *
 * The HotCRM shape this card carries (hotcrm#2494): an `afterUpdate` hook that
 * opens a follow-up task when a lead qualifies, titled with the lead's name.
 * Same wiring as the sibling signal pins: the REAL `ObjectQL` + REAL
 * `SqlDriver` (better-sqlite3) + REAL `QuickJSScriptRunner` behind
 * `hookBodyRunnerFactory`, with the REAL in-memory `i18n` service; the
 * in-process half runs through the binder's own `wrapHandler` seam,
 * `withInProcessHookTitle`, as `bindAppArtifactHandlers` composes it. Every
 * assertion lands on the task row the hook stored.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL, bindHooksToEngine } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { createMemoryI18n } from '@objectstack/core';
import type { DataEngineInsertOptions, EngineQueryOptions, EngineUpdateOptions } from '@objectstack/spec/data';
import { hookBodyRunnerFactory, withInProcessHookTitle } from './body-runner.js';
import { hookRefusalI18nReader } from './hook-refusal-catalogue.js';
import { QuickJSScriptRunner } from './quickjs-runner.js';
import {
  captureExpectedReadRefusals,
  type ExpectedReadRefusalCapture,
} from '../expected-read-refusal-noise.js';

const LEAD = { name: 'probe_text_lead', fields: { name: { type: 'text' }, status: { type: 'text' } } };
const TASK = { name: 'probe_text_task', fields: { subject: { type: 'text' }, lead_id: { type: 'text' } } };

const HOOK_NAME = 'probe_lead_follow_up';
const EN = 'Follow up with qualified lead: {{ lead }}';
const ZH = '跟进已认定线索：{{ lead }}';
const JA = '有望リードのフォローアップ：{{ lead }}';

/** The body the build lowers the HotCRM handler to: one declared text, asked for by key. */
const BODY_SOURCE = `
  if (ctx.input.status !== 'qualified') return;
  var subject = await ctx.text(ctx.input.name === 'Undeclared' ? 'no_such_text' : 'follow_up_subject', { lead: ctx.input.name });
  await ctx.api.object('${TASK.name}').insert({ subject: subject, lead_id: ctx.input.id });
`;

/** The same hook as an in-process handler (a source boot runs it unlowered). */
async function inProcessHandler(ctx: any): Promise<void> {
  if (ctx.input.status !== 'qualified') return;
  const subject = await ctx.text('follow_up_subject', { lead: ctx.input.name });
  await ctx.api.object(TASK.name).insert({ subject, lead_id: ctx.input.id });
}

const TEXTS = { follow_up_subject: { message: EN, params: ['lead'] } };

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
  /** Run the hook in-process (a `handler`) instead of as a sandboxed body. */
  inProcess?: boolean;
  /** Collects every `logger.warn` line the runtime writes. */
  warnings?: string[];
}

const ABSENT_TENANCY_TABLE = 'sys_organization';

function bundle(sentence: string) {
  return { hooks: { [HOOK_NAME]: { texts: { follow_up_subject: { message: sentence } } } } };
}

describe('#34374 — a hook writes its declared text in the organization\'s language (ctx.text)', () => {
  let engine: ObjectQL | null = null;
  let dir: string | null = null;
  let noise: ExpectedReadRefusalCapture | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
  });

  async function makeStack(options: StackOptions = {}) {
    dir = mkdtempSync(join(tmpdir(), 'os-34374-'));
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'data.sqlite') }, useNullAsDefault: true });
    noise = captureExpectedReadRefusals([ABSENT_TENANCY_TABLE]);
    noise.captureDriver(driver);
    await driver.initObjects([LEAD, TASK]);
    engine = new ObjectQL();
    noise.captureEngine(engine);
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(LEAD as any, 'probe');
    engine.registry.registerObject(TASK as any, 'probe');

    const i18n = createMemoryI18n();
    if (options.defaultLocale) i18n.setDefaultLocale(options.defaultLocale);
    for (const [locale, data] of Object.entries(options.bundles ?? {})) i18n.loadTranslations(locale, data);
    const asked: Array<{ tenantId?: string } | undefined> = [];
    const settings = options.settings === undefined ? undefined : {
      async get(_ns: string, _key: string, ctx?: { tenantId?: string }) {
        asked.push(ctx);
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
    const i18nSource = hookRefusalI18nReader({ getService: getService as never });
    const logger = {
      debug: () => {}, info: () => {}, error: () => {},
      warn: (...args: unknown[]) => { options.warnings?.push(args.map(String).join(' ')); },
    };

    if (options.inProcess) {
      const hook = { name: HOOK_NAME, object: LEAD.name, events: ['afterUpdate'], handler: inProcessHandler, texts: TEXTS };
      bindHooksToEngine(engine, [hook as any], {
        packageId: 'probe',
        wrapHandler: (handler, bound) => withInProcessHookTitle(handler as any, engine, bound as any, {
          i18n: i18nSource, getService, logger,
        }),
      });
    } else {
      engine.setDefaultBodyRunner(
        hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql: engine, appId: 'probe', logger, i18n: i18nSource, getService }),
      );
      bindHooksToEngine(engine, [{
        name: HOOK_NAME,
        object: LEAD.name,
        events: ['afterUpdate'],
        body: { language: 'js', source: BODY_SOURCE, capabilities: ['api.read', 'api.write'] },
        texts: TEXTS,
      } as any], { packageId: 'probe' });
    }
    return { engine, asked };
  }

  /** Qualify a lead as a caller whose own language is en-US, in organization `org_a`; answer the stored task subjects. */
  async function qualify(ql: ObjectQL, name: string): Promise<string[]> {
    const context = { userId: 'u_probe', isSystem: true, tenantId: 'org_a', locale: 'en-US' };
    const asCaller: DataEngineInsertOptions = { context };
    const lead: any = await ql.insert(LEAD.name, { name, status: 'new' }, asCaller);
    // The update carries the name, so the hook reads it from its own input.
    const qualifyIt: EngineUpdateOptions = { context, where: { id: lead.id } };
    await ql.update(LEAD.name, { name, status: 'qualified' }, qualifyIt);
    const tasks: any[] = await ql.find(TASK.name, SYSTEM_READ);
    return tasks.map((t) => t.subject);
  }

  for (const inProcess of [false, true]) {
    const path = inProcess ? 'in-process handler' : 'sandboxed body';

    describe(path, () => {
      it('writes the app default language\'s translation for an en-US caller (no Localization setting), holes filled', async () => {
        const { engine: ql } = await makeStack({
          inProcess, defaultLocale: 'zh-CN', bundles: { 'zh-CN': bundle(ZH), 'en-US': bundle('EN-US VARIANT {{ lead }}') },
        });
        expect(await qualify(ql, 'Acme')).toEqual(['跟进已认定线索：Acme']);
      }, 30000);

      it('writes the language somebody SET in Localization, asked for the write\'s organization; CONTROL: the default placeholder does not count', async () => {
        const bundles = { 'zh-CN': bundle(ZH), 'ja-JP': bundle(JA) };
        const set = await makeStack({ inProcess, defaultLocale: 'zh-CN', bundles, settings: { value: 'ja-JP', source: 'organization' } });
        expect(await qualify(set.engine, 'Acme')).toEqual(['有望リードのフォローアップ：Acme']);
        expect(set.asked).toContainEqual({ tenantId: 'org_a' });
        await engine?.destroy(); engine = null;
        if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }

        const placeholder = await makeStack({ inProcess, defaultLocale: 'zh-CN', bundles, settings: { value: 'en-US', source: 'default' } });
        expect(await qualify(placeholder.engine, 'Acme')).toEqual(['跟进已认定线索：Acme']);
      }, 30000);

      it('writes the declared sentence, holes filled, when the organization\'s language has no translation — and the hook goes on', async () => {
        const { engine: ql } = await makeStack({ inProcess, defaultLocale: 'fr-FR', bundles: { 'zh-CN': bundle(ZH) } });
        expect(await qualify(ql, 'Acme')).toEqual(['Follow up with qualified lead: Acme']);
      }, 30000);

      it('writes the declared sentence, filled, when the translation\'s holes do not render — never the braces; CONTROL: a translation that renders is written', async () => {
        const warnings: string[] = [];
        const { engine: ql } = await makeStack({
          inProcess, defaultLocale: 'zh-CN', bundles: { 'zh-CN': bundle('跟进已认定线索：{{ lead | shout }}') }, warnings,
        });
        expect(await qualify(ql, 'Acme')).toEqual(['Follow up with qualified lead: Acme']);
        expect(warnings.some((w) => w.includes("the zh-CN translation of its text 'follow_up_subject' did not render")
          && w.includes('so the declared text is written'))).toBe(true);
        await engine?.destroy(); engine = null;
        if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }

        const control = await makeStack({ inProcess, defaultLocale: 'zh-CN', bundles: { 'zh-CN': bundle('跟进：{{ lead | upper }}') } });
        expect(await qualify(control.engine, 'Acme')).toEqual(['跟进：ACME']);
      }, 30000);

      it('answers an unregistered Localization setting as not set (the app default writes); any other settings failure refuses the write', async () => {
        const unregistered = await makeStack({
          inProcess, defaultLocale: 'zh-CN', bundles: { 'zh-CN': bundle(ZH) },
          settings: () => { throw Object.assign(new Error('unknown key'), { code: 'SETTINGS_UNKNOWN_KEY' }); },
        });
        expect(await qualify(unregistered.engine, 'Acme')).toEqual(['跟进已认定线索：Acme']);
        await engine?.destroy(); engine = null;
        if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }

        const broken = await makeStack({
          inProcess, defaultLocale: 'zh-CN', bundles: { 'zh-CN': bundle(ZH) },
          settings: () => { throw Object.assign(new Error('settings store unavailable'), { code: 'SETTINGS_STORE_UNAVAILABLE' }); },
        });
        await expect(qualify(broken.engine, 'Acme')).rejects.toThrow(/settings store unavailable/);
        const tasks: any[] = await broken.engine.find(TASK.name, SYSTEM_READ);
        expect(tasks).toEqual([]);
      }, 30000);
    });
  }

  it('refuses a key the hook does not declare, naming the hook and the key (sandboxed body)', async () => {
    const { engine: ql } = await makeStack({ defaultLocale: 'zh-CN', bundles: { 'zh-CN': bundle(ZH) } });
    await expect(qualify(ql, 'Undeclared')).rejects.toThrow(
      /hook 'probe_lead_follow_up' asked for text 'no_such_text'.*declared: 'follow_up_subject'/,
    );
    expect(noise?.tablesSeen() ?? ['no capture was installed']).toEqual([]);
  }, 30000);
});

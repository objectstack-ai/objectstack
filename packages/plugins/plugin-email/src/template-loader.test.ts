// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The registry email-template loader (ADR-0131 D6/D10, ruling C on §6 Q1).
 *
 * This file used to pin `bootstrapDeclaredEmailTemplates`, the bridge that
 * copied declared `email_template` metadata into the `sys_email_template` rows
 * `sendTemplate` read (#4509). The rows are gone from the send path, so each
 * pin that asked "does the AUTHORED wording reach the send?" is restated here
 * against the read that replaced them:
 *
 *  - a declaration materialized with the shared mapping → it resolves with its
 *    authored wording, `bodyHtml` included;
 *  - rows keyed by `(name, locale)` → bundle members resolve one by one;
 *  - the effective template the door serves is what got projected (#21785) →
 *    it is what resolves, read in no organization (ADR-0131 D6);
 *  - a failed effective read projected nothing, never the package layer → a
 *    failed read propagates, never answered from the registry;
 *  - the live runtime-write path took effect without a restart → every load
 *    re-reads, so a save is live on the next send;
 *  - a withdrawn template's rows were deactivated → it resolves to nothing;
 *  - optional columns were omitted, never nulled → so are the render input's;
 *  - the `content` alias reached the schema as a document (#8378) → it still
 *    does, and the refusal is LOUD: a malformed item is never skipped down to
 *    the built-in copy.
 *
 * The row-only mechanics — seed-not-clobber, provenance adoption, the bulk read
 * of stored rows (#22062) — retired with the rows they managed; the plugin
 * writes no `sys_email_template` row at all (pinned in
 * `email-plugin.template-runtime-write.test.ts`).
 */

import { describe, expect, it } from 'vitest';
import {
  BUILTIN_EMAIL_TEMPLATES_PACKAGE_ID,
  createRegistryEmailTemplateLoader,
} from './template-loader.js';

type AnyRecord = Record<string, any>;

const APP_PACKAGE = 'com.example.app';
const AUTHORED = 'Reset your password, {{user.name}}';
const BUILTIN = 'Built-in: reset your password';
const OVERLAY = 'Admin reworded: reset for {{user.name}}';

function declared(over: AnyRecord = {}): AnyRecord {
  return {
    name: 'auth.password_reset',
    label: 'Password Reset',
    subject: AUTHORED,
    bodyHtml: '<p>Click <a href="{{url}}">here</a></p>',
    variables: [{ name: 'url', type: 'string', required: true }],
    _packageId: APP_PACKAGE,
    ...over,
  };
}

const builtin = (over: AnyRecord = {}) =>
  declared({ subject: BUILTIN, _packageId: BUILTIN_EMAIL_TEMPLATES_PACKAGE_ID, ...over });

/**
 * The protocol's execution list as the metadata door serves it: one item per
 * `(package, name, locale)` slot, the environment's item already merged over
 * the declaration it overrides. Every request is recorded, so what the loader
 * asked for is asserted rather than assumed. `items` is read at call time.
 */
function layeredProtocol(items: AnyRecord[] | (() => AnyRecord[])) {
  const requests: AnyRecord[] = [];
  return {
    requests,
    async getMetaItemsForExecution(request: { type: string }) {
      requests.push({ ...request });
      const list = typeof items === 'function' ? items() : items;
      return { type: request.type, items: list.map((i) => ({ ...i })) };
    },
  };
}

function registry(items: AnyRecord[]) {
  const reads: string[] = [];
  return { reads, listItems: (type: string) => { reads.push(type); return items.map((i) => ({ ...i })); } };
}

describe('createRegistryEmailTemplateLoader — what it reads', () => {
  it('resolves a declaration with its AUTHORED wording, read in no organization', async () => {
    const protocol = layeredProtocol([declared()]);
    const loader = createRegistryEmailTemplateLoader({ protocol });

    const found = await loader.load('auth.password_reset', 'en-US');

    // [ADR-0131 D6] The read names no organization: environment → code.
    expect(protocol.requests).toEqual([{ type: 'email_template' }]);
    expect(found).toMatchObject({
      name: 'auth.password_reset',
      locale: 'en-US',
      subject: AUTHORED,
      body_html: '<p>Click <a href="{{url}}">here</a></p>',
      active: true,
    });
    expect(JSON.parse(found!.variables_json!)).toEqual([{ name: 'url', type: 'string', required: true }]);
  });

  it('keys by (name, locale): each member of a bundle resolves on its own', async () => {
    const loader = createRegistryEmailTemplateLoader({
      protocol: layeredProtocol([
        declared({ locale: 'zh-CN', subject: '重置密码' }),
        declared({ locale: 'en-US' }),
      ]),
    });

    expect((await loader.load('auth.password_reset', 'zh-CN'))?.subject).toBe('重置密码');
    expect((await loader.load('auth.password_reset', 'en-US'))?.subject).toBe(AUTHORED);
    expect(await loader.load('auth.password_reset', 'ja-JP')).toBeNull();
  });

  it('resolves the environment item the door serves over the declaration (#21785)', async () => {
    // The layered list has already put the Studio save over the package's
    // declaration in its slot; the loader takes what the door serves.
    const loader = createRegistryEmailTemplateLoader({
      protocol: layeredProtocol([declared({ subject: OVERLAY })]),
      registry: registry([declared()]),
    });

    expect((await loader.load('auth.password_reset', 'en-US'))?.subject).toBe(OVERLAY);
  });

  it('propagates a failed read — never answers it from the registry\'s package wording', async () => {
    const reg = registry([declared()]);
    const loader = createRegistryEmailTemplateLoader({
      protocol: { async getMetaItemsForExecution(): Promise<never> { throw new Error('sys_metadata read failed'); } },
      registry: reg,
    });

    await expect(loader.load('auth.password_reset', 'en-US')).rejects.toThrow('sys_metadata read failed');
    expect(reg.reads).toEqual([]);
  });

  it('reads the registry only when no protocol is registered (a host with no metadata door)', async () => {
    const reg = registry([declared()]);
    const loader = createRegistryEmailTemplateLoader({ registry: reg });

    expect((await loader.load('auth.password_reset', 'en-US'))?.subject).toBe(AUTHORED);
    expect(reg.reads).toEqual(['email_template']);
  });

  it('re-reads at every load, so a save is live on the next send with no projection and no restart', async () => {
    let items = [declared()];
    const protocol = layeredProtocol(() => items);
    const loader = createRegistryEmailTemplateLoader({ protocol });

    expect((await loader.load('auth.password_reset', 'en-US'))?.subject).toBe(AUTHORED);
    items = [declared({ subject: OVERLAY })];
    expect((await loader.load('auth.password_reset', 'en-US'))?.subject).toBe(OVERLAY);
    expect(protocol.requests).toHaveLength(2);
  });

  it('resolves the sources at every load, so a protocol registered after wiring is seen', async () => {
    let sources: AnyRecord = { registry: registry([declared()]) };
    const loader = createRegistryEmailTemplateLoader(() => sources);

    expect((await loader.load('auth.password_reset', 'en-US'))?.subject).toBe(AUTHORED);
    sources = { ...sources, protocol: layeredProtocol([declared({ subject: OVERLAY })]) };
    expect((await loader.load('auth.password_reset', 'en-US'))?.subject).toBe(OVERLAY);
  });

  it('strips the read decorations the strict schema refuses, keeping the declared envelope', async () => {
    const loader = createRegistryEmailTemplateLoader({
      protocol: layeredProtocol([declared({ _diagnostics: { valid: true }, _draft: false, _provenance: 'package' })]),
    });

    expect((await loader.load('auth.password_reset', 'en-US'))?.subject).toBe(AUTHORED);
  });

  it('a withdrawn template resolves to nothing', async () => {
    let items = [declared()];
    const loader = createRegistryEmailTemplateLoader({ protocol: layeredProtocol(() => items) });
    expect(await loader.load('auth.password_reset', 'en-US')).not.toBeNull();

    items = [];
    expect(await loader.load('auth.password_reset', 'en-US')).toBeNull();
    expect(await loader.load('auth.password_reset', undefined)).toBeNull();
  });
});

describe('createRegistryEmailTemplateLoader — which item wins one (name, locale)', () => {
  it('an app\'s declaration wins over the built-in copy, in either list order', async () => {
    for (const items of [[builtin(), declared()], [declared(), builtin()]]) {
      const loader = createRegistryEmailTemplateLoader({ protocol: layeredProtocol(items) });
      expect((await loader.load('auth.password_reset', 'en-US'))?.subject).toBe(AUTHORED);
    }
  });

  it('a package-less environment item wins over the built-in copy', async () => {
    const loader = createRegistryEmailTemplateLoader({
      protocol: layeredProtocol([builtin(), declared({ subject: OVERLAY, _packageId: undefined })]),
    });

    expect((await loader.load('auth.password_reset', 'en-US'))?.subject).toBe(OVERLAY);
  });

  it('the built-in still serves a locale the app does not declare', async () => {
    const loader = createRegistryEmailTemplateLoader({
      protocol: layeredProtocol([builtin(), builtin({ locale: 'zh-CN', subject: '内置' }), declared()]),
    });

    expect((await loader.load('auth.password_reset', 'en-US'))?.subject).toBe(AUTHORED);
    expect((await loader.load('auth.password_reset', 'zh-CN'))?.subject).toBe('内置');
  });
});

describe('createRegistryEmailTemplateLoader — the render input', () => {
  it('omits optional keys rather than nulling them, so the text part is derived only when no bodyText was authored', async () => {
    const loader = createRegistryEmailTemplateLoader({
      protocol: layeredProtocol([declared({ name: 'ops.digest', variables: [] })]),
    });

    const found = await loader.load('ops.digest', 'en-US');

    expect(found).not.toHaveProperty('body_text');
    expect(found).not.toHaveProperty('reply_to');
    expect(found).not.toHaveProperty('from_address');
    expect(found).not.toHaveProperty('from_name');
    expect(found).not.toHaveProperty('variables_json');
  });

  it('carries every authored envelope key the sender reads', async () => {
    const loader = createRegistryEmailTemplateLoader({
      protocol: layeredProtocol([declared({
        bodyText: 'Reset: {{url}}',
        fromOverride: { name: 'Security', address: 'security@example.test' },
        replyTo: 'help@example.test',
        active: false,
      })]),
    });

    expect(await loader.load('auth.password_reset', 'en-US')).toMatchObject({
      body_text: 'Reset: {{url}}',
      from_address: 'security@example.test',
      from_name: 'Security',
      reply_to: 'help@example.test',
      active: false,
    });
  });

  it('applies the schema defaults: a declaration naming no locale and no `active` is an active en-US member', async () => {
    const loader = createRegistryEmailTemplateLoader({ protocol: layeredProtocol([declared()]) });

    expect(await loader.load('auth.password_reset', 'en-US')).toMatchObject({ locale: 'en-US', active: true });
  });
});

/**
 * `content` is a spelling an author really can write on an email template —
 * `EmailTemplateDefinitionSchema` lists it in its `strictObject` aliases table
 * (`content: 'bodyHtml'`). That table is a REJECTION facility, not a
 * conversion: it builds the message of the `unrecognized_keys` refusal. It
 * reaches this read only through a door that skips validation (a
 * `defineStack(…, { strict: false })` load, a hand-built manifest), and the
 * refusal must then carry the author's fix — and must not fall through to the
 * built-in copy of the same slot, the mail the author believed they replaced.
 */
describe('createRegistryEmailTemplateLoader — a malformed item is refused, never skipped (#8378)', () => {
  it('refuses the `content` spelling with the `content` → `bodyHtml` fix, over a built-in of the same slot', async () => {
    // `bodyHtml` deliberately absent — `content` is the author's attempt at it.
    const malformed: AnyRecord = { ...declared(), content: '<h1>Welcome</h1>' };
    delete malformed.bodyHtml;
    const loader = createRegistryEmailTemplateLoader({ protocol: layeredProtocol([builtin(), malformed]) });

    const err = await loader.load('auth.password_reset', 'en-US').then(
      () => { throw new Error('the malformed template resolved'); },
      (e: Error) => e,
    );
    expect(err.message).toContain('auth.password_reset');
    expect(err.message).toContain('content');
    expect(err.message).toContain('bodyHtml');
    expect(err.message).not.toContain('expected object, received string');
  });

  it('does not silently vanish when `content` is the empty string', async () => {
    const loader = createRegistryEmailTemplateLoader({
      protocol: layeredProtocol([{ name: 'ops.digest', label: 'Digest', subject: 'Daily', content: '' }]),
    });

    await expect(loader.load('ops.digest', 'en-US')).rejects.toThrow(/ops\.digest/);
  });
});

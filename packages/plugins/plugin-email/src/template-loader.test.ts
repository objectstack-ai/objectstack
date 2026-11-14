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
import { SchemaRegistry } from '@objectstack/objectql';
import {
  BUILTIN_EMAIL_TEMPLATES_PACKAGE_ID,
  EmailTemplateAmbiguousError,
  createRegistryEmailTemplateLoader,
} from './template-loader.js';
import { PLATFORM_REQUESTED_BARE_NAMES_BY_TYPE } from '@objectstack/core';
import { BUILTIN_AUTH_TEMPLATES } from './templates/auth-templates.js';

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

describe('createRegistryEmailTemplateLoader — the name resolves by (package, name) (ADR-0150 D3)', () => {
  const OTHER_PACKAGE = 'com.example.other';

  /** A real registry: each id installed as a code package, shipping `items` in its composite slot. */
  function registryShipping(shipped: Array<[string, AnyRecord]>): SchemaRegistry {
    const reg = new SchemaRegistry();
    reg.logLevel = 'silent';
    for (const [id, item] of shipped) {
      if (!reg.getPackage(id)) {
        reg.installPackage({ id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop() } as never, 'code');
      }
      const { _packageId: _drop, ...body } = item;
      reg.registerItem('email_template', body, 'name' as never, id);
    }
    return reg;
  }

  it('one package holder beside the built-in: resolves, and the layered list answers as before', async () => {
    const reg = registryShipping([[BUILTIN_EMAIL_TEMPLATES_PACKAGE_ID, builtin()], [APP_PACKAGE, declared()]]);
    const loader = createRegistryEmailTemplateLoader({ protocol: layeredProtocol([builtin(), declared()]), registry: reg });
    expect((await loader.load('auth.password_reset', 'en-US'))?.subject).toBe(AUTHORED);
  });

  it('two package holders: the send is refused with the 409 conflict naming both — never the first listed', async () => {
    const other = declared({ subject: 'Other wording', _packageId: OTHER_PACKAGE });
    const reg = registryShipping([[APP_PACKAGE, declared()], [OTHER_PACKAGE, other]]);
    const loader = createRegistryEmailTemplateLoader({ protocol: layeredProtocol([declared(), other]), registry: reg });

    const err = await loader.load('auth.password_reset', 'en-US').then(() => undefined, (e: unknown) => e);
    expect(err).toBeInstanceOf(EmailTemplateAmbiguousError);
    expect(err).toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409, template: 'auth.password_reset' });
    expect((err as EmailTemplateAmbiguousError).candidates).toEqual([
      { kind: 'package', packageId: APP_PACKAGE },
      { kind: 'package', packageId: OTHER_PACKAGE },
    ]);
    expect((err as Error).message).toContain(`"${APP_PACKAGE}"`);
    expect((err as Error).message).toContain(`"${OTHER_PACKAGE}"`);
    // No locale escapes it: the name is refused before any bundle is read.
    await expect(loader.load('auth.password_reset', undefined)).rejects.toBeInstanceOf(EmailTemplateAmbiguousError);
  });
});

describe('the auth mails the platform sends are the platform-requested email template names (ADR-0150 D3 Exceptions, #31699)', () => {
  it('core\'s list is exactly the names of the built-in auth templates, so every one keeps one overriding package', () => {
    expect([...(PLATFORM_REQUESTED_BARE_NAMES_BY_TYPE.email_template ?? [])].sort())
      .toEqual([...new Set(BUILTIN_AUTH_TEMPLATES.map((t) => t.name))].sort());
  });
});

/**
 * [ADR-0150 D3, #31699 F1] The send resolves the template name from the
 * package it is made from, so two namespaces' same-named templates are each
 * sent by their own package; a send that names no package keeps the bare-name
 * meaning, one rung at a time.
 */
describe('createRegistryEmailTemplateLoader — the send resolves the name from the caller\'s package (ADR-0150 D3, #31699)', () => {
  const ALPHA = 'com.example.alpha';
  const BETA = 'com.example.beta';
  const GAMMA = 'com.example.gamma';
  const DELTA = 'com.example.delta';
  const tpl = (packageId: string, over: AnyRecord = {}): AnyRecord => ({
    name: 'welcome', label: 'Welcome', subject: `${packageId.split('.').pop()} welcome`, bodyHtml: '<p>hi</p>',
    _packageId: packageId, ...over,
  });

  /** A real registry: each `[id, deps]` installed as a code package of its own namespace, shipping `items`. */
  function registryOf(packages: Array<[string, string[]]>, shipped: AnyRecord[]): SchemaRegistry {
    const reg = new SchemaRegistry();
    reg.logLevel = 'silent';
    for (const [id, deps] of packages) {
      reg.installPackage({
        id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop(),
        ...(deps.length ? { dependencies: Object.fromEntries(deps.map((d) => [d, '^1.0.0'])) } : {}),
      } as never, 'code');
    }
    for (const item of shipped) {
      const { _packageId: id, ...body } = item;
      reg.registerItem('email_template', body, 'name' as never, id);
    }
    return reg;
  }

  /** The execution list, honouring the address a request names (`packageId`): that package's own items. */
  function addressedProtocol(items: AnyRecord[]) {
    const requests: AnyRecord[] = [];
    return {
      requests,
      async getMetaItemsForExecution(request: { type: string; packageId?: string }) {
        requests.push({ ...request });
        const list = request.packageId === undefined ? items : items.filter((i) => i._packageId === request.packageId);
        return { type: request.type, items: list.map((i) => ({ ...i })) };
      },
    };
  }

  const subjectOf = async (loader: ReturnType<typeof createRegistryEmailTemplateLoader>, callerPackageId?: string | null, locale = 'en-US') =>
    (await loader.load('welcome', locale, callerPackageId === undefined ? undefined : { callerPackageId }))?.subject;

  const twoNamespaces = () => {
    const items = [tpl(ALPHA), tpl(BETA)];
    const reg = registryOf([[ALPHA, []], [BETA, []], [GAMMA, [ALPHA]], [DELTA, []]], items);
    const protocol = addressedProtocol(items);
    return { protocol, loader: createRegistryEmailTemplateLoader({ protocol, registry: reg }) };
  };

  it('two namespaces ship the name: each package\'s send is its own template, read at its own address', async () => {
    const { protocol, loader } = twoNamespaces();
    expect(await subjectOf(loader, ALPHA)).toBe('alpha welcome');
    expect(await subjectOf(loader, BETA)).toBe('beta welcome');
    expect(protocol.requests.map((r) => r.packageId)).toEqual([ALPHA, BETA]);
  });

  it('a package that holds no template of the name sends the one holder of its declared closure', async () => {
    const { loader } = twoNamespaces();
    expect(await subjectOf(loader, GAMMA)).toBe('alpha welcome');
  });

  it('a package whose closure reaches no holder is refused with the 409 conflict naming the holders — never a pick', async () => {
    const { loader } = twoNamespaces();
    const err = await loader.load('welcome', 'en-US', { callerPackageId: DELTA }).then(() => undefined, (e: unknown) => e);
    expect(err).toBeInstanceOf(EmailTemplateAmbiguousError);
    expect(err).toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
    expect((err as EmailTemplateAmbiguousError).candidates).toEqual([
      { kind: 'package', packageId: ALPHA },
      { kind: 'package', packageId: BETA },
    ]);
  });

  it('a send with no package: two holders are refused naming both, whether the caller is omitted or null', async () => {
    const { loader } = twoNamespaces();
    for (const caller of [undefined, null]) {
      const err = await loader.load('welcome', 'en-US', caller === undefined ? undefined : { callerPackageId: caller })
        .then(() => undefined, (e: unknown) => e);
      expect(err).toBeInstanceOf(EmailTemplateAmbiguousError);
      expect((err as EmailTemplateAmbiguousError).candidates.map((c) => (c as { packageId?: string }).packageId)).toEqual([ALPHA, BETA]);
    }
  });

  it('a send with no package: the one package holder, read from the environment-wide list as before', async () => {
    const items = [tpl(ALPHA)];
    const protocol = addressedProtocol(items);
    const loader = createRegistryEmailTemplateLoader({ protocol, registry: registryOf([[ALPHA, []]], items) });
    expect(await subjectOf(loader)).toBe('alpha welcome');
    // A package caller of a one-holder name reads the same list, at no address.
    expect(await subjectOf(loader, ALPHA)).toBe('alpha welcome');
    expect(protocol.requests).toEqual([{ type: 'email_template' }, { type: 'email_template' }]);
  });

  it('a send with no package: the environment\'s own template, when no package holds the name', async () => {
    const env = { name: 'welcome', label: 'Welcome', subject: 'environment welcome', bodyHtml: '<p>e</p>' };
    const reg = registryOf([[ALPHA, []]], []);
    reg.registerItem('email_template', env, 'name' as never);
    const loader = createRegistryEmailTemplateLoader({ protocol: addressedProtocol([env]), registry: reg });
    expect(await subjectOf(loader)).toBe('environment welcome');
  });

  it('a dependent\'s added locale meets its base: the dependent\'s send reads its base\'s address, never the other namespace\'s', async () => {
    const items = [tpl(ALPHA), tpl(BETA), tpl(GAMMA, { locale: 'fr-FR', subject: 'gamma fr' })];
    const reg = registryOf([[ALPHA, []], [BETA, []], [GAMMA, [ALPHA]]], items);
    const protocol = addressedProtocol(items);
    const loader = createRegistryEmailTemplateLoader({ protocol, registry: reg });
    expect(await subjectOf(loader, GAMMA)).toBe('alpha welcome');
    expect(protocol.requests[protocol.requests.length - 1]).toEqual({ type: 'email_template', packageId: ALPHA });
  });

  it('with no protocol, the registry\'s own list is narrowed to the resolved holder alike', async () => {
    const items = [tpl(ALPHA), tpl(BETA)];
    const reg = registryOf([[ALPHA, []], [BETA, []]], items);
    const loader = createRegistryEmailTemplateLoader({ registry: reg });
    expect(await subjectOf(loader, BETA)).toBe('beta welcome');
    expect(await subjectOf(loader, ALPHA)).toBe('alpha welcome');
  });
});

/**
 * [ADR-0150 D3, #32183, epic ruling R4-A] The send door counts every holder, a
 * disabled package's included, so a reversible disable moves neither the
 * address the door asks the list for nor the refusal it throws: the door
 * answers as before this change. Judging the served holders here is #32670,
 * because the door reads a flat list after the resolve.
 *
 * The parity pin: each state, in both registration orders and on both reads
 * the loader takes, with every set of its holders disabled, gives every
 * caller the same ask as the same registry with nothing disabled. The ask is
 * spied, never the list's answer, so no stored row is needed: on the protocol
 * read it is the request's address; on the registry read, a probe list (an
 * environment-wide sentinel first, then one item per package) shows which
 * address the loader kept.
 */
describe('createRegistryEmailTemplateLoader — a disabled holder still counts at the send (ADR-0150 D3, #32183)', () => {
  const ALPHA = 'com.example.alpha';
  const BETA = 'com.example.beta';
  const BOTH = 'com.example.both';
  const VIA_BETA = 'com.example.viabeta';
  const NEITHER = 'com.example.neither';
  const DEPENDENT = 'com.example.dependent';
  const PACKAGES: Array<[string, string[]]> = [
    [ALPHA, []], [BETA, []], [BOTH, [ALPHA, BETA]], [VIA_BETA, [BETA]], [NEITHER, []], [DEPENDENT, [ALPHA]],
  ];
  /** None (omitted, null), each holder, a closure holding both, a closure through BETA only, neither, the dependent. */
  const CALLERS: ReadonlyArray<[string, string | null | undefined]> = [
    ['omitted', undefined], ['null', null], ['ALPHA', ALPHA], ['BETA', BETA], ['BOTH', BOTH],
    ['VIA_BETA', VIA_BETA], ['NEITHER', NEITHER], ['DEPENDENT', DEPENDENT],
  ];
  /** The `welcome` members each state ships, as `[package, locale]`; the dependent's is an added locale. */
  const STATES: Array<[string, Array<[string, string]>]> = [
    ['one holder', [[ALPHA, 'en-US']]],
    ['one holder and a dependent\'s addition', [[ALPHA, 'en-US'], [DEPENDENT, 'fr-FR']]],
    ['two holders', [[ALPHA, 'en-US'], [BETA, 'en-US']]],
    ['two holders and a dependent\'s addition', [[ALPHA, 'en-US'], [BETA, 'en-US'], [DEPENDENT, 'fr-FR']]],
  ];
  const ORDERS: Array<[string, boolean]> = [['as listed', false], ['reversed', true]];
  const READS = ['protocol', 'registry'] as const;
  const ENVIRONMENT_WIDE = 'environment-wide';

  /** A real registry: PACKAGES installed and `shipped` registered in order (or reversed), then `disabled` disabled. */
  function registryOf(shipped: Array<[string, string]>, reversed: boolean, disabled: readonly string[]): SchemaRegistry {
    const reg = new SchemaRegistry();
    reg.logLevel = 'silent';
    const packages = reversed ? [...PACKAGES].reverse() : PACKAGES;
    for (const [id, deps] of packages) {
      reg.installPackage({
        id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop(),
        ...(deps.length ? { dependencies: Object.fromEntries(deps.map((d) => [d, '^1.0.0'])) } : {}),
      } as never, 'code');
    }
    for (const [id, locale] of reversed ? [...shipped].reverse() : shipped) {
      reg.registerItem('email_template', {
        name: 'welcome', label: 'Welcome', locale, subject: `${id} ${locale}`, bodyHtml: '<p>hi</p>',
      }, 'name' as never, id);
    }
    for (const id of disabled) reg.disablePackage(id);
    return reg;
  }

  /** Every non-empty set of `ids`. */
  function nonEmptySets(ids: readonly string[]): string[][] {
    return ids.reduce<string[][]>((sets, id) => [...sets, ...sets.map((s) => [...s, id]), [id]], [])
      .sort((a, b) => a.length - b.length);
  }

  type Ask = { address: string | null } | { refused: number; candidates: string[]; message: string };

  /** What the door asks for one caller: the list's address (`null`: the environment-wide list), or its refusal. */
  async function askOf(reg: SchemaRegistry, read: (typeof READS)[number], caller: string | null | undefined): Promise<Ask> {
    const requested: Array<string | null> = [];
    const probe = [
      { name: 'welcome', label: 'Welcome', subject: ENVIRONMENT_WIDE, bodyHtml: '<p>e</p>' },
      ...PACKAGES.map(([id]) => ({ name: 'welcome', label: 'Welcome', subject: id, bodyHtml: '<p>p</p>', _packageId: id })),
    ];
    const scoped = Object.fromEntries((['getPackage', 'getAllPackages', 'packageScopedHoldersOf', 'getPackageScopedItem', 'getEnvironmentScopedItem'] as const)
      .map((method) => [method, (reg[method] as (...args: unknown[]) => unknown).bind(reg)]));
    const loader = createRegistryEmailTemplateLoader(read === 'protocol'
      ? {
        registry: reg,
        protocol: {
          async getMetaItemsForExecution(request: { type: string; packageId?: string }) {
            requested.push(request.packageId ?? null);
            return { items: [] };
          },
        },
      }
      : { registry: { ...scoped, listItems: () => probe.map((i) => ({ ...i })) } as never });
    try {
      const row = await loader.load('welcome', 'en-US', caller === undefined ? undefined : { callerPackageId: caller });
      if (read === 'protocol') {
        expect(requested).toHaveLength(1);
        return { address: requested[0] };
      }
      return { address: row?.subject === ENVIRONMENT_WIDE ? null : (row?.subject ?? 'NO ROW') };
    } catch (e) {
      if (!(e instanceof EmailTemplateAmbiguousError)) throw e;
      expect(requested).toEqual([]);
      return {
        refused: e.status,
        candidates: e.candidates.map((c) => (c.kind === 'package' ? c.packageId : c.kind)),
        message: e.message,
      };
    }
  }

  const asksOf = async (reg: SchemaRegistry, read: (typeof READS)[number]) => {
    const asks: Record<string, Ask> = {};
    for (const [label, caller] of CALLERS) asks[label] = await askOf(reg, read, caller);
    return asks;
  };

  /** The asks with nothing disabled, as `main` answers them (refusal candidates sorted, message left out). */
  const refused = (...candidates: string[]) => ({ refused: 409, candidates: [...candidates].sort() });
  const at = (address: string | null) => ({ address });
  const ONE_HOLDER = {
    omitted: at(null), null: at(null), ALPHA: at(null), BETA: refused(ALPHA), BOTH: at(null),
    VIA_BETA: refused(ALPHA), NEITHER: refused(ALPHA), DEPENDENT: at(null),
  };
  const TWO_HOLDERS = {
    omitted: refused(ALPHA, BETA), null: refused(ALPHA, BETA), ALPHA: at(ALPHA), BETA: at(BETA),
    BOTH: refused(ALPHA, BETA), VIA_BETA: at(BETA), NEITHER: refused(ALPHA, BETA), DEPENDENT: at(ALPHA),
  };
  /** A dependent's addition holds no name for anyone else, so it moves no ask. */
  const MAIN = (state: string) => (state.startsWith('one holder') ? ONE_HOLDER : TWO_HOLDERS);

  describe.each(READS)('read: %s', (read) => {
    describe.each(STATES)('%s', (state, shipped) => {
      describe.each(ORDERS)('registered %s', (_order, reversed) => {
        it('CONTROL — nothing disabled: each caller\'s ask is main\'s', async () => {
          const asks = await asksOf(registryOf(shipped, reversed, []), read);
          const comparable = Object.fromEntries(Object.entries(asks).map(([label, ask]) => [label,
            'refused' in ask ? refused(...ask.candidates) : ask]));
          expect(comparable).toEqual(MAIN(state));
        });

        const holders = [...new Set(shipped.map(([id]) => id))];
        it.each(nonEmptySets(holders).map((set): [string, string[]] => [set.join(' + '), set]))(
          '%s disabled: every caller asks the same address, or is refused the same, as with nothing disabled',
          async (_label, disabled) => {
            const enabled = await asksOf(registryOf(shipped, reversed, []), read);
            expect(await asksOf(registryOf(shipped, reversed, disabled), read)).toEqual(enabled);
          },
        );
      });
    });
  });

  /**
   * [epic ruling R4-F] The built-in package as the caller, with nothing
   * disabled: a name the built-in and one package hold sends the package's
   * template, as on `main` (the built-in ranks below any package).
   */
  describe.each(READS)('CONTROL — the built-in package as the caller (read: %s)', (read) => {
    it.each(ORDERS)('registered %s: a non-auth name held by the built-in and one package sends the package\'s template', async (_order, reversed) => {
      const shipped: AnyRecord[] = [
        { name: 'welcome', label: 'Welcome', subject: 'built-in welcome', bodyHtml: '<p>b</p>', _packageId: BUILTIN_EMAIL_TEMPLATES_PACKAGE_ID },
        { name: 'welcome', label: 'Welcome', subject: 'alpha welcome', bodyHtml: '<p>a</p>', _packageId: ALPHA },
      ];
      const items = reversed ? [...shipped].reverse() : shipped;
      expect([...(PLATFORM_REQUESTED_BARE_NAMES_BY_TYPE.email_template ?? [])]).not.toContain('welcome');
      const reg = new SchemaRegistry();
      reg.logLevel = 'silent';
      for (const item of items) {
        const { _packageId: id, ...body } = item;
        reg.installPackage({ id, name: id, version: '1.0.0', type: 'app', namespace: String(id).split('.').pop() } as never, 'code');
        reg.registerItem('email_template', body, 'name' as never, id);
      }
      const loader = createRegistryEmailTemplateLoader(read === 'protocol'
        ? { protocol: layeredProtocol(items), registry: reg }
        : { registry: reg });
      const row = await loader.load('welcome', 'en-US', { callerPackageId: BUILTIN_EMAIL_TEMPLATES_PACKAGE_ID });
      expect(row?.subject).toBe('alpha welcome');
    });
  });
});

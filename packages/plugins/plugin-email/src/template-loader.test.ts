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
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
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
 * [ADR-0150 D3, #32670] A disabled package holds no name at the send. When a
 * holder of the name is disabled, the name is resolved over the served
 * holders, so a disabled package is never the answer and a refusal names only
 * the packages that serve the name; and the bundle is read only where no
 * member of a disabled holder's side is listed: the resolved holder's own
 * address, or the environment-wide list for the environment's own item. A
 * caller whose own holding is disabled, or that no served holder answers,
 * finds no template. With no holder disabled, every answer is the one it was.
 *
 * The world is real: a `SchemaRegistry`, the protocol's execution list over
 * it with stored `sys_metadata` rows (ALPHA's customization pair `.custom`
 * stores an fr-FR member), and a dependent (ADDER, depending on ALPHA only)
 * adding fr-FR. Every case runs in both registration orders and on both reads
 * the loader takes: the protocol's, and the registry's own list (which reads
 * no stored row). Each caller is asked for en-US and fr-FR; an answer is the
 * sent template's subject (who stores it, and its locale), `no template`, or
 * the refusal with its candidates. The rows named per case are the PR's
 * declaration table.
 */
describe('createRegistryEmailTemplateLoader — a disabled package holds no name at the send (ADR-0150 D3, #32670)', () => {
  const ALPHA = 'com.example.alpha';
  const BETA = 'com.example.beta';
  const BOTH = 'com.example.both';
  const VIA_ALPHA = 'com.example.viaalpha';
  const NEITHER = 'com.example.neither';
  const ADDER = 'com.example.adder';
  const PAIR = `${ALPHA}.custom`;
  const BUILTIN = BUILTIN_EMAIL_TEMPLATES_PACKAGE_ID;
  const AUTH_NAME = 'auth.password_reset';
  const SHORT: Record<string, string> = {
    [ALPHA]: 'ALPHA', [BETA]: 'BETA', [ADDER]: 'ADDER', [BUILTIN]: 'BUILTIN',
  };
  /** None (omitted, null), each holder, a closure holding both, a closure through ALPHA only, neither, the dependent, the built-in package. */
  const CALLERS: ReadonlyArray<[string, string | null | undefined]> = [
    ['omitted', undefined], ['null', null], ['ALPHA', ALPHA], ['BETA', BETA], ['BOTH', BOTH],
    ['VIA_ALPHA', VIA_ALPHA], ['NEITHER', NEITHER], ['ADDER', ADDER], ['BUILTIN', BUILTIN],
  ];
  const ORDERS: Array<[string, boolean]> = [['as listed', false], ['reversed', true]];
  const READS = ['protocol', 'registry'] as const;

  type State = {
    holders: string[];
    besideRow: 'none' | 'environment item first' | 'environment item last' | 'stored row';
    adderDisabled: boolean;
    auth: boolean;
  };
  const STATES: Record<string, State> = {
    'two holders': { holders: [ALPHA, BETA], besideRow: 'none', adderDisabled: false, auth: false },
    'two holders, the dependent disabled': { holders: [ALPHA, BETA], besideRow: 'none', adderDisabled: true, auth: false },
    'one holder beside the environment\'s item, registered first': { holders: [ALPHA], besideRow: 'environment item first', adderDisabled: false, auth: false },
    'one holder beside the environment\'s item, registered last': { holders: [ALPHA], besideRow: 'environment item last', adderDisabled: false, auth: false },
    'one holder beside a package-less stored row': { holders: [ALPHA], besideRow: 'stored row', adderDisabled: false, auth: false },
    'an auth name one package overrides': { holders: [ALPHA], besideRow: 'stored row', adderDisabled: false, auth: true },
  };

  // The engine double the protocol reads `sys_metadata` through: equality
  // and `$in`, and nothing else — any other operator is refused loudly. It
  // carries no write verb: the send writes nothing.
  const matches = (row: AnyRecord, where: AnyRecord | undefined) => Object.entries(where ?? {}).every(([k, v]) => {
    if (k.startsWith('$')) throw new Error(`engine double: logical operator ${k} is not implemented`);
    if (v !== null && typeof v === 'object') {
      if (Object.keys(v).join() !== '$in' || !Array.isArray(v.$in)) throw new Error(`engine double: operator ${Object.keys(v).join(', ')} is not implemented`);
      return (v.$in as unknown[]).includes(row[k]);
    }
    return (row[k] ?? null) === v;
  });

  /** The registry and the protocol over it, with `disabled` disabled. */
  function worldOf(state: State, disabled: readonly string[], reversed: boolean) {
    const name = state.auth ? AUTH_NAME : 'welcome';
    const rows: AnyRecord[] = [];
    const reg = new SchemaRegistry({ multiTenant: false } as never);
    reg.logLevel = 'silent';
    const packages: Array<[string, string[]]> = [
      [ALPHA, []], [BETA, []], [BOTH, [ALPHA, BETA]], [VIA_ALPHA, [ALPHA]], [NEITHER, []], [ADDER, [ALPHA]], [PAIR, []], [BUILTIN, []],
    ];
    for (const [id, deps] of reversed ? [...packages].reverse() : packages) {
      reg.installPackage({
        id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop()!,
        ...(deps.length ? { dependencies: Object.fromEntries(deps.map((d) => [d, '^1.0.0'])) } : {}),
      } as never, 'code');
    }
    const ship = (packageId: string | undefined, locale: string, subject: string) => () => reg.registerItem('email_template', {
      name, label: subject, locale, subject, bodyHtml: '<p>x</p>', ...(packageId === undefined ? { _provenance: 'org' } : {}),
    }, 'name' as never, packageId as never);
    const shipped = [
      ...(state.besideRow === 'environment item first' ? [ship(undefined, 'en-US', 'ENV en-US')] : []),
      ...(state.auth ? [ship(BUILTIN, 'en-US', 'BUILTIN en-US'), ship(BUILTIN, 'fr-FR', 'BUILTIN fr-FR')] : []),
      ...state.holders.map((id) => ship(id, 'en-US', `${SHORT[id]} en-US`)),
      ship(ADDER, 'fr-FR', 'ADDER fr-FR'),
      ...(state.besideRow === 'environment item last' ? [ship(undefined, 'en-US', 'ENV en-US')] : []),
    ];
    for (const register of reversed ? [...shipped].reverse() : shipped) register();
    const stored = (id: string, packageId: string | null, subject: string) => ({
      id, type: 'email_template', name, state: 'active', package_id: packageId, bundle_member: 'fr-FR',
      metadata: JSON.stringify({ name, label: subject, locale: 'fr-FR', subject, bodyHtml: '<p>s</p>' }),
    });
    rows.push(stored('row_pair', PAIR, 'PAIR fr-FR'));
    if (state.besideRow === 'stored row') rows.push(stored('row_env', null, 'STORED fr-FR'));
    if (reversed) rows.reverse();
    for (const id of disabled) reg.disablePackage(id);
    if (state.adderDisabled) reg.disablePackage(ADDER);
    const pick = (opts?: { where?: AnyRecord; limit?: number }) => rows.filter((r) => matches(r, opts?.where)).slice(0, opts?.limit ?? rows.length);
    const engine = {
      registry: reg,
      find: async (_object: string, opts?: { where?: AnyRecord; limit?: number }) => pick(opts),
      findOne: async (_object: string, opts?: { where?: AnyRecord }) => pick(opts)[0] ?? null,
      count: async () => 0,
      aggregate: async () => [],
    };
    return { name, reg, protocol: new ObjectStackProtocolImplementation(engine as never) };
  }

  /** One send's answer: the sent subject, `no template`, or the refusal and its candidates. */
  async function answerOf(loader: ReturnType<typeof createRegistryEmailTemplateLoader>, name: string, caller: string | null | undefined, locale: string): Promise<string> {
    try {
      const row = await loader.load(name, locale, caller === undefined ? undefined : { callerPackageId: caller });
      return row?.subject ?? 'no template';
    } catch (e) {
      if (!(e instanceof EmailTemplateAmbiguousError)) throw e;
      expect([e.code, e.status]).toEqual(['RESOURCE_CONFLICT', 409]);
      const candidates = e.candidates.map((c) => (c.kind === 'package' ? SHORT[c.packageId] ?? c.packageId : c.kind)).sort();
      return `409 ${e.message.includes('outside') ? 'outside-closure ' : ''}[${candidates.join(',')}]`;
    }
  }

  type Answers = Record<string, [string, string]>;
  /** Per caller, the en-US and the fr-FR answer; `registry` lists only the callers whose registry-read answer differs. */
  const CASES: Array<{ state: string; disabled: string[]; protocol: Answers; registry?: Partial<Answers> }> = [
    { // CONTROL: nothing disabled
      state: 'two holders', disabled: [],
      protocol: {
        omitted: ['409 [ALPHA,BETA]', '409 [ALPHA,BETA]'],
        null: ['409 [ALPHA,BETA]', '409 [ALPHA,BETA]'],
        ALPHA: ['ALPHA en-US', 'PAIR fr-FR'],
        BETA: ['BETA en-US', 'no template'],
        BOTH: ['409 [ALPHA,BETA]', '409 [ALPHA,BETA]'],
        VIA_ALPHA: ['ALPHA en-US', 'PAIR fr-FR'],
        NEITHER: ['409 outside-closure [ALPHA,BETA]', '409 outside-closure [ALPHA,BETA]'],
        ADDER: ['ALPHA en-US', 'PAIR fr-FR'],
        BUILTIN: ['409 outside-closure [ALPHA,BETA]', '409 outside-closure [ALPHA,BETA]'],
      },
      registry: {
        ALPHA: ['ALPHA en-US', 'no template'],
        VIA_ALPHA: ['ALPHA en-US', 'no template'],
        ADDER: ['ALPHA en-US', 'no template'],
      },
    },
    { // rows 27-30 and 36
      state: 'two holders', disabled: [ALPHA],
      protocol: {
        omitted: ['BETA en-US', 'no template'],
        null: ['BETA en-US', 'no template'],
        ALPHA: ['no template', 'no template'],
        BETA: ['BETA en-US', 'no template'],
        BOTH: ['BETA en-US', 'no template'],
        VIA_ALPHA: ['409 outside-closure [BETA]', '409 outside-closure [BETA]'],
        NEITHER: ['409 outside-closure [BETA]', '409 outside-closure [BETA]'],
        ADDER: ['409 outside-closure [BETA]', '409 outside-closure [BETA]'],
        BUILTIN: ['409 outside-closure [BETA]', '409 outside-closure [BETA]'],
      },
    },
    { // rows 27, 28 and 30, the pair's row the enabled holder's own
      state: 'two holders', disabled: [BETA],
      protocol: {
        omitted: ['ALPHA en-US', 'PAIR fr-FR'],
        null: ['ALPHA en-US', 'PAIR fr-FR'],
        ALPHA: ['ALPHA en-US', 'PAIR fr-FR'],
        BETA: ['no template', 'no template'],
        BOTH: ['ALPHA en-US', 'PAIR fr-FR'],
        VIA_ALPHA: ['ALPHA en-US', 'PAIR fr-FR'],
        NEITHER: ['409 outside-closure [ALPHA]', '409 outside-closure [ALPHA]'],
        ADDER: ['ALPHA en-US', 'PAIR fr-FR'],
        BUILTIN: ['409 outside-closure [ALPHA]', '409 outside-closure [ALPHA]'],
      },
      registry: {
        omitted: ['ALPHA en-US', 'no template'],
        null: ['ALPHA en-US', 'no template'],
        ALPHA: ['ALPHA en-US', 'no template'],
        BOTH: ['ALPHA en-US', 'no template'],
        VIA_ALPHA: ['ALPHA en-US', 'no template'],
        ADDER: ['ALPHA en-US', 'no template'],
      },
    },
    { // rows 31 and 36
      state: 'two holders', disabled: [ALPHA, BETA],
      protocol: {
        omitted: ['no template', 'no template'],
        null: ['no template', 'no template'],
        ALPHA: ['no template', 'no template'],
        BETA: ['no template', 'no template'],
        BOTH: ['no template', 'no template'],
        VIA_ALPHA: ['no template', 'no template'],
        NEITHER: ['no template', 'no template'],
        ADDER: ['no template', 'no template'],
        BUILTIN: ['no template', 'no template'],
      },
    },
    { // rows 27-30 and 36, the addition disabled
      state: 'two holders, the dependent disabled', disabled: [ALPHA],
      protocol: {
        omitted: ['BETA en-US', 'no template'],
        null: ['BETA en-US', 'no template'],
        ALPHA: ['no template', 'no template'],
        BETA: ['BETA en-US', 'no template'],
        BOTH: ['BETA en-US', 'no template'],
        VIA_ALPHA: ['409 outside-closure [BETA]', '409 outside-closure [BETA]'],
        NEITHER: ['409 outside-closure [BETA]', '409 outside-closure [BETA]'],
        ADDER: ['409 outside-closure [BETA]', '409 outside-closure [BETA]'],
        BUILTIN: ['409 outside-closure [BETA]', '409 outside-closure [BETA]'],
      },
    },
    { // row 37
      state: 'one holder beside the environment\'s item, registered first', disabled: [ALPHA],
      protocol: {
        omitted: ['no template', 'no template'],
        null: ['no template', 'no template'],
        ALPHA: ['no template', 'no template'],
        BETA: ['no template', 'no template'],
        BOTH: ['no template', 'no template'],
        VIA_ALPHA: ['no template', 'no template'],
        NEITHER: ['no template', 'no template'],
        ADDER: ['no template', 'no template'],
        BUILTIN: ['no template', 'no template'],
      },
    },
    { // row 37
      state: 'one holder beside the environment\'s item, registered last', disabled: [ALPHA],
      protocol: {
        omitted: ['no template', 'no template'],
        null: ['no template', 'no template'],
        ALPHA: ['no template', 'no template'],
        BETA: ['no template', 'no template'],
        BOTH: ['no template', 'no template'],
        VIA_ALPHA: ['no template', 'no template'],
        NEITHER: ['no template', 'no template'],
        ADDER: ['no template', 'no template'],
        BUILTIN: ['no template', 'no template'],
      },
    },
    { // CONTROL: one holder
      state: 'one holder beside a package-less stored row', disabled: [],
      protocol: {
        omitted: ['ALPHA en-US', 'STORED fr-FR'],
        null: ['ALPHA en-US', 'STORED fr-FR'],
        ALPHA: ['ALPHA en-US', 'STORED fr-FR'],
        BETA: ['409 outside-closure [ALPHA]', '409 outside-closure [ALPHA]'],
        BOTH: ['ALPHA en-US', 'STORED fr-FR'],
        VIA_ALPHA: ['ALPHA en-US', 'STORED fr-FR'],
        NEITHER: ['409 outside-closure [ALPHA]', '409 outside-closure [ALPHA]'],
        ADDER: ['ALPHA en-US', 'STORED fr-FR'],
        BUILTIN: ['409 outside-closure [ALPHA]', '409 outside-closure [ALPHA]'],
      },
      registry: {
        omitted: ['ALPHA en-US', 'ADDER fr-FR'],
        null: ['ALPHA en-US', 'ADDER fr-FR'],
        ALPHA: ['ALPHA en-US', 'ADDER fr-FR'],
        BOTH: ['ALPHA en-US', 'ADDER fr-FR'],
        VIA_ALPHA: ['ALPHA en-US', 'ADDER fr-FR'],
        ADDER: ['ALPHA en-US', 'ADDER fr-FR'],
      },
    },
    { // row 37
      state: 'one holder beside a package-less stored row', disabled: [ALPHA],
      protocol: {
        omitted: ['no template', 'no template'],
        null: ['no template', 'no template'],
        ALPHA: ['no template', 'no template'],
        BETA: ['no template', 'no template'],
        BOTH: ['no template', 'no template'],
        VIA_ALPHA: ['no template', 'no template'],
        NEITHER: ['no template', 'no template'],
        ADDER: ['no template', 'no template'],
        BUILTIN: ['no template', 'no template'],
      },
    },
    { // CONTROL: an auth name
      state: 'an auth name one package overrides', disabled: [],
      protocol: {
        omitted: ['ALPHA en-US', 'STORED fr-FR'],
        null: ['ALPHA en-US', 'STORED fr-FR'],
        ALPHA: ['ALPHA en-US', 'STORED fr-FR'],
        BETA: ['ALPHA en-US', 'STORED fr-FR'],
        BOTH: ['ALPHA en-US', 'STORED fr-FR'],
        VIA_ALPHA: ['ALPHA en-US', 'STORED fr-FR'],
        NEITHER: ['ALPHA en-US', 'STORED fr-FR'],
        ADDER: ['409 [ADDER,ALPHA]', '409 [ADDER,ALPHA]'],
        BUILTIN: ['ALPHA en-US', 'STORED fr-FR'],
      },
      registry: {
        omitted: ['ALPHA en-US', 'ADDER fr-FR'],
        null: ['ALPHA en-US', 'ADDER fr-FR'],
        ALPHA: ['ALPHA en-US', 'ADDER fr-FR'],
        BETA: ['ALPHA en-US', 'ADDER fr-FR'],
        BOTH: ['ALPHA en-US', 'ADDER fr-FR'],
        VIA_ALPHA: ['ALPHA en-US', 'ADDER fr-FR'],
        NEITHER: ['ALPHA en-US', 'ADDER fr-FR'],
        BUILTIN: ['ALPHA en-US', 'ADDER fr-FR'],
      },
    },
    { // row 38
      state: 'an auth name one package overrides', disabled: [ALPHA],
      protocol: {
        omitted: ['BUILTIN en-US', 'STORED fr-FR'],
        null: ['BUILTIN en-US', 'STORED fr-FR'],
        ALPHA: ['no template', 'no template'],
        BETA: ['BUILTIN en-US', 'STORED fr-FR'],
        BOTH: ['BUILTIN en-US', 'STORED fr-FR'],
        VIA_ALPHA: ['BUILTIN en-US', 'STORED fr-FR'],
        NEITHER: ['BUILTIN en-US', 'STORED fr-FR'],
        ADDER: ['BUILTIN en-US', 'STORED fr-FR'],
        BUILTIN: ['BUILTIN en-US', 'STORED fr-FR'],
      },
      registry: {
        omitted: ['BUILTIN en-US', 'BUILTIN fr-FR'],
        null: ['BUILTIN en-US', 'BUILTIN fr-FR'],
        BETA: ['BUILTIN en-US', 'BUILTIN fr-FR'],
        BOTH: ['BUILTIN en-US', 'BUILTIN fr-FR'],
        VIA_ALPHA: ['BUILTIN en-US', 'BUILTIN fr-FR'],
        NEITHER: ['BUILTIN en-US', 'BUILTIN fr-FR'],
        ADDER: ['BUILTIN en-US', 'BUILTIN fr-FR'],
        BUILTIN: ['BUILTIN en-US', 'BUILTIN fr-FR'],
      },
    },
  ];

  describe.each(READS)('read: %s', (read) => {
    describe.each(ORDERS)('registered %s', (_order, reversed) => {
      it.each(CASES.map((c): [string, typeof c] => [`${c.state}, ${c.disabled.length ? `${c.disabled.map((id) => SHORT[id]).join(' + ')} disabled` : 'nothing disabled'}`, c]))(
        '%s: every caller\'s answer',
        async (_label, c) => {
          const { name, reg, protocol } = worldOf(STATES[c.state], c.disabled, reversed);
          const loader = createRegistryEmailTemplateLoader(read === 'protocol' ? { protocol, registry: reg } : { registry: reg });
          const answers: Answers = {};
          for (const [label, caller] of CALLERS) {
            answers[label] = [await answerOf(loader, name, caller, 'en-US'), await answerOf(loader, name, caller, 'fr-FR')];
          }
          expect(answers).toEqual(read === 'protocol' ? c.protocol : { ...c.protocol, ...c.registry });
        },
      );
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

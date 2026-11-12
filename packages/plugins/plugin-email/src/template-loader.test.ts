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
 * [ADR-0150 D3, #32183] A disabled package holds no name at the send door: the
 * name resolves over the served holders, and the caller's own holding stays.
 * Each case runs in both registration orders and on both reads the loader
 * takes: the protocol's execution list (a double over the registry's served
 * list, which withholds a disabled package's items, at its own address too)
 * and the registry's own list.
 */
describe('createRegistryEmailTemplateLoader — a disabled holder holds no name at the send (ADR-0150 D3, #32183)', () => {
  const ALPHA = 'com.example.alpha';
  const BETA = 'com.example.beta';
  const BOTH = 'com.example.both';
  const VIA_BETA = 'com.example.viabeta';
  const NEITHER = 'com.example.neither';
  const tpl = (packageId: string): AnyRecord => ({
    name: 'welcome', label: 'Welcome', subject: `${packageId.split('.').pop()} welcome`, bodyHtml: '<p>hi</p>',
    _packageId: packageId,
  });

  /** A real registry with ALPHA and BETA shipping `welcome` in `order`, and the callers around them. */
  function registryShipping(order: readonly string[], disabled: readonly string[]): SchemaRegistry {
    const reg = new SchemaRegistry();
    reg.logLevel = 'silent';
    const packages: Array<[string, string[]]> = [
      ...order.map((id): [string, string[]] => [id, []]),
      [BOTH, [ALPHA, BETA]], [VIA_BETA, [BETA]], [NEITHER, []],
    ];
    for (const [id, deps] of packages) {
      reg.installPackage({
        id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop(),
        ...(deps.length ? { dependencies: Object.fromEntries(deps.map((d) => [d, '^1.0.0'])) } : {}),
      } as never, 'code');
    }
    for (const id of order) {
      const { _packageId: _ignored, ...body } = tpl(id);
      reg.registerItem('email_template', body, 'name' as never, id);
    }
    for (const id of disabled) reg.disablePackage(id);
    return reg;
  }

  /** The execution list over the registry's served list, at the address a request names. */
  function servedProtocol(reg: SchemaRegistry) {
    const requests: AnyRecord[] = [];
    return {
      requests,
      async getMetaItemsForExecution(request: { type: string; packageId?: string }) {
        requests.push({ ...request });
        const listed = (reg.listItems(request.type) ?? []) as AnyRecord[];
        const items = request.packageId === undefined ? listed : listed.filter((i) => i._packageId === request.packageId);
        return { type: request.type, items: items.map((i) => ({ ...i })) };
      },
    };
  }

  const ORDERS = [[ALPHA, BETA], [BETA, ALPHA]] as const;
  const READS = ['protocol', 'registry'] as const;
  const loaderOver = (reg: SchemaRegistry, read: (typeof READS)[number]) =>
    createRegistryEmailTemplateLoader(read === 'protocol' ? { protocol: servedProtocol(reg), registry: reg } : { registry: reg });
  const send = (loader: ReturnType<typeof createRegistryEmailTemplateLoader>, caller?: string | null) =>
    loader.load('welcome', 'en-US', caller === undefined ? undefined : { callerPackageId: caller })
      .then((row) => ({ subject: row?.subject ?? null }), (e: unknown) => ({ error: e }));
  const refusalOf = (answer: AnyRecord) => {
    expect(answer.error).toBeInstanceOf(EmailTemplateAmbiguousError);
    const err = answer.error as EmailTemplateAmbiguousError;
    return { status: err.status, candidates: err.candidates.map((c) => (c as { packageId?: string }).packageId).sort() };
  };

  describe.each(READS)('read: %s', (read) => {
    describe.each(ORDERS)('registered %s first', (first, second) => {
      const order = [first, second];

      it('CONTROL — both enabled: each holder sends its own template; a send with no package, or from a caller whose closure holds both, is refused naming both', async () => {
        const loader = loaderOver(registryShipping(order, []), read);
        expect(await send(loader, ALPHA)).toEqual({ subject: 'alpha welcome' });
        expect(await send(loader, BETA)).toEqual({ subject: 'beta welcome' });
        expect(refusalOf(await send(loader))).toEqual({ status: 409, candidates: [ALPHA, BETA] });
        expect(refusalOf(await send(loader, BOTH))).toEqual({ status: 409, candidates: [ALPHA, BETA] });
      });

      it('BETA disabled: a send with no package, omitted or null, sends the enabled holder\'s template', async () => {
        const loader = loaderOver(registryShipping(order, [BETA]), read);
        expect(await send(loader)).toEqual({ subject: 'alpha welcome' });
        expect(await send(loader, null)).toEqual({ subject: 'alpha welcome' });
      });

      it('CONTROL — BETA disabled: the enabled holder\'s own send sends its own template', async () => {
        const loader = loaderOver(registryShipping(order, [BETA]), read);
        expect(await send(loader, ALPHA)).toEqual({ subject: 'alpha welcome' });
      });

      it('BETA disabled: a caller whose closure holds both sends the enabled holder\'s template', async () => {
        const loader = loaderOver(registryShipping(order, [BETA]), read);
        expect(await send(loader, BOTH)).toEqual({ subject: 'alpha welcome' });
      });

      it('BETA disabled: a caller whose closure reaches the name only through BETA is refused outside-closure, naming the enabled holder', async () => {
        const loader = loaderOver(registryShipping(order, [BETA]), read);
        const answer = await send(loader, VIA_BETA);
        expect(refusalOf(answer)).toEqual({ status: 409, candidates: [ALPHA] });
        expect(((answer as AnyRecord).error as EmailTemplateAmbiguousError).message).toContain('outside');
      });

      it('BETA disabled: a caller that reaches neither holder is refused naming the enabled holder only', async () => {
        const loader = loaderOver(registryShipping(order, [BETA]), read);
        expect(refusalOf(await send(loader, NEITHER))).toEqual({ status: 409, candidates: [ALPHA] });
      });

      it('BETA disabled: BETA\'s own send sends nothing, never the enabled holder\'s template', async () => {
        const loader = loaderOver(registryShipping(order, [BETA]), read);
        expect(await send(loader, BETA)).toEqual({ subject: null });
      });

      it('both disabled: a send with no package sends nothing', async () => {
        const loader = loaderOver(registryShipping(order, [ALPHA, BETA]), read);
        expect(await send(loader)).toEqual({ subject: null });
        expect(await send(loader, null)).toEqual({ subject: null });
      });
    });
  });
});

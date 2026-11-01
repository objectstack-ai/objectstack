// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24773] `sys_oauth_application.create_oauth_application` — the register
 * form offers the two application types the OAuth provider judges, and its
 * redirect-URL help states the provider's rule per type.
 *
 * The form posts to plugin-auth's `POST /api/v1/auth/sys-oauth-application/register`,
 * which forwards the chosen type as the provider's `application_type`.
 * `@better-auth/oauth-provider` 1.7.3 declares `web` | `native` there and
 * judges redirect URIs by it: web needs https on a host that is not loopback;
 * native may also use http on exactly `localhost`, `127.0.0.1` or `[::1]`.
 * The form used to offer `user-agent-based` and `public` as well. The provider
 * has neither, so the route registers both as `web`. The form stops offering
 * them; the route still accepts them, so this is the form only.
 *
 * The stored `type` column is a different surface. It declares the same two
 * values since #25053, and `sys-oauth-application.type-options.test.ts` pins it.
 *
 * The help text is not pinned word for word. What is pinned is what it names:
 * the scheme each type needs and the three native loopback hosts, in the source
 * and in all four shipped locales. The translated leaves are hand-written, so
 * `pnpm i18n:extract` keeps them in merge mode and no other gate notices a
 * translation of the old wording.
 */

import { describe, expect, it } from 'vitest';
import { SysOauthApplication } from './index.js';
import { enObjects } from '../apps/translations/en.objects.generated.js';
import { zhCNObjects } from '../apps/translations/zh-CN.objects.generated.js';
import { jaJPObjects } from '../apps/translations/ja-JP.objects.generated.js';
import { esESObjects } from '../apps/translations/es-ES.objects.generated.js';
import { templateSlotSource } from '@objectstack/spec/automation';

// [#27948] An action's `description`, each param's `helpText` and each
// `outcomeMessages` entry are `template` slots: the parsed object carries the
// `{ dialect: 'template', source }` envelope, so the copy is read as written
// through the template judge's one reader, `templateSlotSource` (a locale map
// is kept as it is).
function copyAsWritten<T>(declared: T): T {
  const a = declared as Record<string, any> | undefined;
  if (!a) return declared;
  const text = (v: unknown) => templateSlotSource(v) ?? v;
  return {
    ...a,
    ...(a.description !== undefined ? { description: text(a.description) } : {}),
    ...(Array.isArray(a.params)
      ? { params: a.params.map((p: any) => (p && p.helpText !== undefined ? { ...p, helpText: text(p.helpText) } : p)) }
      : {}),
    ...(a.outcomeMessages && typeof a.outcomeMessages === 'object'
      ? { outcomeMessages: Object.fromEntries(Object.entries(a.outcomeMessages).map(([k, v]) => [k, text(v)])) }
      : {}),
  } as T;
}


type Param = { name?: string; type?: string; required?: boolean; defaultValue?: unknown; helpText?: string; options?: unknown[] };

const register = copyAsWritten((SysOauthApplication.actions ?? []).find((a) => a.name === 'create_oauth_application'));
const param = (name: string): Param | undefined =>
  ((register?.params ?? []) as Param[]).find((p) => p.name === name);
const optionValues = (options: unknown[] | undefined): unknown[] =>
  (options ?? []).map((o) => (typeof o === 'string' ? o : (o as { value?: unknown })?.value));

/** The hosts a native client may use with http://, as the provider spells them. */
const NATIVE_LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'] as const;

const LOCALES: readonly (readonly [string, any])[] = [
  ['en', enObjects],
  ['zh-CN', zhCNObjects],
  ['ja-JP', jaJPObjects],
  ['es-ES', esESObjects],
];
const registerNode = (bundle: any) => bundle?.sys_oauth_application?._actions?.create_oauth_application;

describe('[#24773] create_oauth_application — the type param offers the provider\'s two application types', () => {
  it('offers exactly web and native, defaulting to web', () => {
    expect(register, 'create_oauth_application is declared').toBeDefined();
    const type = param('type');
    expect(type?.type).toBe('select');
    expect(type?.required).toBe(true);
    expect(type?.defaultValue).toBe('web');
    expect(optionValues(type?.options)).toEqual(['web', 'native']);
  });

  it('every shipped locale translates exactly those two options', () => {
    for (const [locale, bundle] of LOCALES) {
      const options = registerNode(bundle)?.params?.type?.options;
      expect(Object.keys(options ?? {}), `${locale} type options`).toEqual(['web', 'native']);
    }
  });
});

describe('[#24773] create_oauth_application — the redirect-URL help states the rule per type', () => {
  it('names the scheme each type needs and the three native loopback hosts', () => {
    const help = param('redirectURLs')?.helpText ?? '';
    expect(help).toContain('https://');
    expect(help).toContain('http://');
    for (const host of NATIVE_LOOPBACK_HOSTS) {
      expect(help, `the help names the native loopback host ${host}`).toContain(host);
    }
  });

  it('the type help names Native and the loopback redirect it is for', () => {
    const help = param('type')?.helpText ?? '';
    expect(help).toContain('Native');
    expect(help).toContain('http://localhost');
  });

  it('the English bundle mirrors the source, and every locale names the hosts in its own translation', () => {
    expect(registerNode(enObjects)?.params?.redirectURLs?.helpText).toBe(param('redirectURLs')?.helpText);
    expect(registerNode(enObjects)?.params?.type?.helpText).toBe(param('type')?.helpText);
    for (const [locale, bundle] of LOCALES) {
      const node = registerNode(bundle);
      const help: string = node?.params?.redirectURLs?.helpText ?? '';
      expect(help, `${locale} redirectURLs help`).toContain('https://');
      expect(help, `${locale} redirectURLs help`).toContain('http://');
      for (const host of NATIVE_LOOPBACK_HOSTS) {
        expect(help, `${locale} redirectURLs help names ${host}`).toContain(host);
      }
      expect(node?.params?.type?.helpText ?? '', `${locale} type help`).toContain('http://localhost');
      if (locale !== 'en') {
        expect(help, `${locale} redirectURLs help is the English source`).not.toBe(param('redirectURLs')?.helpText);
        expect(node?.params?.type?.helpText, `${locale} type help is the English source`).not.toBe(param('type')?.helpText);
      }
    }
  });
});

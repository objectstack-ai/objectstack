// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25053] `sys_oauth_application.type` declares exactly the application types
 * its one writer produces: `web` and `native`.
 *
 * The column's only writer is `@better-auth/oauth-provider`, whose
 * `applicationType` plugin-auth maps onto `type`. 1.7.3 writes
 * `application_type` `web` or `native` on every creation and update path, and
 * the generic data API cannot write this table (`apiMethods` is `get` /
 * `list`). The column used to declare four options through the string
 * shorthand, which strips hyphens, so it served `web`, `native`,
 * `useragentbased` and `public`. No writer produces the last two (ADR-0049
 * enforce-or-remove), and the hyphenated `user-agent-based` an earlier
 * provider line wrote was never one of them.
 *
 * What the narrowed declaration does to stored rows is pinned where a real
 * engine runs, in plugin-auth's `oauth-application-type-column.test.ts`. This
 * package cannot import `@objectstack/objectql`, which depends on it.
 */

import { describe, expect, it } from 'vitest';
import { SysOauthApplication } from './index.js';
import { enObjects } from '../apps/translations/en.objects.generated.js';
import { zhCNObjects } from '../apps/translations/zh-CN.objects.generated.js';
import { jaJPObjects } from '../apps/translations/ja-JP.objects.generated.js';
import { esESObjects } from '../apps/translations/es-ES.objects.generated.js';

type Option = { label?: unknown; value?: unknown };
type Column = { type?: string; required?: boolean; defaultValue?: unknown; options?: Option[] };

const fields = SysOauthApplication.fields as Record<string, Column>;
const column = fields.type;
const values = (options: unknown[] | undefined): unknown[] =>
  (options ?? []).map((o) => (typeof o === 'string' ? o : (o as Option)?.value));

const LOCALES: readonly (readonly [string, any])[] = [
  ['en', enObjects],
  ['zh-CN', zhCNObjects],
  ['ja-JP', jaJPObjects],
  ['es-ES', esESObjects],
];

describe('[#25053] sys_oauth_application.type — the declared options are what the provider writes', () => {
  it('declares exactly web and native, each value as written', () => {
    expect(column?.type).toBe('select');
    expect(values(column?.options)).toEqual(['web', 'native']);
    // The string shorthand keeps the written string as the label and derives
    // the value from it; equal pairs say the derivation changed nothing.
    for (const option of column?.options ?? []) {
      expect(option.value, `option ${String(option.label)}`).toBe(option.label);
    }
  });

  it('stays optional, with web as its default', () => {
    // The provider can write null (a client-metadata-document client that
    // names no type): a required column would make that a missing value.
    expect(column?.required).toBe(false);
    expect(column?.defaultValue).toBe('web');
  });

  it('declares the same values the register form offers', () => {
    const register = (SysOauthApplication.actions ?? []).find((a) => a.name === 'create_oauth_application');
    const param = ((register?.params ?? []) as { name?: string; options?: unknown[] }[]).find((p) => p.name === 'type');
    expect(values(param?.options)).toEqual(values(column?.options));
  });

  it('every shipped locale translates exactly those two options', () => {
    for (const [locale, bundle] of LOCALES) {
      const options = bundle?.sys_oauth_application?.fields?.type?.options;
      expect(Object.keys(options ?? {}), `${locale} type options`).toEqual(['web', 'native']);
    }
  });

  it('keeps the `public` column', () => {
    expect(fields.public?.type).toBe('boolean');
  });
});

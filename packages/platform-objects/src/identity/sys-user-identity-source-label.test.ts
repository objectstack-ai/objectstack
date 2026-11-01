// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #27855 — the Users "Identity Source" value reads in business terms.
 *
 * A user who signed up with email and password (or an app end-user) is stamped
 * `env_native`, and the option was labelled "Env-Native": a word from the
 * provenance design (ADR-0135 D4), not one an administrator uses. It is labelled
 * "Local Account" beside the federated "IdP-Provisioned": the identity is held
 * by this environment's own sign-in rather than by an identity provider.
 *
 * The stored value is pinned beside the label. A label is display text; the
 * value is what every row, the AuthManager hook and the cloud-managed gating
 * already read, so it does not move.
 */

import { describe, it, expect } from 'vitest';
import { SysUser } from './sys-user.object';
import { zhCNObjects } from '../apps/translations/zh-CN.objects.generated';
import { jaJPObjects } from '../apps/translations/ja-JP.objects.generated';
import { esESObjects } from '../apps/translations/es-ES.objects.generated';
import { enObjects } from '../apps/translations/en.objects.generated';

type Option = { value: string; label: string };

const sourceField = SysUser.fields.source as { type: string; defaultValue?: unknown; options: Option[] };

function bundleOptionLabel(bundle: Record<string, unknown>, value: string): unknown {
  const sysUser = bundle.sys_user as { fields?: Record<string, { options?: Record<string, string> }> } | undefined;
  return sysUser?.fields?.source?.options?.[value];
}

describe('sys_user.source identity-source labels', () => {
  it('keeps the field a select over the same stored values and default', () => {
    expect(sourceField.type).toBe('select');
    expect(sourceField.options.map((o) => o.value)).toEqual(['idp_provisioned', 'env_native']);
    expect(sourceField.defaultValue).toBe('env_native');
  });

  it('labels env_native "Local Account"', () => {
    expect(sourceField.options.find((o) => o.value === 'env_native')?.label).toBe('Local Account');
  });

  it.each([
    ['en', enObjects, 'Local Account'],
    ['zh-CN', zhCNObjects, '本地账号'],
    ['ja-JP', jaJPObjects, 'ローカルアカウント'],
    ['es-ES', esESObjects, 'Cuenta local'],
  ])('the %s bundle carries the matching words', (_locale, bundle, expected) => {
    expect(bundleOptionLabel(bundle as Record<string, unknown>, 'env_native')).toBe(expected);
  });
});

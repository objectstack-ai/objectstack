// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// sys_organization's `parent_organization_id` and `sort_order` only order and
// group organizations against each other, so on a deployment with one
// organization they do nothing. Edit organization still draws them there, and
// an administrator could not tell (#30210, row 4 C). Their help now says so in
// every bundle that carries it: the declaration (served as the `en` source)
// and the `en` / `zh-CN` packs.
import { describe, expect, it } from 'vitest';
import { SysOrganization } from './sys-organization.object.js';
import { enObjects } from '../apps/translations/en.objects.generated.js';
import { zhCNObjects } from '../apps/translations/zh-CN.objects.generated.js';

const FIELDS = ['parent_organization_id', 'sort_order'] as const;

const declared = (name: string) =>
  (SysOrganization.fields as Record<string, { description?: string }>)[name]?.description ?? '';

type Bundle = { sys_organization?: { fields?: Record<string, { help?: string }> } };
const packHelp = (bundle: unknown, name: string) =>
  (bundle as Bundle).sys_organization?.fields?.[name]?.help ?? '';

describe('sys_organization: parent and sort order say they matter only with several organizations (#30210)', () => {
  it.each(FIELDS)('%s: the declaration says so', (name) => {
    expect(declared(name)).toMatch(/Meaningful only where the deployment runs several organizations\.$/);
  });

  it.each(FIELDS)('%s: the en pack is the declaration, byte for byte', (name) => {
    expect(packHelp(enObjects, name)).toBe(declared(name));
  });

  it.each(FIELDS)('%s: the zh-CN pack says so', (name) => {
    expect(packHelp(zhCNObjects, name)).toMatch(/仅在部署运行多个组织时有意义。$/);
  });
});

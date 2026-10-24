// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// sys_organization's `name` and `timezone` help say which value is which
// (#25347). One organization showed three names and two timezones, with no
// rule shown:
//
//  - `name` is the organization's own name. The product name the console shows
//    is Settings → Branding's `workspace_name`, a separate setting, and the help
//    says so. It names the door that changes it, Rename Organization, which is
//    offered under `single` too (ruling 6384629949; the gate is pinned in
//    `sys-organization-rename-action.test.ts`).
//  - `timezone` is read by nothing in the platform (see its declaration). The
//    zone in effect is the settings door's `localization.timezone`, and the help
//    says so instead of claiming date boundaries are computed in this column.
//    Localization's own help says the same from its side
//    (`localization-timezone-help.pin.test.ts` in service-settings serves it).
import { describe, expect, it } from 'vitest';
import { SysOrganization } from './sys-organization.object.js';

const field = (name: string) =>
  (SysOrganization.fields as Record<string, { description?: string; readonly?: boolean }>)[name];

describe('sys_organization: the name and timezone fields say which value is which (#25347)', () => {
  it("the organization's name points at Branding for the product name, a different setting", () => {
    expect(field('name').readonly).toBe(true);
    expect(field('name').description).toMatch(/different setting, set in Settings → Branding/);
  });

  it('the name names the door that changes it, the action labelled Rename Organization', () => {
    expect(field('name').description).toMatch(/Change it with Rename Organization/);
    const rename = (SysOrganization.actions ?? []).find((a) => a.name === 'rename_organization');
    expect(rename?.label).toBe('Rename Organization');
  });

  it("the timezone says it changes no date calculation and that Localization's Default timezone wins", () => {
    const help = field('timezone').description ?? '';
    expect(help).toMatch(/does not change any date calculation/);
    expect(help).toMatch(/Settings → Localization → Default timezone/);
    expect(help).not.toMatch(/are computed in/);
  });
});

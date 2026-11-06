// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// On a deployment that runs one organization, Parent Organization and Sort
// Order order and group organizations against nothing, so Edit organization
// hides them there (#30692, ruling 6670372892 on #30210, row 4 A). The two
// fields sit in the object's `group_structure` field group, declared with
// `requiresFeature: 'multiOrgEnabled'`, which the spec lowers into the group's
// `visibleWhen` at parse. Both renderers evaluate that predicate with the
// host's `features` root in scope (the form's section gate and the record
// page's `record:details`), fail-closed.
import { describe, expect, it } from 'vitest';
import { celEngine } from '@objectstack/formula';
import { deriveFieldGroupLayout } from '@objectstack/spec/data';
import { featureGatePredicate } from '@objectstack/spec/kernel';
import { SysOrganization } from './sys-organization.object.js';

type Group = { key: string; visibleWhen?: { dialect?: string; source?: string }; requiresFeature?: unknown };
const groups = (SysOrganization.fieldGroups ?? []) as Group[];
// `null` = grouping does not apply (no declared groups), and both renderers
// fall back to a flat layout of every field: what a deployment saw before the
// groups were declared.
const layout = deriveFieldGroupLayout(SysOrganization as Parameters<typeof deriveFieldGroupLayout>[0])
  ?? [{ fields: Object.keys(SysOrganization.fields), visibleWhen: undefined }];

/**
 * The section-gate rule both renderers apply: no predicate shows the section,
 * a predicate shows it only when it answers TRUE, and a fault hides it.
 */
function sectionShown(visibleWhen: Group['visibleWhen'], features: Record<string, unknown>): boolean {
  if (!visibleWhen?.source) return true;
  const r = celEngine.evaluate({ dialect: 'cel', source: visibleWhen.source }, { record: {}, extra: { features } });
  return r.ok && r.value === true;
}

/** Field names the layout renders for this deployment, in render order. */
function renderedFields(features: Record<string, unknown>): string[] {
  return layout.filter((s) => sectionShown(s.visibleWhen as Group['visibleWhen'], features)).flatMap((s) => s.fields);
}

describe('sys_organization: Parent Organization and Sort Order hide on a single-organization deployment', () => {
  it('both fields are in one field group that the multiOrgEnabled gate guards', () => {
    const fields = SysOrganization.fields as Record<string, { group?: string }>;
    expect(fields.parent_organization_id?.group).toBe('group_structure');
    expect(fields.sort_order?.group).toBe('group_structure');
    const group = groups.find((g) => g.key === 'group_structure');
    expect(group?.visibleWhen).toEqual({ dialect: 'cel', source: featureGatePredicate('multiOrgEnabled') });
    // Lowered and stripped: no consumer sees the sugar key.
    expect(group && 'requiresFeature' in group).toBe(false);
  });

  it('multiOrgEnabled off: the group is hidden', () => {
    const shown = renderedFields({ multiOrgEnabled: false });
    expect(shown).not.toContain('parent_organization_id');
    expect(shown).not.toContain('sort_order');
    expect(shown).toContain('name');
  });

  it('multiOrgEnabled on: the group is shown', () => {
    const shown = renderedFields({ multiOrgEnabled: true });
    expect(shown).toContain('parent_organization_id');
    expect(shown).toContain('sort_order');
  });

  // The group slot's fault direction (#30692 review). The console holds
  // `features = {}` until /auth/config resolves, and keeps it empty if that
  // fetch fails. Reading a key `features` does not carry is a CEL fault, not
  // `null`, so the default-on gate does not answer "visible" there the way an
  // action's fail-soft `visible` does: the section gate is fail-closed, and the
  // group stays hidden until the flag is published, on every deployment.
  it('features not yet published: the gate faults and the group is hidden (fail-closed)', () => {
    const r = celEngine.evaluate(
      { dialect: 'cel', source: featureGatePredicate('multiOrgEnabled') },
      { record: {}, extra: { features: {} } },
    );
    expect(r.ok).toBe(false);
    const shown = renderedFields({});
    expect(shown).not.toContain('parent_organization_id');
    expect(shown).not.toContain('sort_order');
    expect(shown).toContain('name');
  });

  it('no other group is gated, and the fields keep their declaration order', () => {
    expect(groups.filter((g) => g.visibleWhen !== undefined).map((g) => g.key)).toEqual(['group_structure']);
    const declared = Object.keys(SysOrganization.fields).filter((name) =>
      renderedFields({ multiOrgEnabled: true }).includes(name),
    );
    expect(renderedFields({ multiOrgEnabled: true })).toEqual(declared);
  });
});

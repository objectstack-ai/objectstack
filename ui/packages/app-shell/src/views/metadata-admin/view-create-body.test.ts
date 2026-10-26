/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// View create-body conformance (objectui#2323).
//
// `ViewItemSchema` is a discriminated union on `viewKind` with both a `list`
// and a `form` variant. The create form must be able to produce BOTH families,
// and each build output must validate against the REAL spec `ViewItemSchema`
// (not the lenient aggregated container the client validator strips through).
//
// Regression guard: `createBuildBody` used to hardcode `viewKind: 'list'` and
// route the draft `kind` straight into `config.type`, so form-family views were
// unreachable through the create UI.

import { describe, it, expect } from 'vitest';
import { ViewItemSchema } from '@objectstack/spec/ui';
import { registerBuiltinAnchors } from './anchors';
import { getMetadataResource } from './registry';

registerBuiltinAnchors();

function viewConfig() {
  const cfg = getMetadataResource('view');
  if (!cfg?.createBuildBody) {
    throw new Error('view resource must define createBuildBody');
  }
  return cfg;
}

function build(draft: Record<string, unknown>): Record<string, unknown> {
  return viewConfig().createBuildBody!(draft) as Record<string, unknown>;
}

function expectSpecValid(body: unknown) {
  const res = ViewItemSchema.safeParse(body);
  expect(
    res.success,
    `ViewItem rejected by spec: ${JSON.stringify(res.error?.issues)}\nbody=${JSON.stringify(body)}`,
  ).toBe(true);
}

describe('view createBuildBody — ViewItem family discrimination (objectui#2323)', () => {
  it('defaults to a spec-valid list-family ViewItem when viewKind is unset', () => {
    const body = build({ label: 'All Leads', name: 'all_leads', object: 'crm_lead' });
    expect(body.viewKind).toBe('list');
    expect((body.config as Record<string, unknown>).type).toBe('grid');
    expect((body.config as Record<string, unknown>).columns).toEqual([]);
    expect(body.config).not.toHaveProperty('sections');
    expectSpecValid(body);
  });

  it('carries the chosen list layout at config.type for a list view', () => {
    const body = build({
      label: 'Board',
      name: 'board',
      object: 'crm_lead',
      viewKind: 'list',
      kind: 'kanban',
    });
    expect(body.viewKind).toBe('list');
    expect((body.config as Record<string, unknown>).type).toBe('kanban');
    expect(body.config).toHaveProperty('columns');
    expectSpecValid(body);
  });

  it('builds a spec-valid form-family ViewItem carrying the chosen form layout', () => {
    const body = build({
      label: 'Intake',
      name: 'intake',
      object: 'crm_lead',
      viewKind: 'form',
      formType: 'tabbed',
    });
    expect(body.viewKind).toBe('form');
    const config = body.config as Record<string, unknown>;
    expect(config.type).toBe('tabbed');
    // Form views carry a `sections` body, never a list `columns` array.
    expect(config).toHaveProperty('sections');
    expect(config).not.toHaveProperty('columns');
    expect(config.data).toEqual({ provider: 'object', object: 'crm_lead' });
    expectSpecValid(body);
  });

  it('defaults the form layout to `simple` when formType is unset', () => {
    const body = build({ label: 'Detail', name: 'detail', object: 'crm_lead', viewKind: 'form' });
    expect(body.viewKind).toBe('form');
    expect((body.config as Record<string, unknown>).type).toBe('simple');
    expectSpecValid(body);
  });

  it('accepts every form layout the spec enumerates', () => {
    for (const formType of ['simple', 'tabbed', 'wizard', 'split', 'drawer', 'modal']) {
      const body = build({ label: 'F', name: `f_${formType}`, object: 'crm_lead', viewKind: 'form', formType });
      expect((body.config as Record<string, unknown>).type).toBe(formType);
      expectSpecValid(body);
    }
  });

  it('seeds one starter step for a wizard create — and ONLY for wizard (objectui#6985)', () => {
    // A `type: 'wizard'` form view must declare its steps: the spec refuses
    // absent/empty `sections` on the wizard variant at parse (objectstack#13622
    // D7, ruled 2026-08-31). An empty-`sections` wizard body would 422 at
    // create→save on a platform running a spec that carries the refusal — so
    // the build seeds one starter step, exactly as the flow anchor seeds its
    // required `type` enum (objectui#2326).
    const wizard = build({ label: 'W', name: 'w', object: 'crm_lead', viewKind: 'form', formType: 'wizard' });
    const sections = (wizard.config as Record<string, unknown>).sections as unknown[];
    expect(sections.length).toBeGreaterThanOrEqual(1);
    expectSpecValid(wizard);

    // The boundary: only the wizard variant refuses emptiness, and fabricated
    // structure must not leak into every authored view. A tabbed create keeps
    // the bare `[]` it always had.
    const tabbed = build({ label: 'T', name: 't', object: 'crm_lead', viewKind: 'form', formType: 'tabbed' });
    expect((tabbed.config as Record<string, unknown>).sections).toEqual([]);
    expectSpecValid(tabbed);
  });

  it('qualifies the view name to <object>.<key> for both families', () => {
    expect(build({ label: 'All', name: 'all', object: 'crm_lead' }).name).toBe('crm_lead.all');
    expect(
      build({ label: 'Intake', name: 'intake', object: 'crm_lead', viewKind: 'form' }).name,
    ).toBe('crm_lead.intake');
    // An already-qualified key is left untouched.
    expect(build({ label: 'X', name: 'crm_lead.x', object: 'crm_lead' }).name).toBe('crm_lead.x');
  });
});

describe('view create form contract exposes both families (objectui#2323)', () => {
  it('lists viewKind + formType among the create fields', () => {
    const cfg = viewConfig();
    expect(cfg.createFields).toContain('viewKind');
    expect(cfg.createFields).toContain('formType');
  });

  it('offers list vs form families and per-family layouts in the create schema', () => {
    const props = (viewConfig().createSchema as Record<string, any>)?.properties ?? {};
    expect(props.viewKind?.enum).toEqual(['list', 'form']);
    expect(props.kind?.enum).toEqual(['grid', 'kanban', 'gallery', 'calendar', 'timeline', 'gantt', 'chart']);
    expect(props.formType?.enum).toEqual(['simple', 'tabbed', 'wizard', 'split', 'drawer', 'modal']);
    // Each layout picker is gated to its family so the form shows only the
    // relevant one, through SchemaForm's per-property `visibleWhen`. The
    // retired `visibleOn` spelling is not written (objectui#12696):
    // `view-create-body.visibility.test.tsx` renders the gate.
    expect(props.kind?.visibleWhen).toBe("data.viewKind == 'list'");
    expect(props.formType?.visibleWhen).toBe("data.viewKind == 'form'");
    expect(props.kind).not.toHaveProperty('visibleOn');
    expect(props.formType).not.toHaveProperty('visibleOn');
  });
});

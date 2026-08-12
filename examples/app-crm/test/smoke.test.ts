// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import stack from '../objectstack.config.js';
import { PipelineDashboard } from '../src/dashboards/pipeline.dashboard.js';

describe('app-crm minimal metadata bundle', () => {
  it('exposes the expected manifest', () => {
    // `manifest` is optional on the stack bundle type; this example always
    // declares one. Assert that precondition first, then read through it —
    // the same guard-then-`!` shape this file already uses for `stack.i18n`
    // and `stack.translations` below.
    expect(stack.manifest).toBeDefined();
    expect(stack.manifest!.id).toBe('com.example.crm');
    expect(stack.manifest!.namespace).toBe('crm');
    expect(stack.manifest!.type).toBe('app');
  });

  it('registers the 6 core objects', () => {
    const names = (stack.objects ?? []).map((o) => o.name).sort();
    expect(names).toEqual([
      'crm_account',
      'crm_activity',
      'crm_contact',
      'crm_lead',
      'crm_opportunity',
      'crm_opportunity_line_item',
    ]);
  });

  it('registers exactly one app, one dashboard, one hook, and one flow', () => {
    expect(stack.apps).toHaveLength(1);
    expect(stack.dashboards).toHaveLength(1);
    expect(stack.hooks).toHaveLength(1);
    // One flow only — the convert-lead screen wizard. Automation breadth
    // is the showcase's job.
    expect(stack.flows).toHaveLength(1);
  });

  it('includes a screen flow with input/output variables, screen nodes, and guard decision', () => {
    const screenFlow = (stack.flows ?? []).find((f: any) => f.type === 'screen');
    expect(screenFlow).toBeDefined();
    expect(screenFlow!.name).toBe('crm_convert_lead_wizard');
    // Has variables with isInput and isOutput
    const vars = (screenFlow as any).variables ?? [];
    expect(vars.some((v: any) => v.isInput)).toBe(true);
    expect(vars.some((v: any) => v.isOutput)).toBe(true);
    // Has screen nodes
    const nodes = (screenFlow as any).nodes ?? [];
    const screenNodes = nodes.filter((n: any) => n.type === 'screen');
    expect(screenNodes.length).toBeGreaterThanOrEqual(3);
    // Has a decision guard node
    const decisionNodes = nodes.filter((n: any) => n.type === 'decision');
    expect(decisionNodes.length).toBeGreaterThanOrEqual(1);
    // Action points to this flow
    const action = (stack.actions ?? []).find((a: any) => a.target === 'crm_convert_lead_wizard');
    expect(action).toBeDefined();
    expect((action as any).objectName).toBe('crm_lead');
  });

  it('registers 3 views with data-object bindings for Studio display', () => {
    expect((stack.views ?? []).length).toBe(3);
    for (const v of stack.views ?? []) {
      // Each view must have at least one data-bound list entry so Studio can identify it
      const listData = (v as any).list?.data ?? (v as any).listViews?.all?.data;
      expect(listData?.provider).toBe('object');
      expect(typeof listData?.object).toBe('string');
    }
  });

  it('ships seed data for every object', () => {
    expect(stack.data).toBeDefined();
    expect((stack.data ?? []).length).toBeGreaterThanOrEqual(3);
  });

  // Infrastructure & security of the slim core (feature breadth lives in
  // the showcase — its coverage manifest enforces it; see #2611/#2612 for
  // the inert mappings/connectors this example used to demo):
  it('has datasources', () => {
    expect((stack.datasources ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('has translations (en + zh-CN)', () => {
    expect((stack.translations ?? []).length).toBeGreaterThanOrEqual(1);
    const bundle = stack.translations![0] as Record<string, unknown>;
    expect(bundle.en).toBeDefined();
    expect(bundle['zh-CN']).toBeDefined();
  });

  it('has i18n config', () => {
    expect(stack.i18n).toBeDefined();
    expect(stack.i18n!.defaultLocale).toBe('en');
    expect(stack.i18n!.supportedLocales).toContain('zh-CN');
  });

  it('has criteria sharing rules (the enforced form — owner-type was retired)', () => {
    const rules = stack.sharingRules ?? [];
    expect(rules.length).toBeGreaterThanOrEqual(2);
    // `type: 'owner'` no longer parses (never enforced; ADR-0078): every
    // declared rule is the enforced criteria form.
    expect(rules.every((r) => r.type === 'criteria')).toBe(true);
  });

  // #3420 — official examples must boot warning-free. A generic (non-better-auth)
  // `password` field trips the ADR-0100 author-time warning unless it affirms
  // intent with `ackPlaintextMasking: true`. crm ships none today; this guard
  // fails loudly if one is ever added without the acknowledgment.
  it('has no un-acknowledged generic password fields (#3420)', () => {
    const offenders: string[] = [];
    for (const obj of (stack.objects ?? []) as any[]) {
      if (obj?.managedBy === 'better-auth') continue;
      for (const [fieldName, def] of Object.entries((obj?.fields ?? {}) as Record<string, any>)) {
        if (def?.type === 'password' && def?.ackPlaintextMasking !== true) {
          offenders.push(`${obj.name}.${fieldName}`);
        }
      }
    }
    expect(offenders, `un-acknowledged generic password field(s): ${offenders.join(', ')}`).toEqual([]);
  });

  // #8164 — crm_opportunity_line_item is a master_detail CHILD of
  // crm_opportunity (sharingModel: 'controlled_by_parent'). Record-level
  // access always follows the parent (ADR-0055), but object-level CRUD is a
  // SEPARATE gate the platform never derives (security-master-detail-ungranted):
  // a permission set that grants the master but forgets the child denies
  // role-bound non-admin users a 403 before parent-derived access is ever
  // consulted. Assert `crm_sales_user` grants the child, with the SAME shape
  // as its master — not an independently-invented one.
  it('grants crm_opportunity_line_item in crm_sales_user, matching its master crm_opportunity (#8164)', () => {
    const salesUserSet = (stack.permissions ?? []).find((p: any) => p.name === 'crm_sales_user') as any;
    expect(salesUserSet, 'crm_sales_user permission set not found').toBeDefined();

    const masterGrant = salesUserSet.objects?.crm_opportunity;
    const childGrant = salesUserSet.objects?.crm_opportunity_line_item;
    expect(masterGrant, 'crm_opportunity itself must remain granted').toBeDefined();
    expect(childGrant, 'crm_opportunity_line_item has no object-level CRUD grant').toBeDefined();
    expect(childGrant).toEqual(masterGrant);
  });

});

describe('Pipeline dashboard', () => {
  const byId = new Map(PipelineDashboard.widgets.map((w: any) => [w.id, w]));

  it('lays out all 6 widgets', () => {
    expect(PipelineDashboard.widgets).toHaveLength(6);
    expect([...byId.keys()].sort()).toEqual(
      [
        'avg_deal_size_yoy',
        'opportunities_by_stage',
        'pipeline_by_industry',
        'pipeline_trend_90d',
        'total_pipeline',
        'won_this_quarter',
      ],
    );
  });

  it('uses `compareTo: { kind: previousPeriod }` for the current-quarter KPI', () => {
    const w: any = byId.get('won_this_quarter');
    // #5011: `compareTo` is the executor's own `{ kind, dimension? }` shape.
    // `dimension` is omitted deliberately — `opportunity_metrics` dates exactly
    // one dimension, so the executor resolves it (and would error, naming the
    // candidates, if it could not).
    expect(w.compareTo).toEqual({ kind: 'previousPeriod' });
    expect(w.filter.close_date.$gte).toBe('{current_quarter_start}');
    expect(w.filter.close_date.$lte).toBe('{current_quarter_end}');
  });

  it('uses `compareTo: { kind: previousYear }` for the YoY KPI', () => {
    const w: any = byId.get('avg_deal_size_yoy');
    expect(w.compareTo).toEqual({ kind: 'previousYear' });
    expect(w.filter.close_date.$gte).toBe('{current_year_start}');
    expect(w.filter.close_date.$lte).toBe('{current_year_end}');
  });

  it('uses a YoY `previousYear` compareTo on the trend chart', () => {
    const w: any = byId.get('pipeline_trend_90d');
    expect(w.compareTo).toEqual({ kind: 'previousYear' });
    expect(w.type).toBe('line');
    // ADR-0021 single-form: the date axis is a dataset dimension (its monthly
    // bucketing lives on the dataset's close_date dimension, not the widget).
    expect(w.dimensions).toContain('close_date');
  });

  it('omits compareTo on widgets that do not need it (pie, total)', () => {
    expect((byId.get('total_pipeline') as any).compareTo).toBeUndefined();
    expect((byId.get('pipeline_by_industry') as any).compareTo).toBeUndefined();
  });

  it('uses `compareTo: { kind: previousPeriod }` on the Opportunities by Stage bar chart', () => {
    const w: any = byId.get('opportunities_by_stage');
    expect(w.compareTo).toEqual({ kind: 'previousPeriod' });
    expect(w.type).toBe('bar');
  });

  it('widgets bind to the opportunity dataset', () => {
    // ADR-0021 single-form: widgets reference the semantic dataset, not a raw object.
    for (const w of PipelineDashboard.widgets) {
      expect((w as any).dataset).toBe('opportunity_metrics');
    }
  });

  it('layout positions do not overlap and fit within 12 columns', () => {
    const cells: Record<string, string> = {};
    for (const w of PipelineDashboard.widgets as any[]) {
      const { x, y, w: ww, h } = w.layout;
      expect(x + ww).toBeLessThanOrEqual(12);
      for (let i = x; i < x + ww; i++) {
        for (let j = y; j < y + h; j++) {
          const key = `${i},${j}`;
          if (cells[key]) {
            throw new Error(`Widget ${w.id} overlaps ${cells[key]} at ${key}`);
          }
          cells[key] = w.id;
        }
      }
    }
  });
});

describe('Pipeline dashboard schema validation', () => {
  it('passes the DashboardSchema zod parser end-to-end', async () => {
    const { DashboardSchema } = await import('@objectstack/spec/ui');
    const parsed = DashboardSchema.parse(PipelineDashboard);
    expect(parsed.name).toBe('pipeline_dashboard');
    expect(parsed.widgets).toHaveLength(6);
  });
});

// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import stack from '../objectstack.config.js';
import { PipelineDashboard } from '../src/dashboards/pipeline.dashboard.js';

describe('app-crm minimal metadata bundle', () => {
  it('exposes the expected manifest', () => {
    expect(stack.manifest.id).toBe('com.example.crm');
    expect(stack.manifest.namespace).toBe('crm');
    expect(stack.manifest.type).toBe('app');
  });

  it('registers the 5 core objects', () => {
    const names = (stack.objects ?? []).map((o) => o.name).sort();
    expect(names).toEqual(['crm_account', 'crm_activity', 'crm_contact', 'crm_lead', 'crm_opportunity']);
  });

  it('registers exactly one app, one dashboard, one hook, and at least 4 flows', () => {
    expect(stack.apps).toHaveLength(1);
    expect(stack.dashboards).toHaveLength(1);
    expect(stack.hooks).toHaveLength(1);
    expect((stack.flows ?? []).length).toBeGreaterThanOrEqual(4);
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

  // Phase 2: full metadata coverage
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

  it('has object extensions', () => {
    expect((stack.objectExtensions ?? []).length).toBeGreaterThanOrEqual(1);
    expect(stack.objectExtensions![0].extend).toBe('crm_contact');
  });

  it('has a portal', () => {
    expect((stack.portals ?? []).length).toBeGreaterThanOrEqual(1);
    expect(stack.portals![0].routePrefix).toBe('/portal/customer');
  });

  it('has themes (light + dark)', () => {
    expect((stack.themes ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('has jobs', () => {
    expect((stack.jobs ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('has sharing rules (criteria + owner types)', () => {
    const rules = stack.sharingRules ?? [];
    expect(rules.length).toBeGreaterThanOrEqual(2);
    expect(rules.some((r) => r.type === 'criteria')).toBe(true);
    expect(rules.some((r) => r.type === 'owner')).toBe(true);
  });

  it('has security policies', () => {
    const policies = stack.policies ?? [];
    expect(policies.length).toBeGreaterThanOrEqual(1);
    expect(policies.some((p) => p.isDefault)).toBe(true);
  });

  it('has API endpoints', () => {
    expect((stack.apis ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('has webhooks', () => {
    expect((stack.webhooks ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('has import/export mappings', () => {
    expect((stack.mappings ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('has analytics cubes', () => {
    expect((stack.analyticsCubes ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('has connectors', () => {
    expect((stack.connectors ?? []).length).toBeGreaterThanOrEqual(1);
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

  it('uses `compareTo: previousPeriod` for the current-quarter KPI', () => {
    const w: any = byId.get('won_this_quarter');
    expect(w.compareTo).toBe('previousPeriod');
    expect(w.filter.close_date.$gte).toBe('{current_quarter_start}');
    expect(w.filter.close_date.$lte).toBe('{current_quarter_end}');
  });

  it('uses `compareTo: previousYear` for the YoY KPI', () => {
    const w: any = byId.get('avg_deal_size_yoy');
    expect(w.compareTo).toBe('previousYear');
    expect(w.filter.close_date.$gte).toBe('{current_year_start}');
    expect(w.filter.close_date.$lte).toBe('{current_year_end}');
  });

  it('uses a YoY `previousYear` compareTo on the trend chart', () => {
    const w: any = byId.get('pipeline_trend_90d');
    expect(w.compareTo).toBe('previousYear');
    expect(w.type).toBe('line');
    // ADR-0021 single-form: the date axis is a dataset dimension (its monthly
    // bucketing lives on the dataset's close_date dimension, not the widget).
    expect(w.dimensions).toContain('close_date');
  });

  it('omits compareTo on widgets that do not need it (pie, total)', () => {
    expect((byId.get('total_pipeline') as any).compareTo).toBeUndefined();
    expect((byId.get('pipeline_by_industry') as any).compareTo).toBeUndefined();
  });

  it('uses `compareTo: previousPeriod` on the Opportunities by Stage bar chart', () => {
    const w: any = byId.get('opportunities_by_stage');
    expect(w.compareTo).toBe('previousPeriod');
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

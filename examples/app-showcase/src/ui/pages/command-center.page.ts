// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { definePage } from '@objectstack/spec/ui';

/**
 * Operations Command Center (大屏) — a full-bleed SDUI "big screen" that follows
 * the console theme (light ↔ dark). It exercises the data-screen customization
 * primitives added to objectui (#1922 + follow-up):
 *   • object-metric `variant:'bare'` → live KPIs as big tinted numbers (no card
 *     chrome) — data-bound, not hand-typed.
 *   • object-chart `colors` → one cohesive brand palette across every chart
 *     (replaces the old `--chart-1..5` override hack).
 *   • object-chart `chartType:'donut'` → first-class (was an untyped string).
 *   • full-bleed page + container-scaled donuts + gradient bars/areas.
 *
 * Composition: centred title → full-width KPI hero strip (6 live metrics) →
 * two equal chart rows (throughput trend spans 2) → work queue on its own
 * full-width row (height never knocks a chart row out of alignment).
 *
 * Theme-adaptive: panels/text/hairlines are theme tokens (`hsl(var(--card))` …).
 * Layout note: object-chart must sit in a `display:block` panel (a flex child
 * collapses to width:0 and recharts won't draw).
 */

// One cohesive brand palette, mid-lightness so it reads on light AND dark.
const PALETTE = ['hsl(192 86% 46%)', 'hsl(214 84% 56%)', 'hsl(256 72% 62%)', 'hsl(168 76% 42%)', 'hsl(322 72% 56%)'];
const A = { c1: PALETTE[0], c2: PALETTE[1], c3: PALETTE[2], c4: PALETTE[3], c5: PALETTE[4] };

function head(id: string, title: string, accent: string, badge?: string): any {
  return {
    id: id + '_h', type: 'flex',
    responsiveStyles: { large: { display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '12px', paddingBottom: '10px', borderBottom: '1px solid hsl(var(--border))' } },
    properties: {
      children: [
        { id: id + '_bar', type: 'flex', responsiveStyles: { large: { width: '4px', height: '15px', borderRadius: '2px', background: accent, boxShadow: '0 0 10px ' + accent } }, properties: { children: [] } },
        { id: id + '_t', type: 'element:text', responsiveStyles: { large: { fontSize: '14px', fontWeight: '700', letterSpacing: '0.03em', color: 'hsl(var(--foreground))' } }, properties: { content: title } },
        ...(badge
          ? [
              { id: id + '_sp', type: 'flex', responsiveStyles: { large: { flex: '1 1 auto' } }, properties: { children: [] } },
              { id: id + '_b', type: 'element:text', responsiveStyles: { large: { fontSize: '11px', fontWeight: '700', color: A.c2, background: 'hsl(214 84% 56% / 0.12)', border: '1px solid hsl(214 84% 56% / 0.4)', borderRadius: '999px', padding: '3px 11px' } }, properties: { content: badge } },
            ]
          : []),
      ],
    },
  };
}

function panel(o: { id: string; title?: string; accent: string; badge?: string; minHeight?: string; span?: string; pad?: string; child: any }): any {
  return {
    id: o.id, type: 'flex',
    responsiveStyles: {
      large: {
        display: 'block', minWidth: '0', minHeight: o.minHeight ?? '240px',
        ...(o.span ? { gridColumn: o.span } : {}),
        padding: o.pad ?? '15px 17px 17px', borderRadius: '16px',
        background: 'hsl(var(--card))',
        border: '1px solid hsl(var(--border))',
        boxShadow: '0 16px 40px -24px rgba(2,6,23,0.45), inset 0 1px 0 hsl(var(--foreground) / 0.04)',
      },
      small: { padding: '12px', minHeight: '200px' },
    },
    properties: { children: [...(o.title ? [head(o.id, o.title, o.accent, o.badge)] : []), o.child] },
  };
}

function band(id: string, cols: number, children: any[], gap = '16px'): any {
  return {
    id, type: 'flex',
    responsiveStyles: {
      large: { display: 'grid', gridTemplateColumns: 'repeat(' + cols + ', minmax(0,1fr))', gap, alignItems: 'stretch' },
      medium: { gridTemplateColumns: 'repeat(2, minmax(0,1fr))' },
      small: { gridTemplateColumns: '1fr' },
    },
    properties: { children },
  };
}

/** A LIVE KPI — object-metric in the new `bare` variant (big tinted number + label). */
function kpi(id: string, object: string, label: string, colorVariant: string, aggregate: any, filter?: any, format?: string): any {
  return {
    id, type: 'object-metric',
    responsiveStyles: { large: { minWidth: '0' } },
    properties: { objectName: object, label, colorVariant, variant: 'bare', aggregate, ...(filter ? { filter } : {}), ...(format ? { format } : {}) },
  };
}

/**
 * A dataset-bound chart with the shared brand palette. `integerYAxis` pins the
 * tick step to 1 — without it, count aggregates (small integers like 0-5)
 * render fractional gridlines (0.8, 2.3, …) on the default Recharts axis.
 */
function chart(id: string, chartType: string, dataset: string, dimensions: string[], values: string[], integerYAxis?: boolean): any {
  return {
    id, type: 'object-chart', responsiveStyles: { large: { width: '100%', minWidth: '0' } },
    properties: { dataset, dimensions, values, chartType, colors: PALETTE, ...(integerYAxis ? { yAxis: [{ field: values[0], stepSize: 1 }] } : {}) },
  };
}

const CHART_H = '376px';

export const CommandCenterPage = definePage({
  name: 'showcase_command_center',
  label: 'Command Center (大屏)',
  type: 'app',
  template: 'default',
  kind: 'full',
  isDefault: false,
  regions: [
    {
      name: 'main',
      width: 'full',
      components: [
        {
          id: 'cc_root',
          type: 'flex',
          responsiveStyles: {
            large: {
              minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '16px',
              padding: '22px 26px 32px',
              background:
                'radial-gradient(1200px 540px at 50% -14%, hsl(192 86% 46% / 0.10) 0%, transparent 60%), ' +
                'radial-gradient(900px 460px at 100% 0%, hsl(256 72% 62% / 0.08) 0%, transparent 55%), ' +
                'hsl(var(--background))',
              color: 'hsl(var(--foreground))',
            },
            small: { padding: '14px 12px 24px', gap: '12px' },
          },
          properties: {
            children: [
              // ── Title ────────────────────────────────────────────────────
              {
                id: 'cc_titlebar', type: 'flex',
                responsiveStyles: { large: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', padding: '2px 0 2px' } },
                properties: {
                  children: [
                    { id: 'cc_title', type: 'element:text', responsiveStyles: { large: { fontSize: '27px', fontWeight: '800', letterSpacing: '0.4em', color: 'hsl(var(--foreground))', textShadow: '0 0 26px hsl(192 86% 46% / 0.45)' }, small: { fontSize: '18px', letterSpacing: '0.16em' } }, properties: { content: '交 付 运 营 数 据 大 屏' } },
                    { id: 'cc_subtitle', type: 'element:text', responsiveStyles: { large: { fontSize: '11px', fontWeight: '600', letterSpacing: '0.36em', color: 'hsl(var(--muted-foreground))' } }, properties: { content: 'DELIVERY OPERATIONS · COMMAND CENTER' } },
                    { id: 'cc_rule', type: 'flex', responsiveStyles: { large: { width: 'min(640px, 60%)', height: '1px', marginTop: '4px', background: 'linear-gradient(90deg, transparent, hsl(192 86% 46% / 0.55), transparent)' } }, properties: { children: [] } },
                  ],
                },
              },

              // ── KPI hero strip — 6 LIVE metrics (bare variant) ───────────
              panel({
                id: 'cc_kpi', title: '核心指标 · Key Metrics', accent: A.c3, minHeight: '0px', pad: '14px 18px 16px',
                child: band('cc_kpi_grid', 6, [
                  kpi('cc_k1', 'showcase_project', '活跃项目 Active', 'blue', { field: 'id', function: 'count' }, [{ field: 'status', operator: 'equals', value: 'active' }]),
                  kpi('cc_k2', 'showcase_task', '待办任务 Open', 'teal', { field: 'id', function: 'count' }, [{ field: 'status', operator: 'not_equals', value: 'done' }]),
                  kpi('cc_k3', 'showcase_task', '待复审 Review', 'purple', { field: 'id', function: 'count' }, [{ field: 'status', operator: 'equals', value: 'in_review' }]),
                  kpi('cc_k4', 'showcase_project', '风险项目 At-Risk', 'danger', { field: 'id', function: 'count' }, [{ field: 'health', operator: 'equals', value: 'red' }]),
                  kpi('cc_k5', 'showcase_account', '客户 Accounts', 'orange', { field: 'id', function: 'count' }),
                  kpi('cc_k6', 'showcase_project', '总预算 Budget', 'success', { field: 'budget', function: 'sum' }, undefined, '0.0a'),
                ], '10px'),
              }),

              // ── Row A — three equal chart panels ─────────────────────────
              band('cc_rowA', 3, [
                panel({ id: 'cc_status', title: '任务状态分布', accent: A.c1, minHeight: CHART_H, child: chart('cc_status_c', 'bar', 'showcase_task_metrics', ['status'], ['task_count'], true) }),
                panel({ id: 'cc_health', title: '项目健康度', accent: A.c4, minHeight: CHART_H, child: chart('cc_health_c', 'donut', 'showcase_project_metrics', ['health'], ['project_count']) }),
                panel({ id: 'cc_priority', title: '优先级分布', accent: A.c5, minHeight: CHART_H, child: chart('cc_pri_c', 'bar', 'showcase_task_metrics', ['priority'], ['task_count'], true) }),
              ]),

              // ── Row B — wide trend (span 2) + spend ──────────────────────
              band('cc_rowB', 3, [
                panel({ id: 'cc_throughput', title: '任务吞吐趋势 (月)', accent: A.c2, span: 'span 2', minHeight: CHART_H, child: chart('cc_thr_c', 'area', 'showcase_task_metrics', ['created_at'], ['task_count'], true) }),
                panel({ id: 'cc_budget', title: '预算 vs 支出 (按客户)', accent: A.c4, minHeight: CHART_H, child: chart('cc_bud_c', 'bar', 'showcase_project_metrics', ['account'], ['budget_sum', 'spent_sum']) }),
              ]),

              // ── Work queue — its own full-width row at the bottom ────────
              panel({
                id: 'cc_queue', title: '待审核列表 · Work Queue', accent: A.c1, badge: '审批中', minHeight: '0px',
                child: { id: 'cc_queue_g', type: 'object-grid', responsiveStyles: { large: { minWidth: '0', display: 'block' } }, properties: { objectName: 'showcase_task', columns: ['title', 'project', 'status', 'priority', 'due_date'] } },
              }),
            ],
          },
        },
      ],
    },
  ],
});

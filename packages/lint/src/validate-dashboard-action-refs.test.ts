// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateDashboardActionRefs,
  DASHBOARD_ACTION_TARGET_UNDEFINED,
  DASHBOARD_ACTION_ROUTE_UNRESOLVED,
} from './validate-dashboard-action-refs';

/** Build a stack with a single dashboard whose header carries `actions`. */
function dashWithHeaderActions(actions: unknown[], extra: Record<string, unknown> = {}) {
  return {
    ...extra,
    dashboards: [
      { name: 'exec', label: 'Executive', header: { actions }, widgets: [] },
    ],
  };
}

describe('validateDashboardActionRefs (ADR-0049 references / #3367)', () => {
  it('passes a script action that names a defined global action', () => {
    const findings = validateDashboardActionRefs(
      dashWithHeaderActions(
        [{ label: 'Recalc', actionType: 'script', actionUrl: 'recalc_totals' }],
        { actions: [{ name: 'recalc_totals', type: 'script' }] },
      ),
    );
    expect(findings).toEqual([]);
  });

  it('passes a script action that names a defined object-embedded action', () => {
    const findings = validateDashboardActionRefs(
      dashWithHeaderActions(
        [{ label: 'Close', actionType: 'script', actionUrl: 'close_deal' }],
        { objects: [{ name: 'opportunity', actions: [{ name: 'close_deal', type: 'script' }] }] },
      ),
    );
    expect(findings).toEqual([]);
  });

  it('ERRORS on a script action whose target is defined nowhere', () => {
    const findings = validateDashboardActionRefs(
      dashWithHeaderActions([
        { label: 'Export PDF', actionType: 'script', actionUrl: 'export_dashboard_pdf' },
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: DASHBOARD_ACTION_TARGET_UNDEFINED,
      where: 'dashboard "exec" · header action "Export PDF"',
      path: 'dashboards[0].header.actions[0].actionUrl',
    });
    expect(findings[0].message).toContain('export_dashboard_pdf');
  });

  // objectstack#6739-A (2026-08-09): a `modal` string target names a PAGE, and
  // only a page. The four tests below pin BOTH directions of that ruling: the
  // one shape the runtime serves resolves, and each retired limb — a defined
  // action name, the `<verb>_<object>` prefix convention, a bare object name —
  // is refused. Until objectui#4782 deleted `DashboardView`'s own modal
  // handler (the convention's last live copy), this file pinned the opposite:
  // the three retired shapes passed and a page-named target ERRORED, so
  // `os validate` blessed exactly the buttons the runtime refuses.
  it('passes a modal action that names a declared page', () => {
    const findings = validateDashboardActionRefs(
      dashWithHeaderActions(
        [{ label: 'New Deal', actionType: 'modal', actionUrl: 'deal_intake' }],
        { pages: [{ name: 'deal_intake' }] },
      ),
    );
    expect(findings).toEqual([]);
  });

  it('ERRORS on a modal action that names a defined action — an action is not a page', () => {
    const findings = validateDashboardActionRefs(
      dashWithHeaderActions(
        [{ label: 'New Deal', actionType: 'modal', actionUrl: 'quick_create_deal' }],
        { actions: [{ name: 'quick_create_deal', type: 'modal' }] },
      ),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: DASHBOARD_ACTION_TARGET_UNDEFINED,
    });
    expect(findings[0].message).toContain('quick_create_deal');
    expect(findings[0].message).toContain('names no declared page');
  });

  it('ERRORS on the retired <verb>_<object> convention, even against a real object', () => {
    const findings = validateDashboardActionRefs(
      dashWithHeaderActions(
        [{ label: 'New Deal', actionType: 'modal', actionUrl: 'create_opportunity' }],
        { objects: [{ name: 'opportunity' }] },
      ),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: DASHBOARD_ACTION_TARGET_UNDEFINED,
    });
    expect(findings[0].message).toContain('create_opportunity');
    // The ruling explicitly declined the middle shape (keep the prefix, reject
    // bare object names): `create_opportunity` names the page
    // `create_opportunity`, or it names nothing.
    expect(findings[0].message).toContain('names no declared page');
    expect(findings[0].hint).toContain("actionType: 'form'");
  });

  it('ERRORS on a bare object name — the create-form fallback is retired', () => {
    const findings = validateDashboardActionRefs(
      dashWithHeaderActions(
        [{ label: 'Add Lead', actionType: 'modal', actionUrl: 'lead' }],
        { objects: [{ name: 'lead' }] },
      ),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: DASHBOARD_ACTION_TARGET_UNDEFINED,
    });
    expect(findings[0].message).toContain('lead');
    expect(findings[0].hint).toContain('stack.pages');
  });

  it('passes a url action pointing at a registered report route', () => {
    const findings = validateDashboardActionRefs(
      dashWithHeaderActions(
        [{ label: 'Forecast', actionType: 'url', actionUrl: '/reports/forecast' }],
        { reports: [{ name: 'forecast' }] },
      ),
    );
    expect(findings).toEqual([]);
  });

  it('WARNS on a url action pointing at a non-existent in-app route', () => {
    const findings = validateDashboardActionRefs(
      dashWithHeaderActions([
        { label: 'Forecast', actionType: 'url', actionUrl: '/reports/forecast' },
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'warning',
      rule: DASHBOARD_ACTION_ROUTE_UNRESOLVED,
      where: 'dashboard "exec" · header action "Forecast"',
      path: 'dashboards[0].header.actions[0].actionUrl',
    });
    expect(findings[0].message).toContain('/reports/forecast');
    expect(findings[0].message).toContain('report named "forecast"');
  });

  it('resolves an object route embedded mid-path (app-scoped route)', () => {
    const findings = validateDashboardActionRefs(
      dashWithHeaderActions(
        [{ label: 'Deals', actionType: 'url', actionUrl: '/apps/crm/objects/deal' }],
        { objects: [{ name: 'deal' }] },
      ),
    );
    expect(findings).toEqual([]);
  });

  it('skips external URLs, interpolated targets, and opaque routes (no false positives)', () => {
    const findings = validateDashboardActionRefs(
      dashWithHeaderActions([
        { label: 'Docs', actionType: 'url', actionUrl: 'https://example.com/x' },
        { label: 'Proto', actionType: 'url', actionUrl: '//cdn.example.com/y' },
        { label: 'Dyn', actionType: 'url', actionUrl: '/reports/${ctx.reportId}' },
        { label: 'Home', actionType: 'url', actionUrl: '/home' },
        { label: 'Settings', actionType: 'url', actionUrl: '/settings/profile' },
        { label: 'Bare', actionType: 'url', actionUrl: 'some-handler' },
      ]),
    );
    expect(findings).toEqual([]);
  });

  it('defaults a missing actionType to url (never errors on an unqualified target)', () => {
    const findings = validateDashboardActionRefs(
      dashWithHeaderActions([{ label: 'Mystery', actionUrl: 'do_something' }]),
    );
    // `do_something` has no leading slash → treated as opaque url → skipped.
    expect(findings).toEqual([]);
  });

  // #5010 — the widget branch is GONE, and this is the pin that keeps it gone.
  //
  // Until 17.0.0 this rule raised an ERROR (a failed build) for a dangling
  // `widgets[].actionUrl` target, on the docblock's claim that it mirrored the
  // objectui runtime dispatch. It did not: no renderer draws a per-widget action
  // button, so the strictest arm of the rule guarded a control that cannot
  // render. The keys are now tombstoned in the spec, which owns the rejection —
  // this rule must stay silent rather than fail a build a second time over.
  it('does NOT check per-widget actionUrl: no per-widget button exists (#5010)', () => {
    const findings = validateDashboardActionRefs({
      dashboards: [
        {
          name: 'ops',
          label: 'Ops',
          widgets: [
            // A target that would have been an ERROR before #5010: `ghost_action`
            // is defined nowhere in this stack.
            { id: 'kpi', dataset: 'd', values: ['x'], actionType: 'script', actionUrl: 'ghost_action' },
            { id: 'noaction', dataset: 'd', values: ['x'] },
          ],
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('still checks header actions when a widget carries a legacy action key (#5010)', () => {
    // Mixed stack: the header target is dead AND a stale widget key survives in
    // a stored document. Exactly one finding, and it belongs to the header —
    // proving the widget key is ignored rather than merely out-prioritised.
    const findings = validateDashboardActionRefs({
      dashboards: [
        {
          name: 'ops',
          label: 'Ops',
          header: { actions: [{ label: 'Export', actionType: 'script', actionUrl: 'ghost_header' }] },
          widgets: [
            { id: 'kpi', dataset: 'd', values: ['x'], actionType: 'script', actionUrl: 'ghost_widget' },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: DASHBOARD_ACTION_TARGET_UNDEFINED,
      path: 'dashboards[0].header.actions[0].actionUrl',
    });
  });

  it('covers the issue #3367 repro: one script + one modal error, one url warning', () => {
    // Faithful to the runtime: `create_opportunity` would resolve only as the
    // name of a declared PAGE (objectstack#6739-A — the <verb>_<object>
    // convention is retired). No page is declared here, so all three targets
    // are dead.
    const findings = validateDashboardActionRefs(
      dashWithHeaderActions([
        { label: 'Export PDF', actionType: 'script', actionUrl: 'export_dashboard_pdf' },
        { label: 'New Deal', actionType: 'modal', actionUrl: 'create_opportunity' },
        { label: 'Forecast', actionType: 'url', actionUrl: '/reports/forecast' },
      ]),
    );
    const errors = findings.filter((f) => f.severity === 'error');
    const warnings = findings.filter((f) => f.severity === 'warning');
    expect(errors).toHaveLength(2);
    expect(warnings).toHaveLength(1);
    expect(errors.map((e) => e.path)).toEqual([
      'dashboards[0].header.actions[0].actionUrl',
      'dashboards[0].header.actions[1].actionUrl',
    ]);
  });

  it('tolerates junk / empty input and dashboards without actions', () => {
    expect(validateDashboardActionRefs({})).toEqual([]);
    expect(validateDashboardActionRefs(undefined as unknown as Record<string, unknown>)).toEqual([]);
    expect(validateDashboardActionRefs({ dashboards: [] })).toEqual([]);
    expect(validateDashboardActionRefs({ dashboards: [null, 42] as unknown })).toEqual([]);
    expect(
      validateDashboardActionRefs({ dashboards: [{ name: 'd', widgets: [], header: {} }] }),
    ).toEqual([]);
  });
});

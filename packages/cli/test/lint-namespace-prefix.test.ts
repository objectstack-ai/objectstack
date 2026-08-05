// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { normalizeStackInput } from '@objectstack/spec';
import { ActionSchema } from '@objectstack/spec/ui';
import { lintConfig } from '../src/commands/lint';

const RULE = 'naming/namespace-prefix';
const prefixIssues = (config: any) => lintConfig(config).filter((i) => i.rule === RULE);

describe('lint — intra-package duplicate-name advisory (ADR-0048 §3.4)', () => {
  it('stays silent on unique bare names — they are NOT a collision (ADR-0048 §3.4)', () => {
    // The cross-package throw was retired: distinct packages coexist on the
    // same bare name via package-scoped resolution. A single package with
    // unique bare names must produce zero warnings (was 63 false positives
    // for hotcrm under the old over-broad rule).
    const issues = prefixIssues({
      manifest: { namespace: 'crm' },
      apps: [{ name: 'crm' }],
      pages: [{ name: 'home' }, { name: 'settings' }],
      dashboards: [{ name: 'overview' }],
      flows: [{ name: 'onboard' }],
      actions: [{ name: 'send' }],
      reports: [{ name: 'pipeline' }],
      datasets: [{ name: 'sales' }],
    });
    expect(issues).toHaveLength(0);
  });

  it('warns on an actual intra-package duplicate (type, name) pair', () => {
    const issues = prefixIssues({
      manifest: { namespace: 'crm' },
      pages: [{ name: 'home', label: 'Home' }, { name: 'home', label: 'Home 2' }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    // The warning points at the duplicate occurrence, not the first.
    expect(issues[0].path).toBe('pages[1].name');
    expect(issues[0].message).toContain('declared more than once');
    expect(issues[0].message).toContain('pages[0].name');
    expect(issues[0].message).toContain('ADR-0048');
    // Suggests a namespace-prefixed rename when a namespace is available.
    expect(issues[0].fix).toBe('crm_home');
  });

  it('does not claim the package will fail at install', () => {
    const issues = prefixIssues({
      manifest: { namespace: 'crm' },
      flows: [{ name: 'onboard' }, { name: 'onboard' }],
    });
    expect(issues).toHaveLength(1);
    // ADR-0048 §3.4 retired the per-item cross-package throw — the old
    // "collide on the registry key and fail at install" claim is false.
    expect(issues[0].message).not.toContain('fail at install');
    expect(issues[0].message).not.toContain('Two packages');
  });

  it('keeps the non-action wording verbatim — only actions got a calibrated remedy', () => {
    // #5510 rewrote the message assembly to branch on `actions`. The other six
    // types must be byte-identical to what they printed before, so this pins
    // the full sentence rather than a substring of it.
    const issues = prefixIssues({
      manifest: { namespace: 'crm' },
      pages: [{ name: 'home' }, { name: 'home' }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toBe(
      'Page "home" is declared more than once in this package (also at pages[0].name). ' +
        'Two items of the same type sharing a bare name within one package shadow each ' +
        'other on the registry key (ADR-0048 §3.4) — rename one, e.g. "crm_home". ' +
        'Distinct packages may reuse the same name freely; the namespace prefix is an ' +
        'optional convention, not a collision-avoidance requirement.',
    );
  });

  it('detects duplicates per type independently across every bare-named type', () => {
    const issues = prefixIssues({
      manifest: { namespace: 'crm' },
      apps: [{ name: 'a' }, { name: 'a' }],
      pages: [{ name: 'p' }, { name: 'p' }],
      dashboards: [{ name: 'd' }, { name: 'd' }],
      flows: [{ name: 'f' }, { name: 'f' }],
      actions: [{ name: 'ac' }, { name: 'ac' }],
      reports: [{ name: 'r' }, { name: 'r' }],
      datasets: [{ name: 'ds' }, { name: 'ds' }],
    });
    expect(issues).toHaveLength(7);
    expect(new Set(issues.map((i) => i.severity))).toEqual(new Set(['warning']));
  });

  it('treats the same name under different types as distinct (no false positive)', () => {
    // `page/home` and `flow/home` live under different registry collections —
    // they do not collide, so a shared name across types must not warn.
    expect(
      prefixIssues({
        manifest: { namespace: 'crm' },
        pages: [{ name: 'home' }],
        flows: [{ name: 'home' }],
      }),
    ).toHaveLength(0);
  });

  it('warns on duplicates even when no namespace is declared (omits the fix)', () => {
    // Duplicate names shadow each other regardless of namespace; without a
    // namespace there is no prefix to suggest, so no `fix` is offered.
    const issues = prefixIssues({
      pages: [{ name: 'home' }, { name: 'home' }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].fix).toBeUndefined();
    expect(issues[0].message).toContain('declared more than once');
  });

  it('does not touch objects (already prefix-enforced as an error) or views', () => {
    const issues = prefixIssues({
      manifest: { namespace: 'crm' },
      objects: [
        { name: 'lead', fields: { id: { type: 'text' } } },
        { name: 'lead', fields: { id: { type: 'text' } } },
      ],
      views: [{ name: 'lead.all' }, { name: 'lead.all' }],
    });
    expect(issues).toHaveLength(0);
  });
});

describe('lint — actions dedup on the composite engine key, not the bare name (#5510)', () => {
  // The engine registers an action under `<objectName>:<name>`
  // (`ObjectQLPlugin.actionObjectKey`; the runtime's
  // `standaloneActionObjectName` is kept in lockstep with it), with the
  // canonical object-less key `'global'` (#3913). Deduping on the bare name
  // asked a question the registry never asks.
  const ACTIVITY_ACTIONS = ['log_call', 'log_meeting', 'schedule_meeting'];
  const CRM_OBJECTS = ['crm_lead', 'crm_contact', 'crm_account', 'crm_opportunity', 'crm_case'];

  it('stays silent on the HotCRM shape: one same-named action per object', () => {
    // The reported regression, at full size: 5 objects × 3 activity actions =
    // 15 declarations occupying 15 distinct keys. rc.2 emitted 12 warnings
    // here (first of each name silent, every later one flagged) and its
    // "rename one" prescription would have broken the shared i18n keys the
    // #592 shape depends on.
    const actions = CRM_OBJECTS.flatMap((objectName) =>
      ACTIVITY_ACTIONS.map((name) => ({ name, objectName, label: name })),
    );
    expect(actions).toHaveLength(15);
    expect(prefixIssues({ manifest: { namespace: 'crm' }, actions })).toHaveLength(0);
  });

  it('still warns when two actions genuinely share one objectName', () => {
    const issues = prefixIssues({
      manifest: { namespace: 'crm' },
      actions: [
        { name: 'log_call', objectName: 'crm_lead' },
        { name: 'log_call', objectName: 'crm_contact' },
        { name: 'log_call', objectName: 'crm_lead' },
      ],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    // Points at the real duplicate (index 2) and back at the first declaration
    // that holds `crm_lead:log_call` (index 0) — never at the innocent
    // `crm_contact` row in between.
    expect(issues[0].path).toBe('actions[2].name');
    expect(issues[0].message).toContain('actions[0].name');
    expect(issues[0].message).not.toContain('actions[1].name');
  });

  it('still warns when two object-less actions share a name', () => {
    const issues = prefixIssues({
      manifest: { namespace: 'crm' },
      actions: [{ name: 'export_all' }, { name: 'export_all' }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('actions[1].name');
  });

  it('warns when an action on an object literally named `global` meets an object-less one', () => {
    // The object half falls back to the LITERAL `'global'` (#3913), not to an
    // inert sentinel — so these two really do collapse onto `global:sync` in
    // the engine's exact-string map, and the lint must say so. An `objectName
    // ?? ''` key would have missed this pair.
    const issues = prefixIssues({
      actions: [{ name: 'sync', objectName: 'global' }, { name: 'sync' }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('actions[1].name');
  });

  it('prescribes objectName separation first, not a bare rename', () => {
    const issues = prefixIssues({
      manifest: { namespace: 'crm' },
      actions: [
        { name: 'log_call', objectName: 'crm_lead' },
        { name: 'log_call', objectName: 'crm_lead' },
      ],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('distinct `objectName`');
    expect(issues[0].message).toContain('DIFFERENT objects');
    expect(issues[0].message).toContain('objectName:name');
    // Renaming stays on offer as the secondary remedy, with its suggestion.
    expect(issues[0].message).toContain('or rename one, e.g. "crm_log_call"');
    expect(issues[0].fix).toBe('crm_log_call');
  });

  it('holds through the real `os lint` seam (normalizeStackInput → lintConfig)', () => {
    // The unit cases above feed `lintConfig` a raw object; the command feeds it
    // a `normalizeStackInput` result. This pins that the normalization the
    // reported repro actually went through neither relocates the top-level
    // `actions` array (the warnings were reported at `actions[N].name`) nor
    // drops the `objectName` the dedup key now depends on.
    const actions = CRM_OBJECTS.flatMap((objectName) =>
      ACTIVITY_ACTIONS.map((name) => ({
        name,
        objectName,
        label: name,
        type: 'script' as const,
      })),
    );
    const normalized: any = normalizeStackInput({ manifest: { namespace: 'crm' }, actions } as any);
    expect(normalized.actions).toHaveLength(15);
    expect(normalized.actions[0].objectName).toBe('crm_lead');
    expect(prefixIssues(normalized)).toHaveLength(0);
  });

  it('reads only `objectName` — `object` is not an authoring surface at all', () => {
    // Guarding a KEY's reachability, so the instrument is the schema's own
    // verdict on the key: `ActionSchema` rejects `object` outright with a
    // rename prescription onto `objectName`. That is why the dedup key reads
    // `objectName` alone — a `?? item.object` chain here would only fossilize
    // a spelling the contract already refuses (Prime Directive #12).
    const parsed = ActionSchema.safeParse({
      name: 'log_call',
      label: 'Log call',
      type: 'script',
      object: 'crm_lead',
    });
    expect(parsed.success).toBe(false);
    const unrecognized = parsed.success
      ? []
      : parsed.error.issues.filter((i: any) => i.code === 'unrecognized_keys');
    expect(unrecognized).toHaveLength(1);
    expect((unrecognized[0] as any).keys).toEqual(['object']);
    expect(unrecognized[0].message).toContain('objectName');
  });

  it('does not leak the composite key into the other bare-named types', () => {
    // `objectName` is meaningless on a page/flow/report; carrying one must not
    // split their dedup. These stay bare-name duplicates and stay warned.
    const issues = prefixIssues({
      manifest: { namespace: 'crm' },
      pages: [
        { name: 'home', objectName: 'crm_lead' },
        { name: 'home', objectName: 'crm_contact' },
      ],
      flows: [
        { name: 'onboard', objectName: 'crm_lead' },
        { name: 'onboard', objectName: 'crm_contact' },
      ],
    });
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.path)).toEqual(['pages[1].name', 'flows[1].name']);
  });
});

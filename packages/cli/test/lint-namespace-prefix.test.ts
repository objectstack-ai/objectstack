// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { normalizeStackInput } from '@objectstack/spec';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { ActionSchema } from '@objectstack/spec/ui';
import { lintConfig, NAME_JUDGED_ELSEWHERE, PLATFORM_REQUESTED_BARE_NAMES } from '../src/commands/lint';

const RULE = 'naming/namespace-prefix';
const prefixIssues = (config: any) => lintConfig(config).filter((i) => i.rule === RULE);
// The rule raises two kinds of finding under one id. They are told apart by
// the subject of the sentence each one opens with, the only field that names
// the kind.
const bareIssues = (config: any) =>
  prefixIssues(config).filter((i) => i.message.includes('does not carry the package namespace'));
const dupIssues = (config: any) =>
  prefixIssues(config).filter((i) => i.message.includes('is declared more than once'));

/** Every manifest collection the rule judges: the spec's map less the documented exemptions. */
const JUDGED = Object.keys(PLURAL_TO_SINGULAR).filter(
  (key) => !Object.prototype.hasOwnProperty.call(NAME_JUDGED_ELSEWHERE, key),
);

describe('lint — every package-authored name carries the package namespace (ruling C, phase 2)', () => {
  it('judges every manifest collection the spec declares, less exactly three exemptions', () => {
    // ⛔ A loop over an empty list passes every assertion below, so the set it
    // runs over is pinned from both sides: the exemptions by name, the judged
    // set by a floor and by the types the decision's audit named.
    expect(Object.keys(NAME_JUDGED_ELSEWHERE).sort()).toEqual(['docs', 'objects', 'views']);
    for (const reason of Object.values(NAME_JUDGED_ELSEWHERE)) expect(reason.length).toBeGreaterThan(20);
    expect(JUDGED.length).toBeGreaterThanOrEqual(28);
    expect(JUDGED).toEqual(expect.arrayContaining([
      'apps', 'pages', 'dashboards', 'reports', 'datasets', 'actions', 'flows', 'jobs',
      'positions', 'permissions', 'capabilities', 'sharingRules', 'queues', 'assignmentRules',
      'apis', 'webhooks', 'agents', 'tools', 'skills', 'hooks', 'mappings', 'picklists',
      'analyticsCubes', 'connectors', 'datasources', 'emailTemplates', 'books',
    ]));
  });

  it.each(JUDGED)('warns on one bare `%s` name, with the prefixed rename as `fix`', (key) => {
    const issues = bareIssues({ manifest: { namespace: 'crm' }, [key]: [{ name: 'thing' }] });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].path).toBe(`${key}[0].name`);
    expect(issues[0].fix).toBe('crm_thing');
  });

  it('the message states the contract and the rename, and no longer calls the prefix optional', () => {
    const [issue] = prefixIssues({ manifest: { namespace: 'crm' }, flows: [{ name: 'onboard' }] });
    expect(issue.message).toContain('Flow "onboard"');
    expect(issue.message).toContain('"crm"');
    expect(issue.message).toContain('rename it to "crm_onboard"');
    expect(issue.message).not.toContain('optional convention');
  });

  it('stays a warning — the refusal is phase 3, not this rule', () => {
    const issues = prefixIssues({
      manifest: { namespace: 'crm' },
      flows: [{ name: 'onboard' }],
      pages: [{ name: 'home' }, { name: 'home' }],
    });
    expect(issues).toHaveLength(4);
    expect(new Set(issues.map((i) => i.severity))).toEqual(new Set(['warning']));
  });

  it('reads the namespace off the package — the real `os lint` seam keeps every collection', () => {
    // The command feeds `lintConfig` a `normalizeStackInput` result; the map
    // form must reach the rule as the same named items.
    const normalized: any = normalizeStackInput({
      manifest: { namespace: 'crm' },
      flows: { onboard: { label: 'Onboard' } },
      emailTemplates: [{ name: 'welcome' }],
    } as any);
    expect(bareIssues(normalized).map((i) => i.fix).sort()).toEqual(['crm_onboard', 'crm_welcome']);
  });

  describe('exemptions — each one silent on its own', () => {
    it('a name that already carries the prefix', () => {
      expect(prefixIssues({
        manifest: { namespace: 'crm' },
        apps: [{ name: 'crm_sales' }],
        flows: [{ name: 'crm_onboard' }],
        emailTemplates: [{ name: 'crm_welcome' }],
        permissions: [{ name: 'crm_sales_rep' }],
      })).toEqual([]);
    });

    it('a name that IS the namespace (the namespace-named app, ADR-0019)', () => {
      expect(prefixIssues({ manifest: { namespace: 'crm' }, apps: [{ name: 'crm' }] })).toEqual([]);
    });

    it('a platform-reserved `sys_` name, as the object rule exempts it', () => {
      expect(prefixIssues({ manifest: { namespace: 'crm' }, flows: [{ name: 'sys_cleanup' }] })).toEqual([]);
    });

    it('a dot-namespaced name, the capability shape (`billing.refund`)', () => {
      expect(prefixIssues({
        manifest: { namespace: 'crm' },
        capabilities: [{ name: 'crm.export_data' }],
      })).toEqual([]);
      // Its twin: a dotted name under ANOTHER namespace is still bare here.
      expect(bareIssues({
        manifest: { namespace: 'crm' },
        capabilities: [{ name: 'billing.refund' }],
      } as any).map((i) => i.fix)).toEqual(['crm_billing.refund']);
    });

    it('a name the platform requests by its bare spelling (`guest_portal`, the form doors\' permission set)', () => {
      expect(PLATFORM_REQUESTED_BARE_NAMES).toEqual({ permissions: ['guest_portal'] });
      expect(prefixIssues({
        manifest: { namespace: 'crm' },
        permissions: [{ name: 'guest_portal', objects: {} }],
      })).toEqual([]);
      // Its twins: the same spelling in ANOTHER collection, and a near-miss in
      // the same one, are still bare.
      expect(bareIssues({
        manifest: { namespace: 'crm' },
        flows: [{ name: 'guest_portal' }],
        permissions: [{ name: 'guest_portal_plus', objects: {} }],
      } as any).map((i) => i.fix).sort()).toEqual(['crm_guest_portal', 'crm_guest_portal_plus']);
    });

    it('objects — the object prefix is `defineStack`\'s error, not repeated here', () => {
      expect(prefixIssues({
        manifest: { namespace: 'crm' },
        objects: [{ name: 'lead', fields: { id: { type: 'text' } } }],
      })).toEqual([]);
    });

    it('fields — keyed inside their object, so derived from it', () => {
      expect(prefixIssues({
        manifest: { namespace: 'crm' },
        objects: [{ name: 'crm_lead', label: 'Lead', fields: { status: { type: 'text', label: 'Status' } } }],
      })).toEqual([]);
    });

    it('views — a container is named for its object, a view item is `<object>.<key>`', () => {
      expect(prefixIssues({
        manifest: { namespace: 'crm' },
        views: [
          { name: 'crm_lead', object: 'crm_lead', list: { columns: ['status'] } },
          { name: 'crm_lead.pipeline', object: 'crm_lead', viewKind: 'list', config: {} },
        ],
      })).toEqual([]);
    });

    it('object and picklist extensions — they name the item they extend', () => {
      expect(prefixIssues({
        manifest: { namespace: 'crm' },
        objectExtensions: [{ extend: 'sys_user', fields: { region: { type: 'text' } } }],
        picklistExtensions: [{ extend: 'industry', options: [{ value: 'space', label: 'Space' }] }],
      })).toEqual([]);
    });

    it('translations — a bundle has no name of its own (stored as `<ns>_<locale>`)', () => {
      expect(prefixIssues({
        manifest: { namespace: 'crm' },
        translations: [{ en: { objects: {} } }],
      })).toEqual([]);
    });

    it('docs — judged by the doc lint (`docs/namespace-prefix`), never twice', () => {
      expect(prefixIssues({ manifest: { namespace: 'crm' }, docs: [{ name: 'user_guide' }] })).toEqual([]);
    });

    it('functions — code handlers, not metadata items', () => {
      expect(prefixIssues({
        manifest: { namespace: 'crm' },
        functions: [{ name: 'syncBilling', handler: 'syncBilling' }],
      })).toEqual([]);
    });

    it('an override declaration (ADR-0146 D2) keeps the base package\'s name', () => {
      // It replaces the base package's item OF THE SAME NAME, so renaming it
      // would stop it overriding anything. Its twin without `overrides` warns.
      const overriding = { name: 'home', overrides: { package: 'com.acme.crm' } };
      expect(prefixIssues({ manifest: { namespace: 'acme' }, pages: [overriding] })).toEqual([]);
      expect(bareIssues({ manifest: { namespace: 'acme' }, pages: [{ name: 'home' }] })).toHaveLength(1);
    });

    it('a package that declares no namespace has nothing to prefix with', () => {
      expect(prefixIssues({ flows: [{ name: 'onboard' }], pages: [{ name: 'home' }] })).toEqual([]);
      expect(prefixIssues({ manifest: { id: 'com.acme.x' }, flows: [{ name: 'onboard' }] })).toEqual([]);
    });
  });
});

describe('lint — intra-package duplicate-name finding (ADR-0048 §3.4)', () => {
  it('warns on an actual intra-package duplicate (type, name) pair', () => {
    const issues = dupIssues({
      manifest: { namespace: 'crm' },
      pages: [{ name: 'home', label: 'Home' }, { name: 'home', label: 'Home 2' }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    // The warning points at the duplicate occurrence, not the first.
    expect(issues[0].path).toBe('pages[1].name');
    expect(issues[0].message).toContain('pages[0].name');
    expect(issues[0].message).toContain('ADR-0048');
  });

  it('a prefixed name declared twice is still a duplicate, and draws no bare-name finding', () => {
    const issues = prefixIssues({
      manifest: { namespace: 'crm' },
      pages: [{ name: 'crm_home' }, { name: 'crm_home' }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('pages[1].name');
    expect(issues[0].message).toContain('is declared more than once');
  });

  it('a bare duplicate: both items get the rename, the duplicate asks for a distinct name', () => {
    // Two items both renamed to one suggestion would still be a duplicate, so
    // the duplicate finding carries no `fix` of its own.
    const config = { manifest: { namespace: 'crm' }, pages: [{ name: 'home' }, { name: 'home' }] };
    expect(bareIssues(config).map((i) => [i.path, i.fix])).toEqual([
      ['pages[0].name', 'crm_home'],
      ['pages[1].name', 'crm_home'],
    ]);
    const [dup] = dupIssues(config);
    expect(dup.fix).toBeUndefined();
    expect(dup.message).not.toContain('crm_home');
  });

  it('does not claim the package will fail at install', () => {
    const issues = dupIssues({
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
    // types share one sentence, so this pins the full sentence rather than a
    // substring of it.
    const issues = dupIssues({
      manifest: { namespace: 'crm' },
      pages: [{ name: 'crm_home' }, { name: 'crm_home' }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toBe(
      'Page "crm_home" is declared more than once in this package (also at pages[0].name). ' +
        'Two items of the same type sharing a name within one package shadow each ' +
        'other on the registry key (ADR-0048 §3.4) — rename one.',
    );
  });

  it('detects duplicates per type independently across every duplicate-keyed type', () => {
    const config = {
      manifest: { namespace: 'crm' },
      apps: [{ name: 'a' }, { name: 'a' }],
      pages: [{ name: 'p' }, { name: 'p' }],
      dashboards: [{ name: 'd' }, { name: 'd' }],
      flows: [{ name: 'f' }, { name: 'f' }],
      actions: [{ name: 'ac' }, { name: 'ac' }],
      reports: [{ name: 'r' }, { name: 'r' }],
      datasets: [{ name: 'ds' }, { name: 'ds' }],
    };
    expect(dupIssues(config)).toHaveLength(7);
    expect(bareIssues(config)).toHaveLength(14);
    expect(new Set(prefixIssues(config).map((i) => i.severity))).toEqual(new Set(['warning']));
  });

  it('treats the same name under different types as distinct (no false positive)', () => {
    // `page/home` and `flow/home` live under different registry collections —
    // they do not collide, so a shared name across types is no duplicate.
    expect(
      dupIssues({
        manifest: { namespace: 'crm' },
        pages: [{ name: 'home' }],
        flows: [{ name: 'home' }],
      }),
    ).toHaveLength(0);
  });

  it('warns on duplicates even when no namespace is declared (and offers no fix)', () => {
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
  // (`standaloneActionOwnerKey` in `@objectstack/objectql`, which the ObjectQL
  // plugin calls directly and the runtime's `standaloneActionObjectName` now
  // delegates to), with the canonical object-less key `'global'`
  // (`GLOBAL_ACTION_OBJECT_KEY`, #3913). Deduping on the bare name asked a
  // question the registry never asks.
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
    expect(dupIssues({ manifest: { namespace: 'crm' }, actions })).toHaveLength(0);
    // The names are bare, though: under the namespace contract each one owes
    // the prefix, and the rename keeps the shared name across the objects.
    const bare = bareIssues({ manifest: { namespace: 'crm' }, actions });
    expect(bare).toHaveLength(15);
    expect(new Set(bare.map((i) => i.fix))).toEqual(
      new Set(['crm_log_call', 'crm_log_meeting', 'crm_schedule_meeting']),
    );
  });

  it('still warns when two actions genuinely share one objectName', () => {
    const issues = dupIssues({
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
    const issues = dupIssues({
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
    const issues = dupIssues({
      actions: [{ name: 'sync', objectName: 'global' }, { name: 'sync' }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('actions[1].name');
  });

  it('prescribes objectName separation first, not a bare rename', () => {
    const config = {
      manifest: { namespace: 'crm' },
      actions: [
        { name: 'log_call', objectName: 'crm_lead' },
        { name: 'log_call', objectName: 'crm_lead' },
      ],
    };
    const issues = dupIssues(config);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('distinct `objectName`');
    expect(issues[0].message).toContain('DIFFERENT objects');
    expect(issues[0].message).toContain('objectName:name');
    // Renaming stays on offer as the secondary remedy; the prefixed spelling
    // is the bare-name finding's `fix`, on each of the two items.
    expect(issues[0].message).toContain('or rename one');
    expect(issues[0].fix).toBeUndefined();
    expect(bareIssues(config).map((i) => i.fix)).toEqual(['crm_log_call', 'crm_log_call']);
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
    expect(dupIssues(normalized)).toHaveLength(0);
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
    // split their dedup. These stay duplicates and stay warned.
    const issues = dupIssues({
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

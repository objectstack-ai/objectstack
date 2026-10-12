// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateNavAccess as validateNavAccessUnrecorded,
  NAV_OBJECT_UNGRANTED,
} from './validate-nav-access.js';
import { NAV_OBJECT_UNSERVABLE } from './validate-nav-object-servability.js';
import { explainRule } from './rule-explanations.js';

// [#22161] Each finding is one verdict sentence; the reasoning it used to
// carry is `os explain nav-object-ungranted`. Every direct call below records
// what it fired, and the last cases in this file hold each recorded verdict to
// one line of at most 200 characters — every firing variant this suite
// exercises, not a chosen few. Run the whole file: those cases read what the
// cases above fired.
const fired: Array<{ rule: string; message: string; hint: string }> = [];
const validateNavAccess: typeof validateNavAccessUnrecorded = (...args) => {
  const findings = validateNavAccessUnrecorded(...args);
  fired.push(...findings);
  return findings;
};

const objects = [
  { name: 'crm_lead', fields: { name: { type: 'text' } } },
  { name: 'crm_forecast', fields: { name: { type: 'text' } } },
];

const navApp = (items: unknown[]) => [{ name: 'crm', label: 'CRM', navigation: items }];

const objectNav = (id: string, objectName: string) => ({
  id,
  type: 'object',
  label: objectName,
  objectName,
});

describe('validateNavAccess', () => {
  // The HotCRM instance: an object in the menu that no set grants.
  it('warns on a nav-exposed object no permission set grants read on', () => {
    const findings = validateNavAccess({
      objects,
      apps: navApp([objectNav('nav_leads', 'crm_lead'), objectNav('nav_forecast', 'crm_forecast')]),
      permissions: [
        { name: 'crm_user', label: 'CRM User', objects: { crm_lead: { allowRead: true } } },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].rule).toBe(NAV_OBJECT_UNGRANTED);
    expect(findings[0].path).toBe('apps[0].navigation[1].objectName');
    expect(findings[0].message).toContain('crm_forecast');
  });

  // The platform's own `admin_full_access` uses this shape; a stack may too.
  // Without wildcard support the matrix records the literal key `*` and the
  // rule would fire on exactly the stacks that granted the most.
  it('accepts a wildcard read grant as covering every object', () => {
    const findings = validateNavAccess({
      objects,
      apps: navApp([objectNav('nav_forecast', 'crm_forecast')]),
      permissions: [
        { name: 'full', label: 'Full', objects: { '*': { allowRead: true, viewAllRecords: true } } },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('accepts read granted through viewAllRecords or modifyAllRecords', () => {
    for (const bit of ['viewAllRecords', 'modifyAllRecords']) {
      const findings = validateNavAccess({
        objects,
        apps: navApp([objectNav('nav_forecast', 'crm_forecast')]),
        permissions: [
          { name: 'admin', label: 'Admin', objects: { crm_forecast: { [bit]: true } } },
        ],
      });
      expect(findings, `${bit} should grant read`).toEqual([]);
    }
  });

  it('does not treat a write-only grant as read', () => {
    const findings = validateNavAccess({
      objects,
      apps: navApp([objectNav('nav_forecast', 'crm_forecast')]),
      permissions: [
        { name: 'writer', label: 'Writer', objects: { crm_forecast: { allowCreate: true, allowEdit: true } } },
      ],
    });
    expect(findings).toHaveLength(1);
  });

  it('reports an object once even when several nav entries expose it', () => {
    const findings = validateNavAccess({
      objects,
      apps: [
        {
          name: 'crm',
          navigation: [objectNav('nav_a', 'crm_forecast')],
          areas: [{ id: 'area', label: 'Area', navigation: [objectNav('nav_b', 'crm_forecast')] }],
        },
      ],
      permissions: [{ name: 'p', label: 'P', objects: { crm_lead: { allowRead: true } } }],
    });
    expect(findings).toHaveLength(1);
  });

  it('walks area navigation and nested children', () => {
    const findings = validateNavAccess({
      objects,
      apps: [
        {
          name: 'crm',
          areas: [
            {
              id: 'area_sales',
              label: 'Sales',
              navigation: [
                {
                  id: 'grp',
                  type: 'group',
                  label: 'Group',
                  children: [objectNav('nav_forecast', 'crm_forecast')],
                },
              ],
            },
          ],
        },
      ],
      permissions: [{ name: 'p', label: 'P', objects: { crm_lead: { allowRead: true } } }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('apps[0].areas[0].navigation[0].children[0].objectName');
  });
});

describe('validateNavAccess — exemptions (false-positive floor)', () => {
  it('skips platform-provided objects — their own packages grant them', () => {
    const findings = validateNavAccess({
      objects,
      apps: navApp([
        objectNav('nav_users', 'sys_user'),
        objectNav('nav_approvals', 'sys_approval_request'),
      ]),
      permissions: [{ name: 'p', label: 'P', objects: { crm_lead: { allowRead: true } } }],
    });
    expect(findings).toEqual([]);
  });

  it('skips a stack that declares no permission sets at all', () => {
    const findings = validateNavAccess({
      objects,
      apps: navApp([objectNav('nav_forecast', 'crm_forecast')]),
    });
    expect(findings).toEqual([]);
  });

  it('skips an object this stack does not define', () => {
    // A dangling nav target is `validate-object-references`' finding, not this
    // rule's — reporting it here would double-report one mistake.
    const findings = validateNavAccess({
      objects,
      apps: navApp([objectNav('nav_ghost', 'crm_ghost')]),
      permissions: [{ name: 'p', label: 'P', objects: { crm_lead: { allowRead: true } } }],
    });
    expect(findings).toEqual([]);
  });

  it('ignores non-object nav entries', () => {
    const findings = validateNavAccess({
      objects,
      apps: navApp([
        { id: 'nav_dash', type: 'dashboard', label: 'D', dashboardName: 'd' },
        { id: 'nav_url', type: 'url', label: 'U', url: '/x' },
        { id: 'nav_sep', type: 'separator' },
      ]),
      permissions: [{ name: 'p', label: 'P', objects: { crm_lead: { allowRead: true } } }],
    });
    expect(findings).toEqual([]);
  });

  it('is silent when every exposed object is granted, and tolerates empty input', () => {
    const findings = validateNavAccess({
      objects,
      apps: navApp([objectNav('nav_leads', 'crm_lead'), objectNav('nav_forecast', 'crm_forecast')]),
      permissions: [
        {
          name: 'p',
          label: 'P',
          objects: { crm_lead: { allowRead: true }, crm_forecast: { allowRead: true } },
        },
      ],
    });
    expect(findings).toEqual([]);
    expect(validateNavAccess({})).toEqual([]);
    expect(validateNavAccess(null as unknown as Record<string, unknown>)).toEqual([]);
  });

  it('accepts a grant coming from any one of several sets', () => {
    const findings = validateNavAccess({
      objects,
      apps: navApp([objectNav('nav_forecast', 'crm_forecast')]),
      permissions: [
        { name: 'a', label: 'A', objects: { crm_lead: { allowRead: true } } },
        { name: 'b', label: 'B', objects: { crm_forecast: { allowRead: true } } },
      ],
    });
    expect(findings).toEqual([]);
  });
});

// #16065: the hint used to prescribe a third remedy — "gate the entry with
// requiredPermissions/visible" — that this rule cannot honour: neither key is
// read anywhere in this file, so a gated-but-ungranted entry kept warning
// forever. The fix corrects the hint (and the doc-block) to the two remedies
// the rule can actually prove; it does NOT make the rule start reading those
// keys. These controls pin that: gating must not silence a genuinely
// ungranted object, and must not spuriously flag a genuinely granted one.
describe('validateNavAccess — gating keys are not read (#16065)', () => {
  it('hint prescribes only the two remedies it can prove, not gating', () => {
    const findings = validateNavAccess({
      objects,
      apps: navApp([objectNav('nav_forecast', 'crm_forecast')]),
      permissions: [{ name: 'p', label: 'P', objects: { crm_lead: { allowRead: true } } }],
    });
    expect(findings).toHaveLength(1);
    const { hint } = findings[0];
    // The two remedies the rule can prove.
    expect(hint).toContain('allowRead: true');
    expect(hint).toContain('viewAllRecords');
    // The retired third remedy must not return.
    expect(hint).not.toContain('gate the entry');
    expect(hint).not.toMatch(/requiredPermissions.*if it is meant for admins only/);
  });

  it('a requiredPermissions-gated but ungranted object still fires (gating is not a remedy)', () => {
    const findings = validateNavAccess({
      objects,
      apps: navApp([
        { ...objectNav('nav_forecast', 'crm_forecast'), requiredPermissions: ['view_forecast'] },
      ]),
      permissions: [{ name: 'p', label: 'P', objects: { crm_lead: { allowRead: true } } }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(NAV_OBJECT_UNGRANTED);
  });

  it('a visible:false but ungranted object still fires (gating is not a remedy)', () => {
    const findings = validateNavAccess({
      objects,
      apps: navApp([{ ...objectNav('nav_forecast', 'crm_forecast'), visible: false }]),
      permissions: [{ name: 'p', label: 'P', objects: { crm_lead: { allowRead: true } } }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(NAV_OBJECT_UNGRANTED);
  });

  it('a gated AND granted object stays silent — gating causes no false positive either', () => {
    const findings = validateNavAccess({
      objects,
      apps: navApp([
        { ...objectNav('nav_forecast', 'crm_forecast'), requiredPermissions: ['view_forecast'] },
      ]),
      permissions: [{ name: 'p', label: 'P', objects: { crm_forecast: { allowRead: true } } }],
    });
    expect(findings).toEqual([]);
  });
});

describe('[#22161] one-line verdicts — nav-object-ungranted', () => {
  it('reads as one sentence', () => {
    const findings = validateNavAccess({
      objects,
      apps: navApp([objectNav('nav_forecast', 'crm_forecast')]),
      permissions: [{ name: 'p', label: 'P', objects: { crm_lead: { allowRead: true } } }],
    });
    expect(findings.map((f) => f.message)).toEqual([
      'navigation exposes object "crm_forecast", but no permission set this stack declares grants read on '
        + 'it, so opening the entry fails permission-denied for everyone but a wildcard admin',
    ]);
  });

  it('`os explain` carries what the verdict no longer says', () => {
    const entry = explainRule(NAV_OBJECT_UNGRANTED);
    expect(entry, 'no `os explain nav-object-ungranted` entry').toBeDefined();
    const text = entry!.paragraphs.join('\n');
    for (const fact of [
      'works when you browse as an administrator',
      'ADR-0090 D6',
      'wildcard grant',
      'reported once',
      '`requiredPermissions` or `visible`',
      'another installed package',
      'platform-provided object',
      'declares no permission sets',
    ]) {
      expect(text, `explanation names ${fact}`).toContain(fact);
    }
    // The independent-conditions paragraph is one text under both object-entry ids.
    const shared = (rule: string) => explainRule(rule)!.paragraphs.find((p) => p.includes('independent conditions'));
    expect(shared(NAV_OBJECT_UNGRANTED)).toBeDefined();
    expect(shared(NAV_OBJECT_UNGRANTED)).toBe(shared(NAV_OBJECT_UNSERVABLE));
  });

  it('the read bits the explanation names are the ones the rule folds', () => {
    // The explanation module imports nothing, so its list is held to the rule
    // by running the rule: each bit it names grants read and silences it.
    const text = explainRule(NAV_OBJECT_UNGRANTED)!.paragraphs.join('\n');
    for (const bit of ['allowRead', 'viewAllRecords', 'modifyAllRecords']) {
      expect(text, bit).toContain(`\`${bit}\``);
      expect(validateNavAccessUnrecorded({
        objects,
        apps: navApp([objectNav('nav_forecast', 'crm_forecast')]),
        permissions: [{ name: 'p', label: 'P', objects: { crm_forecast: { [bit]: true } } }],
      }), bit).toEqual([]);
    }
  });

  it('every verdict the cases in this file fired is one line of at most 200 characters', () => {
    const converted = fired.filter((f) => f.rule === NAV_OBJECT_UNGRANTED);
    // The coverage control first: the id fired, at the top level and nested.
    expect(converted.length).toBeGreaterThan(0);
    for (const f of converted) {
      expect(f.message, f.rule).not.toContain('\n');
      expect(f.message.length, `${f.rule}: ${f.message}`).toBeLessThanOrEqual(200);
    }
  });
});

// [#22161] Slice 14: the `fix:` line names the grant or the removal in one line;
// that gating the entry does not clear it, and that a grant from another
// installed package makes it moot, are the explanation's (pinned above).
describe('[#22161] one-line fix — nav-object-ungranted', () => {
  it('every `fix:` line the cases in this file fired is one line of at most 200 characters', () => {
    const converted = fired.filter((f) => f.rule === NAV_OBJECT_UNGRANTED);
    // Coverage control: the id fired.
    expect(converted.length).toBeGreaterThan(0);
    for (const f of converted) {
      expect(f.hint, f.rule).not.toContain('\n');
      expect(f.hint.length, `${f.rule}: ${f.hint}`).toBeLessThanOrEqual(200);
      expect(f.hint).toMatch(/^Add ".+" to a permission set's `objects` with `allowRead: true` \(or `viewAllRecords`\), or drop the entry$/);
    }
  });
});

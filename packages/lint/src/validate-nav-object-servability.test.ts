// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateNavObjectServability as validateNavObjectServabilityUnrecorded,
  NAV_OBJECT_UNSERVABLE,
} from './validate-nav-object-servability.js';
import { NAV_OBJECT_UNGRANTED } from './validate-nav-access.js';
import { explainRule } from './rule-explanations.js';

// [#22161] Each finding is one verdict sentence; the reasoning it used to
// carry is `os explain nav-object-unservable`. Every direct call below records
// what it fired, and the last cases in this file hold each recorded verdict to
// one line of at most 200 characters — every firing variant this suite
// exercises, not a chosen few. Run the whole file: those cases read what the
// cases above fired. Before this file the rule's only pin was the suite's
// "every member actually runs" case in `reference-integrity-suite.test.ts`.
const fired: Array<{ rule: string; message: string }> = [];
const validateNavObjectServability: typeof validateNavObjectServabilityUnrecorded = (...args) => {
  const findings = validateNavObjectServabilityUnrecorded(...args);
  fired.push(...findings);
  return findings;
};

const objects = [
  { name: 'crm_lead', fields: { name: { type: 'text' } } },
  { name: 'crm_secret_token', enable: { apiEnabled: false }, fields: { name: { type: 'text' } } },
  { name: 'crm_audit_row', enable: { apiMethods: ['get', 'create'] }, fields: { name: { type: 'text' } } },
  { name: 'crm_sealed', enable: { apiMethods: [] }, fields: { name: { type: 'text' } } },
];

const objectNav = (id: string, objectName: string) => ({ id, type: 'object', label: objectName, objectName });

const stackWith = (app: Record<string, unknown>) => ({ objects, apps: [{ name: 'crm', ...app }] });

describe('validateNavObjectServability', () => {
  it('refuses an entry whose object is API-disabled, naming the `enable` key', () => {
    const findings = validateNavObjectServability(
      stackWith({ navigation: [objectNav('nav_tokens', 'crm_secret_token')] }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: NAV_OBJECT_UNSERVABLE,
      where: 'app "crm" · nav "nav_tokens"',
      path: 'apps[0].navigation[0].objectName',
    });
    expect(findings[0].message).toContain('`objects[1].enable.apiEnabled` is false');
    expect(findings[0].message).toContain('404');
  });

  it('refuses an entry whose object whitelists methods without `list`, an empty whitelist included', () => {
    const findings = validateNavObjectServability(
      stackWith({ navigation: [objectNav('nav_audit', 'crm_audit_row'), objectNav('nav_sealed', 'crm_sealed')] }),
    );
    expect(findings.map((f) => f.path)).toEqual([
      'apps[0].navigation[0].objectName',
      'apps[0].navigation[1].objectName',
    ]);
    expect(findings[0].message).toContain('`objects[2].enable.apiMethods` lacks `list`');
    expect(findings[1].message).toContain('`objects[3].enable.apiMethods` lacks `list`');
    for (const f of findings) expect(f.message).toContain('405');
  });

  it('walks each area\'s `items` and `navigation`, and nested `children`', () => {
    const findings = validateNavObjectServability(stackWith({
      navigation: [{ id: 'grp', type: 'group', label: 'Group', children: [objectNav('nav_a', 'crm_secret_token')] }],
      areas: [{
        id: 'area',
        label: 'Area',
        items: [objectNav('nav_b', 'crm_secret_token')],
        navigation: [objectNav('nav_c', 'crm_secret_token')],
      }],
    }));
    expect(findings.map((f) => f.path)).toEqual([
      'apps[0].navigation[0].children[0].objectName',
      'apps[0].areas[0].items[0].objectName',
      'apps[0].areas[0].navigation[0].objectName',
    ]);
  });

  it('is silent on a listable object, an object this stack does not declare, an interpolated target and a non-object entry', () => {
    expect(validateNavObjectServability(stackWith({
      navigation: [
        objectNav('nav_leads', 'crm_lead'),
        objectNav('nav_users', 'sys_user'),
        objectNav('nav_dyn', '${objectName}'),
        { id: 'nav_page', type: 'page', label: 'Page', pageName: 'crm_secret_token' },
      ],
    }))).toEqual([]);
  });
});

describe('[#22161] one-line verdicts — nav-object-unservable', () => {
  it('reads as one sentence per arm', () => {
    const findings = validateNavObjectServability(
      stackWith({ navigation: [objectNav('nav_tokens', 'crm_secret_token'), objectNav('nav_audit', 'crm_audit_row')] }),
    );
    expect(findings.map((f) => f.message)).toEqual([
      'Navigation targets object "crm_secret_token", which cannot serve a list (`objects[1].enable.apiEnabled` '
        + 'is false), so the server prunes the entry: its list answers 404 for every user',
      'Navigation targets object "crm_audit_row", which cannot serve a list (`objects[2].enable.apiMethods` '
        + 'lacks `list`), so the server prunes the entry: its list answers 405 for every user',
    ]);
  });

  it('`os explain` carries what the verdict no longer says', () => {
    const entry = explainRule(NAV_OBJECT_UNSERVABLE);
    expect(entry, 'no `os explain nav-object-unservable` entry').toBeDefined();
    const text = entry!.paragraphs.join('\n');
    for (const fact of [
      '404 `OBJECT_API_DISABLED`',
      '405 `OBJECT_API_METHOD_NOT_ALLOWED`',
      'an empty one denies everything',
      '`canServeApiOperation`',
      'platform administrators included',
      'served `/meta` payload',
      'credential material',
      '`requiredPermissions` or `visible`',
      'interpolated target',
    ]) {
      expect(text, `explanation names ${fact}`).toContain(fact);
    }
    // The walked containers are the ones the rule walks (the case above).
    expect(text).toContain('each app\'s `navigation` and each area\'s `items` and `navigation`, nested `children`');
    // The independent-conditions paragraph is one text under both object-entry ids.
    const shared = (rule: string) => explainRule(rule)!.paragraphs.find((p) => p.includes('independent conditions'));
    expect(shared(NAV_OBJECT_UNSERVABLE)).toBeDefined();
    expect(shared(NAV_OBJECT_UNSERVABLE)).toBe(shared(NAV_OBJECT_UNGRANTED));
  });

  it('every verdict the cases in this file fired is one line of at most 200 characters', () => {
    const converted = fired.filter((f) => f.rule === NAV_OBJECT_UNSERVABLE);
    // The coverage control first: both arms fired.
    expect(converted.some((f) => f.message.includes('is false'))).toBe(true);
    expect(converted.some((f) => f.message.includes('lacks `list`'))).toBe(true);
    for (const f of converted) {
      expect(f.message, f.rule).not.toContain('\n');
      expect(f.message.length, `${f.rule}: ${f.message}`).toBeLessThanOrEqual(200);
    }
  });
});

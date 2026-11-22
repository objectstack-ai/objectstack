// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `validate-record-page-header.ts`: a full record page's hand-written header
 * whose title or action order differs from what the standard page draws for
 * the same record. The lead fixture is the shape that shipped in a released
 * app (a `{full_name}` title over a `display_title` name field, and an action
 * list with no `order` on any action), and its aligned twin is the shape that
 * app moved to.
 */

import { describe, it, expect } from 'vitest';
import { RuntimeAuthoringIssueSchema } from '@objectstack/spec/api';
import { PLATFORM_LOCALE_TAGS } from '@objectstack/spec/system';
import {
  RECORD_PAGE_HEADER_ACTIONS_DIFFER,
  RECORD_PAGE_HEADER_TITLE_DIFFERS,
  validateRecordPageHeader,
} from './validate-record-page-header.js';
import { RECORD_PAGE_HEADER_USER_TEXT } from './validate-record-page-header.user-text.js';
import { FINDING_USER_TEXT_CATALOG, findingUserMessage } from './finding-user-text.js';
import { AUTHORING_RULES } from './authoring-rules.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';

type AnyRec = Record<string, unknown>;

const LEAD = {
  name: 'crm_lead',
  nameField: 'display_title',
  fields: {
    display_title: { type: 'text' },
    full_name: { type: 'text' },
    company: { type: 'text' },
  },
};

/** The lead's actions in source order, none declaring `order` or a variant. */
const leadActions = (): AnyRec[] => [
  { name: 'convert_lead', objectName: 'crm_lead', type: 'script', locations: ['record_header'] },
  { name: 'qualify_lead', objectName: 'crm_lead', type: 'script', locations: ['record_header'] },
  { name: 'schedule_followup', objectName: 'crm_lead', type: 'script', locations: ['record_header'] },
];

const header = (properties: AnyRec): AnyRec => ({ type: 'page:header', properties });

const leadPage = (headerProps: AnyRec, extra: AnyRec = {}): AnyRec => ({
  name: 'lead_detail',
  type: 'record',
  object: 'crm_lead',
  kind: 'full',
  regions: [{ name: 'header', components: [header(headerProps)] }],
  ...extra,
});

const stackOf = (page: AnyRec, actions: AnyRec[] = leadActions(), objects: AnyRec[] = [LEAD]): AnyRec => ({
  objects,
  actions,
  pages: [page],
});

const LISTED = ['qualify_lead', 'convert_lead', 'schedule_followup'];

describe('validateRecordPageHeader · the title', () => {
  it('warns on a title other than the name field, at the title key', () => {
    const findings = validateRecordPageHeader(stackOf(leadPage({ title: '{full_name}' })));
    const title = findings.filter((f) => f.rule === RECORD_PAGE_HEADER_TITLE_DIFFERS);
    expect(title).toHaveLength(1);
    expect(title[0]).toMatchObject({
      severity: 'warning',
      where: 'page "lead_detail"',
      path: 'pages[0].regions[0].components[0].properties.title',
      userTextParams: { page: 'lead_detail', object: 'crm_lead', field: 'display_title' },
    });
  });

  it('is quiet when the title is omitted, or is exactly the name field token', () => {
    expect(validateRecordPageHeader(stackOf(leadPage({})))).toEqual([]);
    expect(validateRecordPageHeader(stackOf(leadPage({ title: ' {display_title} ' })))).toEqual([]);
  });

  it('reads the derived title field when the object names none', () => {
    const derived = { name: 'crm_lead', fields: { name: { type: 'text' }, full_name: { type: 'text' } } };
    const stack = stackOf(leadPage({ title: '{name}' }), [], [derived]);
    expect(validateRecordPageHeader(stack)).toEqual([]);
    const differs = stackOf(leadPage({ title: '{full_name}' }), [], [derived]);
    expect(validateRecordPageHeader(differs).map((f) => f.userTextParams.field)).toEqual(['name']);
  });

  it('judges every locale of an inline locale map', () => {
    const same = stackOf(leadPage({ title: { en: '{display_title}', 'zh-CN': '{display_title}' } }));
    expect(validateRecordPageHeader(same)).toEqual([]);
    const oneDiffers = stackOf(leadPage({ title: { en: '{display_title}', 'zh-CN': '线索 {full_name}' } }));
    expect(validateRecordPageHeader(oneDiffers).map((f) => f.rule)).toEqual([RECORD_PAGE_HEADER_TITLE_DIFFERS]);
  });

  it('finds a header nested inside a container', () => {
    const page = leadPage({});
    page.regions = [{
      name: 'main',
      components: [{ type: 'page:section', properties: { children: [header({ title: 'Lead' })] } }],
    }];
    const findings = validateRecordPageHeader(stackOf(page));
    expect(findings.map((f) => f.path)).toEqual([
      'pages[0].regions[0].components[0].properties.children[0].properties.title',
    ]);
  });
});

describe('validateRecordPageHeader · the actions', () => {
  it('warns when the list makes a different action the primary button than the standard page does', () => {
    const findings = validateRecordPageHeader(stackOf(leadPage({ actions: LISTED })));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'warning',
      rule: RECORD_PAGE_HEADER_ACTIONS_DIFFER,
      path: 'pages[0].regions[0].components[0].properties.actions',
      userTextParams: { page: 'lead_detail', object: 'crm_lead' },
    });
    expect(findings[0].message).toContain('primary button is "qualify_lead"');
    expect(findings[0].message).toContain('draw "convert_lead"');
  });

  it('is quiet once the actions declare their order, whatever order the list names them in', () => {
    const ordered = leadActions();
    ordered[1].order = -3; // qualify_lead
    ordered[0].order = -2; // convert_lead
    ordered[2].order = -1; // schedule_followup
    expect(validateRecordPageHeader(stackOf(leadPage({ actions: LISTED }), ordered))).toEqual([]);
    const shuffled = ['schedule_followup', 'convert_lead', 'qualify_lead'];
    expect(validateRecordPageHeader(stackOf(leadPage({ actions: shuffled }), ordered))).toEqual([]);
  });

  it('is quiet when the list already follows the declaration order', () => {
    const list = ['convert_lead', 'qualify_lead', 'schedule_followup'];
    expect(validateRecordPageHeader(stackOf(leadPage({ actions: list })))).toEqual([]);
  });

  it('honours variant primary on both pages', () => {
    const actions = leadActions();
    actions[1].variant = 'primary'; // qualify_lead
    const list = ['qualify_lead', 'convert_lead', 'schedule_followup'];
    expect(validateRecordPageHeader(stackOf(leadPage({ actions: list }), actions))).toEqual([]);
  });

  it('names an order difference among the other actions when the primary agrees', () => {
    const list = ['convert_lead', 'schedule_followup', 'qualify_lead'];
    const findings = validateRecordPageHeader(stackOf(leadPage({ actions: list })));
    expect(findings.map((f) => f.rule)).toEqual([RECORD_PAGE_HEADER_ACTIONS_DIFFER]);
    expect(findings[0].message).toContain(
      'orders them "convert_lead", "schedule_followup", "qualify_lead" while the phone and the side drawer order them "convert_lead", "qualify_lead", "schedule_followup"',
    );
  });

  it('counts an unlisted placed action that leads the standard page', () => {
    const actions = [{ name: 'log_call', objectName: 'crm_lead', locations: ['record_header'], order: -5 }, ...leadActions()];
    const list = ['convert_lead', 'qualify_lead', 'schedule_followup'];
    const findings = validateRecordPageHeader(stackOf(leadPage({ actions: list }), actions));
    expect(findings.map((f) => f.rule)).toEqual([RECORD_PAGE_HEADER_ACTIONS_DIFFER]);
    expect(findings[0].message).toContain('draw "log_call"');
  });

  it('reads the object\'s own actions ahead of the stack\'s bound ones', () => {
    const lead = { ...LEAD, actions: [{ name: 'qualify_lead', locations: ['record_header'] }] };
    const stack = stackOf(leadPage({ actions: LISTED }), leadActions().slice(0, 1).concat(leadActions().slice(2)), [lead]);
    expect(validateRecordPageHeader(stack)).toEqual([]);
  });

  it('skips a destructive or menu-only action when picking the primary, as the renderer does', () => {
    const actions = leadActions();
    actions[0].variant = 'danger'; // convert_lead never draws as the primary
    expect(validateRecordPageHeader(stackOf(leadPage({ actions: LISTED }), actions))).toEqual([]);
  });

  it('judges no list naming an action the stack does not declare on the object', () => {
    const list = ['qualify_lead', 'convert_lead', 'ghost_action'];
    expect(validateRecordPageHeader(stackOf(leadPage({ actions: list })))).toEqual([]);
  });

  it('judges no placedActions header and no empty list', () => {
    expect(validateRecordPageHeader(stackOf(leadPage({ placedActions: true })))).toEqual([]);
    expect(validateRecordPageHeader(stackOf(leadPage({ actions: [] })))).toEqual([]);
  });
});

describe('validateRecordPageHeader · the pages it does not judge', () => {
  const disagreeing = { title: '{full_name}', actions: LISTED };

  it('reports both findings on the shipped lead shape, and only warnings', () => {
    const findings = validateRecordPageHeader(stackOf(leadPage(disagreeing)));
    expect(findings.map((f) => f.rule)).toEqual([RECORD_PAGE_HEADER_TITLE_DIFFERS, RECORD_PAGE_HEADER_ACTIONS_DIFFER]);
    expect(findings.every((f) => f.severity === 'warning')).toBe(true);
  });

  it('judges a record page that omits type and kind (both default to a full record page)', () => {
    const page = leadPage(disagreeing);
    delete page.type;
    delete page.kind;
    expect(validateRecordPageHeader(stackOf(page))).toHaveLength(2);
  });

  it('skips slotted, print, html and non-record pages, and pages bound to no declared object', () => {
    const slotted = { name: 'lead_slotted', object: 'crm_lead', kind: 'slotted', slots: { header: header(disagreeing) } };
    const print = leadPage(disagreeing, { print: { paperSize: 'A4' } });
    const home = leadPage(disagreeing, { type: 'home' });
    const html = leadPage(disagreeing, { kind: 'html', source: '<div />' });
    const unbound = leadPage(disagreeing, { object: undefined });
    const foreign = leadPage(disagreeing, { object: 'crm_account' });
    for (const page of [slotted, print, home, html, unbound, foreign]) {
      expect(validateRecordPageHeader(stackOf(page)), String(page.name)).toEqual([]);
    }
  });
});

describe('validateRecordPageHeader · registry and publish door', () => {
  it('is one advisory entry on every command and the page publish door', () => {
    const entry = AUTHORING_RULES.find((r) => r.name === 'validateRecordPageHeader');
    expect(entry).toMatchObject({
      tier: 'advisory',
      commands: ['validate', 'build', 'lint'],
      surfaces: ['cli', 'runtime-publish'],
      runtimeTypes: ['page'],
    });
  });

  it('a page write returns the title advisory without refusing, carrying its user sentence', () => {
    const page = leadPage({ title: '{full_name}' });
    const result = runRuntimeAuthoringRules({ type: 'page', item: page, context: { objects: [LEAD] } });
    expect(result.errors ?? []).toEqual([]);
    const advisory = result.advisories.find((f) => f.rule === RECORD_PAGE_HEADER_TITLE_DIFFERS);
    expect(advisory, 'the door returns the title advisory for this write').toBeDefined();
    expect(advisory!.userTextParams).toEqual({ page: 'lead_detail', object: 'crm_lead', field: 'display_title' });
    const issue = RuntimeAuthoringIssueSchema.parse({
      rule: advisory!.rule,
      path: advisory!.path,
      where: advisory!.where,
      message: advisory!.message,
      hint: advisory!.hint,
      severity: advisory!.severity,
      userMessage: findingUserMessage(advisory!, ['zh-CN']),
    });
    expect(issue.userMessage).toContain('页面“lead_detail”的页头自己写了标题');
  });

  it('a page write judges the actions the snapshot shows on the object, and only those', () => {
    const lead = { ...LEAD, actions: leadActions().map(({ objectName: _o, ...a }) => a) };
    const page = leadPage({ actions: LISTED });
    const shown = runRuntimeAuthoringRules({ type: 'page', item: page, context: { objects: [lead] } });
    expect(shown.advisories.map((f) => f.rule)).toContain(RECORD_PAGE_HEADER_ACTIONS_DIFFER);
    const hidden = runRuntimeAuthoringRules({ type: 'page', item: page, context: { objects: [LEAD] } });
    expect(hidden.advisories.map((f) => f.rule)).not.toContain(RECORD_PAGE_HEADER_ACTIONS_DIFFER);
  });
});

describe('validateRecordPageHeader · user text', () => {
  it('holds a sentence for both ids in every platform locale, merged into the door\'s catalog', () => {
    expect(Object.keys(RECORD_PAGE_HEADER_USER_TEXT).sort()).toEqual(
      [RECORD_PAGE_HEADER_ACTIONS_DIFFER, RECORD_PAGE_HEADER_TITLE_DIFFERS].sort(),
    );
    for (const [rule, entry] of Object.entries(RECORD_PAGE_HEADER_USER_TEXT)) {
      expect(Object.keys(entry).sort(), rule).toEqual([...PLATFORM_LOCALE_TAGS].sort());
      expect(FINDING_USER_TEXT_CATALOG[rule]).toBe(entry);
    }
  });

  it('renders each sentence from the rule\'s real findings, names interpolated, in every locale', () => {
    const findings = validateRecordPageHeader(stackOf(leadPage({ title: '{full_name}', actions: LISTED })));
    expect(findings).toHaveLength(2);
    for (const finding of findings) {
      for (const locale of PLATFORM_LOCALE_TAGS) {
        const text = findingUserMessage(finding, [locale]);
        expect(text, `${finding.rule} · ${locale}`).toBeDefined();
        expect(text).toContain('lead_detail');
        expect(text).toContain('crm_lead');
        expect(text).not.toContain('undefined');
      }
    }
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22537 — `record:approvals` and `record:attachments`, the record page's
 * Approvals and Attachments panels, through the authoring rules `os validate` /
 * `os build` / `os lint` run. objectui registered both inside the spec-reserved
 * `record` namespace with no `PageComponentType` member and no
 * `ComponentPropsMap` row, so `component-type-unknown` refused the page Studio's
 * page create seeds for any `enable.files` object: the seed's Attachments tab
 * holds a bare `record:attachments`. The spec-side pins (the rows, the enum
 * members, the print classification) live beside the rows in
 * `@objectstack/spec`.
 */
import { describe, expect, it } from 'vitest';
import { ObjectStackDefinitionSchema, normalizeStackInput } from '@objectstack/spec';

import { runAuthoringRules } from './authoring-rules.js';
import { COMPONENT_PROPS_UNKNOWN_KEY, validateComponentProps } from './validate-component-props.js';
import { COMPONENT_TYPE_UNKNOWN, validateComponentTypes } from './validate-component-types.js';

type AnyRec = Record<string, unknown>;

const OBJECT = {
  name: 'invoice',
  label: 'Invoice',
  enable: { files: true },
  sharingModel: 'private',
  fields: {
    name: { type: 'text', label: 'Name' },
    amount: { type: 'number', label: 'Amount' },
  },
};

/**
 * The page Studio's page create stores for a `type: 'record'` page bound to
 * `invoice`: the `regions` and `template` of objectui's
 * `buildDefaultPageSchema(objectDef)`, called with no options (objectui
 * `app-shell/src/views/metadata-admin/anchors.ts`, `createSeed`). The
 * Attachments tab is the synthesizer's `buildDefaultAttachments()`, a bare
 * `{ type: 'record:attachments' }` at `components[2].properties.items[1]`.
 */
const seededRecordPage = (extraTabs: unknown[] = []): AnyRec => ({
  name: 'invoice_record',
  label: 'Invoice',
  type: 'record',
  object: 'invoice',
  kind: 'full',
  template: 'full-width',
  regions: [
    {
      name: 'main',
      width: 'full',
      components: [
        { type: 'page:header', properties: { recordChrome: true } },
        { type: 'record:highlights', properties: { fields: ['amount'] } },
        {
          type: 'page:tabs',
          properties: {
            items: [
              { label: 'Details', value: 'details', children: [{ type: 'record:details', properties: { hideFields: ['amount'] } }] },
              { label: 'Attachments', value: 'attachments', children: [{ type: 'record:attachments' }] },
              ...extraTabs,
            ],
          },
        },
        { type: 'record:discussion' },
      ],
    },
  ],
});

const approvalsTab = (node: AnyRec) => ({ label: 'Approvals', value: 'approvals', children: [node] });
/** One more authored tab holding `node`, at `items[2]`. */
const extraTab = (node: AnyRec) => ({ label: 'Panel', value: 'panel', children: [node] });

const stackOf = (page: AnyRec): AnyRec => ({
  manifest: { id: 'com.example.invoices', name: 'invoices', version: '1.0.0', type: 'app' },
  objects: [OBJECT],
  pages: [page],
});

/**
 * The verdict `os validate` reaches on a config: the stack parse, then the
 * shared rule pipeline, with an `error` finding as the refusal (the CLI's
 * `judgeAuthorTimeRules`, minus the JSX gate and the per-package pass, which a
 * config with no `kind: 'jsx'` page and no `packages` never reaches).
 */
const validateVerdict = (page: AnyRec) => {
  const normalized = normalizeStackInput(stackOf(page)) as AnyRec;
  const parsed = ObjectStackDefinitionSchema.safeParse(normalized);
  expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3))).toBe(true);
  const findings = runAuthoringRules('validate', { normalized: normalized as never, parsed: parsed.data as never });
  return {
    errors: findings.filter((f) => f.severity === 'error'),
    componentFindings: findings.filter((f) => f.rule === COMPONENT_TYPE_UNKNOWN || f.rule.startsWith('component-props')),
  };
};

const TABS = 'pages[0].regions[0].components[2].properties.items';

describe("the page Studio's page create seeds passes the authoring doors", () => {
  it('with the Attachments tab the synthesizer emits for an `enable.files` object', () => {
    const page = seededRecordPage();
    expect(validateComponentTypes({ pages: [page] })).toEqual([]);
    expect(validateComponentProps({ pages: [page] })).toEqual([]);
    const verdict = validateVerdict(page);
    expect(verdict.errors).toEqual([]);
    expect(verdict.componentFindings).toEqual([]);
  });

  it('with an authored Approvals tab placing a bare `record:approvals`', () => {
    const page = seededRecordPage([approvalsTab({ type: 'record:approvals' })]);
    expect(validateComponentTypes({ pages: [page] })).toEqual([]);
    expect(validateComponentProps({ pages: [page] })).toEqual([]);
    const verdict = validateVerdict(page);
    expect(verdict.errors).toEqual([]);
    expect(verdict.componentFindings).toEqual([]);
  });

  it('control: the same seed with a misspelled type in the reserved namespace is refused', () => {
    const page = seededRecordPage([approvalsTab({ type: 'record:aprovals' })]);
    const verdict = validateVerdict(page);
    expect(verdict.errors.map((f) => [f.rule, f.path])).toEqual([
      [COMPONENT_TYPE_UNKNOWN, `${TABS}[2].children[0].type`],
    ]);
  });
});

describe('a misspelled type offers the declared spelling', () => {
  it.each([
    ['record:attachment', 'record:attachments'],
    ['record:aprovals', 'record:approvals'],
  ])('`%s` is `component-type-unknown`, offering `%s`', (typo, declared) => {
    const findings = validateComponentTypes({ pages: [seededRecordPage([extraTab({ type: typo })])] });
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.rule).toBe(COMPONENT_TYPE_UNKNOWN);
    expect(f.severity).toBe('error');
    expect(f.path).toBe(`${TABS}[2].children[0].type`);
    expect(f.message).toContain(`\`${typo}\``);
    expect(f.message).toContain(`'${declared}'`);
  });
});

describe('a prop on either node is a `component-props-unknown-key` finding, naming the key', () => {
  it.each([
    ['record:attachments', 'maxFiles'],
    ['record:attachments', 'accept'],
    ['record:approvals', 'approval'],
    ['record:approvals', 'showRemind'],
  ])('`%s` › `%s`', (type, key) => {
    const page = seededRecordPage([extraTab({ type, properties: { [key]: true } })]);
    const findings = validateComponentProps({ pages: [page] });
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.rule).toBe(COMPONENT_PROPS_UNKNOWN_KEY);
    expect(f.severity).toBe('warning');
    expect(f.path).toBe(`${TABS}[2].children[0].properties.${key}`);
    expect(f.where).toBe(`page "invoice_record" · ${type}`);
    expect(f.message).toContain(`\`${key}\``);
    expect(f.message).toContain(`\`${type}\``);

    // The same finding reaches the shared pipeline the authoring commands run.
    expect(validateVerdict(page).componentFindings.map((x) => x.rule)).toEqual([COMPONENT_PROPS_UNKNOWN_KEY]);
  });
});

describe("`record:approvals` names the host's runtime channel when it is authored", () => {
  it.each([
    ['approvals', { available: true, requests: [], pendingRequest: null }, "HOST's data channel"],
    ['currentUserId', 'usr_1', 'signed-in user'],
  ])('`%s`', (key, value, prescription) => {
    const page = seededRecordPage([approvalsTab({ type: 'record:approvals', properties: { [key]: value } })]);
    const findings = validateComponentProps({ pages: [page] });
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.rule).toBe(COMPONENT_PROPS_UNKNOWN_KEY);
    expect(f.path).toBe(`${TABS}[2].children[0].properties.${key}`);
    expect(`${f.message}\n${f.hint}`).toContain(prescription);
  });
});

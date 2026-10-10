// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22537 — `record:approvals` and `record:attachments`, the record page's
 * Approvals and Attachments panels. objectui registered both inside the
 * spec-reserved `record` namespace with no `PageComponentType` member and no
 * `ComponentPropsMap` row, so the `component-type-unknown` authoring rule
 * refused a node the platform's own default-page synthesizer emits, and
 * Studio's page create seeds the Attachments tab onto every record page of an
 * `enable.files` object.
 *
 * Both are declared now, each with a strict row measured from its renderer's
 * read points at the `.objectui-sha` pin. Both rows accept no key:
 * `record:attachments` reads no props at all, and `record:approvals` reads
 * only the host's runtime channel (`approvals`, `currentUserId`), which the row
 * refuses with a prescription instead of declaring. The authoring rule ids
 * (`component-type-unknown`, `component-props-unknown-key`) are pinned where
 * they live, in `@objectstack/lint`.
 */
import { describe, expect, it } from 'vitest';

import { ComponentPropsMap } from './component.zod';
import {
  PageComponentSchema,
  PageComponentType,
  PageSchema,
  PRINTABLE_PAGE_COMPONENT_TYPES,
  PRINT_REFUSED_PAGE_COMPONENT_TYPES,
  RETIRED_PAGE_COMPONENT_TYPES,
} from './page.zod';
import {
  hasReservedComponentNamespace,
  isKnownComponentType,
  KNOWN_COMPONENT_TYPE_CANDIDATES,
  STRING_ARM_REGISTERED_TYPES,
} from './component-type-vocabulary';

const TYPES = ['record:approvals', 'record:attachments'] as const;
const row = (type: (typeof TYPES)[number]) => ComponentPropsMap[type];

/**
 * The page Studio's page create stores for a `type: 'record'` page bound to an
 * `enable.files: true` object: the `regions` and `template` of objectui's
 * `buildDefaultPageSchema(objectDef)`, called with no options (objectui
 * `app-shell/src/views/metadata-admin/anchors.ts`, `createSeed`). The
 * Attachments tab is the synthesizer's `buildDefaultAttachments()`, a bare
 * `{ type: 'record:attachments' }`.
 */
const seededRecordPage = (extraTabs: unknown[] = []) => ({
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

/** The issues of a failed safeParse, after asserting it failed. */
const issuesOf = (result: { success: boolean; error?: { issues: Array<{ code: string; message: string; keys?: string[] }> } }) => {
  expect(result.success).toBe(false);
  return result.error!.issues;
};

describe('both types are declared', () => {
  it.each(TYPES)('`%s` is a `PageComponentType` member with a `ComponentPropsMap` row', (type) => {
    expect(PageComponentType.options).toContain(type);
    expect(PageComponentType.safeParse(type).success).toBe(true);
    expect(Object.keys(ComponentPropsMap)).toContain(type);
    expect(row(type)).toBeDefined();
  });

  it.each(TYPES)('`%s` is known through the declaration, not through the string-arm ledger', (type) => {
    expect(STRING_ARM_REGISTERED_TYPES).not.toContain(type);
    expect(RETIRED_PAGE_COMPONENT_TYPES.has(type)).toBe(false);
    expect(hasReservedComponentNamespace(type)).toBe(true);
    expect(isKnownComponentType(type)).toBe(true);
    expect(KNOWN_COMPONENT_TYPE_CANDIDATES).toContain(type);
  });

  it('a misspelling inside the reserved `record` namespace stays unknown', () => {
    for (const typo of ['record:approval', 'record:aprovals', 'record:attachment', 'record:attachements']) {
      expect(hasReservedComponentNamespace(typo), typo).toBe(true);
      expect(isKnownComponentType(typo), typo).toBe(false);
    }
  });
});

describe('each row is a strict object that accepts no key', () => {
  it.each(TYPES)('`%s` declares no key', (type) => {
    expect(Object.keys(row(type).shape)).toEqual([]);
  });

  it.each(TYPES)('`%s` accepts the empty bag at every door: the row, the node, the page', (type) => {
    expect(row(type).safeParse({}).success).toBe(true);
    expect(PageComponentSchema.safeParse({ type }).success).toBe(true);
    expect(PageComponentSchema.safeParse({ type, properties: {} }).success).toBe(true);
    // Node-level keys stay on the node: both renderers read `className` off the
    // node, never out of `properties`.
    expect(PageComponentSchema.safeParse({ type, id: 'panel', className: 'mt-4' }).success).toBe(true);
  });

  it.each(TYPES)('`%s` refuses a misspelled or invented prop, naming the component and the key', (type) => {
    for (const key of ['approval', 'currentUser', 'maxFiles', 'title']) {
      const issues = issuesOf(row(type).safeParse({ [key]: true }));
      expect(issues, `${type}.${key}`).toHaveLength(1);
      const [issue] = issues;
      expect(issue.code, `${type}.${key}`).toBe('unrecognized_keys');
      expect(issue.keys, `${type}.${key}`).toEqual([key]);
      expect(issue.message, `${type}.${key}`).toContain(`\`${type}\``);
      expect(issue.message, `${type}.${key}`).toContain(key);
    }
  });

  it.each(TYPES)('`%s` answers a node-level key written inside `properties` with the node prescription', (type) => {
    const [issue] = issuesOf(row(type).safeParse({ className: 'mt-4' }));
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.message).toContain('component NODE');
  });
});

describe("`record:approvals` refuses the host's runtime channel with its prescription", () => {
  it('`approvals`, the approval requests the default record page fetched', () => {
    const [issue] = issuesOf(row('record:approvals').safeParse({
      approvals: { available: true, requests: [], pendingRequest: null },
    }));
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.keys).toEqual(['approvals']);
    expect(issue.message).toContain("HOST's data channel");
    expect(issue.message).toContain('Omit it');
  });

  it('`currentUserId`, the signed-in user the host passes', () => {
    const [issue] = issuesOf(row('record:approvals').safeParse({ currentUserId: 'usr_1' }));
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.keys).toEqual(['currentUserId']);
    expect(issue.message).toContain('signed-in user');
    expect(issue.message).toContain('Omit it');
  });
});

describe("the page Studio's page create seeds parses", () => {
  it('with the Attachments tab the synthesizer emits for an `enable.files` object', () => {
    expect(PageSchema.safeParse(seededRecordPage()).success).toBe(true);
  });

  it('with an authored Approvals tab placing a bare `record:approvals`', () => {
    const page = seededRecordPage([
      { label: 'Approvals', value: 'approvals', children: [{ type: 'record:approvals' }] },
    ]);
    expect(PageSchema.safeParse(page).success).toBe(true);
  });
});

describe('the print classification answers for both', () => {
  it.each(TYPES)('`%s` is refused inside a print page with its own reason, and is not printable', (type) => {
    expect(PRINTABLE_PAGE_COMPONENT_TYPES.has(type)).toBe(false);
    expect(PRINT_REFUSED_PAGE_COMPONENT_TYPES.get(type)).toMatch(/^is /);
  });
});

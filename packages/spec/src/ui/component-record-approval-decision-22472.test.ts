// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22472 — `record:approval_decision`, the approval decision panel of a
 * `sys_approval_request` record page (the spec half of the objectui#12045
 * ruling 6079807016, letter 乙). Declared spec first: a `PageComponentType`
 * member with a `ComponentPropsMap` row that is an EMPTY strict object, because
 * the renderer reads the record context and the object's declared actions and
 * nothing authored.
 *
 * What is pinned here is the contract every reader dispatches on: the type is
 * known, its empty bag parses at every door, any key is refused naming the
 * component and the key, a misspelling inside the reserved `record` namespace
 * stays unknown, and the print classification answers for it. The authoring
 * rule ids (`component-props-unknown-key`, `component-type-unknown`) are pinned
 * where they live, in `@objectstack/lint`.
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

const TYPE = 'record:approval_decision';
const ROW = () => (ComponentPropsMap as Record<string, (typeof ComponentPropsMap)['nav:menu']>)[TYPE];

const requestPage = (component: Record<string, unknown>) => ({
  name: 'approval_request_detail',
  label: 'Approval request',
  type: 'record',
  object: 'sys_approval_request',
  regions: [{ name: 'main', components: [component] }],
});

describe('the type is declared, spec first', () => {
  it('is a `PageComponentType` member with a `ComponentPropsMap` row', () => {
    expect(PageComponentType.options).toContain(TYPE);
    expect(PageComponentType.safeParse(TYPE).success).toBe(true);
    expect(Object.keys(ComponentPropsMap)).toContain(TYPE);
    expect(ROW()).toBeDefined();
  });

  it('is known through the declaration, not through the string-arm ledger', () => {
    expect(STRING_ARM_REGISTERED_TYPES).not.toContain(TYPE);
    expect(RETIRED_PAGE_COMPONENT_TYPES.has(TYPE)).toBe(false);
    expect(hasReservedComponentNamespace(TYPE)).toBe(true);
    expect(isKnownComponentType(TYPE)).toBe(true);
    expect(KNOWN_COMPONENT_TYPE_CANDIDATES).toContain(TYPE);
  });

  it('a misspelling inside the reserved `record` namespace stays unknown', () => {
    // The namespace claim is what makes a typo here a refusal rather than an
    // unregistered custom string: `component-type-unknown` judges exactly this
    // pair of predicates.
    for (const typo of ['record:approval_decison', 'record:approvals_decision', 'record:approval-decision']) {
      expect(hasReservedComponentNamespace(typo), typo).toBe(true);
      expect(isKnownComponentType(typo), typo).toBe(false);
    }
  });
});

describe('the row is an empty strict object', () => {
  it('declares no key', () => {
    const shape = (ROW() as unknown as { shape: Record<string, unknown> }).shape;
    expect(Object.keys(shape)).toEqual([]);
  });

  it('accepts the empty bag at every door: the row, the node, the page', () => {
    expect(ROW().safeParse({}).success).toBe(true);
    expect(PageComponentSchema.safeParse({ type: TYPE }).success).toBe(true);
    expect(PageComponentSchema.safeParse({ type: TYPE, properties: {} }).success).toBe(true);
    // Node-level keys stay node-level: the renderer reads `className` off the
    // node, never out of `properties`.
    expect(PageComponentSchema.safeParse({ type: TYPE, id: 'decision', className: 'mt-4' }).success).toBe(true);
    expect(PageSchema.safeParse(requestPage({ type: TYPE })).success).toBe(true);
  });

  it('refuses any authored key, naming the component and the key', () => {
    for (const key of ['showProgress', 'actions', 'requestId', 'location']) {
      const result = ROW().safeParse({ [key]: true });
      expect(result.success, key).toBe(false);
      if (result.success) continue;
      expect(result.error.issues).toHaveLength(1);
      const [issue] = result.error.issues;
      expect(issue.code, key).toBe('unrecognized_keys');
      expect((issue as { keys?: string[] }).keys, key).toEqual([key]);
      expect(issue.message, key).toContain('`record:approval_decision`');
      expect(issue.message, key).toContain(key);
    }
  });

  it('answers a node-level key written inside `properties` with the node prescription', () => {
    const result = ROW().safeParse({ className: 'mt-4' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].code).toBe('unrecognized_keys');
    expect(result.error.issues[0].message).toContain('component NODE');
  });
});

describe('the print classification answers for it', () => {
  it('is refused inside a print page with its own reason, and is not printable', () => {
    expect(PRINTABLE_PAGE_COMPONENT_TYPES.has(TYPE)).toBe(false);
    expect(PRINT_REFUSED_PAGE_COMPONENT_TYPES.get(TYPE)).toMatch(/nothing to print$/);
  });
});

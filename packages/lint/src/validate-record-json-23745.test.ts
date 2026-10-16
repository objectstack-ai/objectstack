// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23745 — `record:json`, one key of the bound record drawn as indented JSON
 * behind a REQUIRED, fail-closed `requiredPermissions` gate, through the
 * authoring rules `os validate` / `os build` / `os lint` run. The spec-side
 * pins (the row, the enum member, the print classification) live beside the
 * row in `@objectstack/spec` (`component-record-json.test.ts`).
 *
 * Also pinned here: `field` is NOT judged against the object's fields — the
 * key the block exists for (`payload` on a `sys_approval_request` row) is one
 * the read route serves beside them, so `page-field-unknown` stays silent.
 */
import { describe, expect, it } from 'vitest';

import { COMPONENT_PROPS_INVALID, COMPONENT_PROPS_UNKNOWN_KEY, validateComponentProps } from './validate-component-props.js';
import { COMPONENT_TYPE_UNKNOWN, validateComponentTypes } from './validate-component-types.js';
import { PAGE_FIELD_UNKNOWN, validatePageFieldBindings } from './validate-page-field-bindings.js';

type AnyRec = Record<string, unknown>;

const OBJECT = {
  name: 'request',
  label: 'Request',
  fields: {
    name: { type: 'text', label: 'Name' },
    payload_json: { type: 'textarea', label: 'Payload' },
  },
};

const pageWith = (node: AnyRec): AnyRec => ({
  name: 'request_record',
  label: 'Request',
  type: 'record',
  object: 'request',
  regions: [{ name: 'main', components: [node] }],
});

const AT = 'pages[0].regions[0].components[0]';
const VALID = { field: 'payload', requiredPermissions: ['studio.access'], label: 'Raw data (JSON)' };

describe('a `record:json` node passes the authoring doors', () => {
  it('is a known type with an accepted bag', () => {
    const page = pageWith({ type: 'record:json', properties: VALID });
    expect(validateComponentTypes({ pages: [page] })).toEqual([]);
    expect(validateComponentProps({ pages: [page] })).toEqual([]);
  });

  it('`field` naming a route-served key is not a `page-field-unknown` finding', () => {
    const page = pageWith({ type: 'record:json', properties: VALID });
    const findings = validatePageFieldBindings({ objects: [OBJECT], pages: [page] } as never);
    expect(findings.filter((f) => f.rule === PAGE_FIELD_UNKNOWN)).toEqual([]);
    // Control: the same rule fires on a sibling block naming the same key.
    const control = pageWith({ type: 'record:highlights', properties: { fields: ['payload'] } });
    const fired = validatePageFieldBindings({ objects: [OBJECT], pages: [control] } as never);
    expect(fired.map((f) => f.rule)).toContain(PAGE_FIELD_UNKNOWN);
  });

  it('control: a misspelled type in the reserved namespace offers the declared spelling', () => {
    const findings = validateComponentTypes({ pages: [pageWith({ type: 'record:jsn', properties: VALID })] });
    expect(findings.map((f) => f.rule)).toEqual([COMPONENT_TYPE_UNKNOWN]);
    expect(findings[0].message).toContain("'record:json'");
  });
});

describe('the props gate refuses what the row does not declare', () => {
  it('an undeclared key is `component-props-unknown-key`, naming it', () => {
    const findings = validateComponentProps({ pages: [pageWith({ type: 'record:json', properties: { ...VALID, collapsed: false } })] });
    expect(findings.map((f) => [f.rule, f.path])).toEqual([[COMPONENT_PROPS_UNKNOWN_KEY, `${AT}.properties.collapsed`]]);
    expect(findings[0].message).toContain('`collapsed`');
  });

  it.each([
    ['no `requiredPermissions`', { field: 'payload' }],
    ['an empty `requiredPermissions`', { field: 'payload', requiredPermissions: [] }],
    ['no `field`', { requiredPermissions: ['studio.access'] }],
  ])('%s is a `component-props-invalid` error', (_label, properties) => {
    const findings = validateComponentProps({ pages: [pageWith({ type: 'record:json', properties })] });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.rule === COMPONENT_PROPS_INVALID && f.severity === 'error')).toBe(true);
  });
});

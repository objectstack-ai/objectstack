// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24162 — `record:json` (#23745) is RETIRED by name, so the authoring rules
 * `os validate` / `os build` / `os lint` run now REFUSE it. This file was
 * #23745's accept pin at this door; it is flipped, not deleted, because the
 * lint door is its own layer: the spec-side pins
 * (`component-record-json-retirement.test.ts`) judge the parse, and the
 * map-driven `flags %s` case in `validate-component-types.test.ts` judges every
 * retired name generically. This file holds the one this card retired, at
 * both rules that dispatch on it, beside a live control on the same page.
 *
 * The live control is `record:approvals`, the declared record-page member that
 * sits beside it on the approval request page.
 */
import { RETIRED_PAGE_COMPONENT_TYPES } from '@objectstack/spec/ui';
import { describe, expect, it } from 'vitest';

import { runAuthoringRules } from './authoring-rules.js';
import { COMPONENT_PROPS_INVALID, validateComponentProps } from './validate-component-props.js';
import {
  COMPONENT_TYPE_UNKNOWN,
  retiredTypeHead,
  retiredTypeRemedy,
  validateComponentTypes,
} from './validate-component-types.js';

type AnyRec = Record<string, unknown>;

const pageWith = (node: AnyRec): AnyRec => ({
  name: 'request_record',
  label: 'Request',
  type: 'record',
  object: 'request',
  regions: [{ name: 'main', components: [node] }],
});

const AT = 'pages[0].regions[0].components[0]';
/** The bag #23745's accept pin authored — now refused like any other. */
const FORMER_BAG = { field: 'payload', requiredPermissions: ['studio.access'], label: 'Raw data (JSON)' };
const HEAD = '`record:json` was removed in @objectstack/spec 18 (ADR-0049)';

describe('a `record:json` node is refused at the authoring doors', () => {
  it('the spec map names it, and its head is the one this door quotes', () => {
    const prescription = RETIRED_PAGE_COMPONENT_TYPES.get('record:json');
    expect(prescription).toBeTypeOf('string');
    expect(retiredTypeHead(prescription!)).toBe(HEAD);
    expect(retiredTypeRemedy(prescription!)).toBe('Delete the `record:json` component node and put nothing in its place');
  });

  it('`component-type-unknown` reports it by exact name at its `type` path, bare or populated', () => {
    for (const node of [{ type: 'record:json' }, { type: 'record:json', properties: FORMER_BAG }]) {
      const findings = validateComponentTypes({ pages: [pageWith(node)] });
      expect(findings.map((f) => [f.rule, f.severity, f.path])).toEqual([[COMPONENT_TYPE_UNKNOWN, 'error', `${AT}.type`]]);
      expect(findings[0].message.startsWith(HEAD)).toBe(true);
      expect(findings[0].hint).toMatch(/^Delete the `record:json` component node/);
    }
    // Control: the live sibling on the same page draws no finding.
    expect(validateComponentTypes({ pages: [pageWith({ type: 'record:approvals' })] })).toEqual([]);
  });

  it('the props gate refuses its bag WHOLE, `{}` included, as an error at `properties`', () => {
    for (const properties of [{}, FORMER_BAG]) {
      const findings = validateComponentProps({ pages: [pageWith({ type: 'record:json', properties })] });
      expect(findings.map((f) => [f.rule, f.severity, f.path])).toEqual([
        [COMPONENT_PROPS_INVALID, 'error', `${AT}.properties`],
      ]);
    }
    // Control: the live sibling's empty bag passes the same gate.
    expect(validateComponentProps({ pages: [pageWith({ type: 'record:approvals', properties: {} })] })).toEqual([]);
  });

  it('a misspelling in the reserved namespace is no longer steered to the retired name', () => {
    const findings = validateComponentTypes({ pages: [pageWith({ type: 'record:jsn' })] });
    expect(findings.map((f) => f.rule)).toEqual([COMPONENT_TYPE_UNKNOWN]);
    expect(findings[0].message).not.toContain("'record:json'");
  });

  it('reaches the shared pipeline as errors — the run `os validate` / `os build` / `os lint` refuse on', () => {
    const findings = runAuthoringRules('validate', {
      normalized: { pages: [pageWith({ type: 'record:json', properties: FORMER_BAG })] } as never,
    });
    const mine = findings.filter((f) => f.path.startsWith(AT));
    expect(mine.map((f) => [f.rule, f.severity]).sort()).toEqual(
      [[COMPONENT_PROPS_INVALID, 'error'], [COMPONENT_TYPE_UNKNOWN, 'error']].sort(),
    );
  });
});

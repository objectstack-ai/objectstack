// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22472 — `record:approval_decision`, the approval decision panel, through the
 * authoring rules `os validate` / `os build` / `os lint` run. The ruling that
 * asked for the declaration (objectui#12045, 6079807016, letter 乙) gave its
 * reason as exactly these two doors: a type with no `ComponentPropsMap` row
 * passes any props bag, so a misspelled property drops in silence, and a type
 * the vocabulary does not declare inside the reserved `record` namespace is
 * refused outright. The spec-side pins (the row, the enum member, the print
 * classification) live beside the row in `@objectstack/spec`.
 */
import { describe, expect, it } from 'vitest';

import { runAuthoringRules } from './authoring-rules.js';
import { COMPONENT_PROPS_UNKNOWN_KEY, validateComponentProps } from './validate-component-props.js';
import { COMPONENT_TYPE_UNKNOWN, validateComponentTypes } from './validate-component-types.js';

type AnyRec = Record<string, unknown>;

/** The request page plugin-approvals authors: one record page, one region. */
const requestPage = (components: unknown[]): AnyRec => ({
  pages: [
    {
      name: 'approval_request_detail',
      label: 'Approval request',
      type: 'record',
      object: 'sys_approval_request',
      regions: [{ name: 'main', components }],
    },
  ],
});

const ourRules = (stack: AnyRec) =>
  runAuthoringRules('validate', { normalized: stack as never }).filter(
    (f) => f.rule.startsWith('component-props') || f.rule === COMPONENT_TYPE_UNKNOWN,
  );

describe('a node with no props passes both doors', () => {
  it.each([
    ['no `properties` at all', { type: 'record:approval_decision' }],
    ['an empty `properties`', { type: 'record:approval_decision', properties: {} }],
    ['node-level keys only', { type: 'record:approval_decision', id: 'decision', className: 'mt-4' }],
  ])('%s', (_label, node) => {
    expect(validateComponentProps(requestPage([node]))).toEqual([]);
    expect(validateComponentTypes(requestPage([node]))).toEqual([]);
    expect(ourRules(requestPage([node]))).toEqual([]);
  });
});

describe('any authored key is a `component-props-unknown-key` finding, naming the key', () => {
  it.each(['showProgress', 'actions', 'requestId'])('`%s`', (key) => {
    const stack = requestPage([{ type: 'record:approval_decision', properties: { [key]: true } }]);
    const findings = validateComponentProps(stack);
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.rule).toBe(COMPONENT_PROPS_UNKNOWN_KEY);
    expect(f.severity).toBe('warning');
    expect(f.path).toBe(`pages[0].regions[0].components[0].properties.${key}`);
    expect(f.where).toBe('page "approval_request_detail" · record:approval_decision');
    expect(f.message).toContain(`\`${key}\``);
    expect(f.message).toContain('`record:approval_decision`');

    // The same finding reaches the shared pipeline the authoring commands run.
    const viaPipeline = ourRules(stack);
    expect(viaPipeline.map((x) => x.rule)).toEqual([COMPONENT_PROPS_UNKNOWN_KEY]);
  });
});

describe('a misspelled type in the reserved `record` namespace is refused', () => {
  it('`record:approval_decison` is `component-type-unknown`, offering the declared spelling', () => {
    const stack = requestPage([{ type: 'record:approval_decison' }]);
    const findings = validateComponentTypes(stack);
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.rule).toBe(COMPONENT_TYPE_UNKNOWN);
    expect(f.severity).toBe('error');
    expect(f.path).toBe('pages[0].regions[0].components[0].type');
    expect(f.message).toContain('`record:approval_decison`');
    expect(f.message).toContain("'record:approval_decision'");

    expect(ourRules(stack).map((x) => x.rule)).toEqual([COMPONENT_TYPE_UNKNOWN]);
  });

  it('control: the declared spelling in the same position is not refused', () => {
    expect(validateComponentTypes(requestPage([{ type: 'record:approval_decision' }]))).toEqual([]);
  });
});

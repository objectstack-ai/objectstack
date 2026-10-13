// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `os validate`'s props gate on a page action row's `onSuccess` and executor key.
//
// A page's `properties` bag is outside the stack parse, so the props gate is
// the door `os validate` judges an `action:button` / `action:icon` /
// `action:group` member / `action:menu` member through. It parses the bag
// against the row's `ComponentPropsMap` schema, whose `onSuccess` is now
// `ActionSchema`'s own post-success block (so `navigate` is judged by the
// shared url-target grammar, `navigation-target.ts` in `@objectstack/spec`) and
// whose executor key refuses `'navigation'`, the runner's alias of `'url'`.
// These pins hold that the gate reports each refusal at the row's own path,
// with the parse's own first sentence, and stays silent on the accepted
// control. The finding is a `component-props-invalid` error, like every finding
// of the gate (its module header says why); no code in this package changed for
// it.
import { describe, expect, it } from 'vitest';
import { validateComponentProps, COMPONENT_PROPS_INVALID } from './validate-component-props.js';

type AnyRec = Record<string, unknown>;

/** One page, one region, one component. */
const stackWith = (component: AnyRec): AnyRec => ({
  pages: [
    {
      name: 'probe_page',
      label: 'Probe',
      type: 'home',
      object: 'task',
      regions: [{ name: 'main', components: [component] }],
    },
  ],
});

const BASE = 'pages[0].regions[0].components[0].properties';
const NAVIGATE_REFUSAL = "An action's `onSuccess.navigate` opens with `javascript:`, a scheme a url target never opens.";

/** [row, the node for a given action, the path prefix of the row's own keys, its executor key, its subject]. */
const ROWS: ReadonlyArray<readonly [string, (action: AnyRec) => AnyRec, string, 'actionType' | 'type', string]> = [
  ['action:button', (action) => ({ type: 'action:button', properties: { label: 'Clone', ...action } }),
    BASE, 'actionType', "An `action:button`'s `actionType: 'navigation'`"],
  ['action:icon', (action) => ({ type: 'action:icon', properties: { icon: 'copy', label: 'Clone', ...action } }),
    BASE, 'actionType', "An `action:icon`'s `actionType: 'navigation'`"],
  ['action:group member', (action) => ({ type: 'action:group', properties: { actions: [{ label: 'Clone', ...action }] } }),
    `${BASE}.actions.0`, 'type', "An `action:group` member's `type: 'navigation'`"],
  ['action:menu member', (action) => ({ type: 'action:menu', properties: { actions: [{ label: 'Clone', ...action }] } }),
    `${BASE}.actions.0`, 'type', "An `action:menu` member's `type: 'navigation'`"],
];

describe("the props gate judges a page action row's `onSuccess` as `ActionSchema`'s own block", () => {
  it.each(ROWS)('REFUSAL: %s with `onSuccess.navigate: \'javascript:alert(1)\'` is one finding at `onSuccess.navigate`', (_row, node, at, key) => {
    const findings = validateComponentProps(stackWith(node({
      [key]: 'api', target: '/api/v1/tasks/clone', onSuccess: { navigate: 'javascript:alert(1)' },
    })));
    expect(findings.map((f) => [f.rule, f.path])).toEqual([[COMPONENT_PROPS_INVALID, `${at}.onSuccess.navigate`]]);
    expect(findings[0].message).toContain(NAVIGATE_REFUSAL);
  });

  it.each(ROWS)('ACCEPTED CONTROL: %s with an in-app route template reports nothing', (_row, node, _at, key) => {
    expect(validateComponentProps(stackWith(node({
      [key]: 'api', target: '/api/v1/tasks/clone', onSuccess: { navigate: '/apps/crm/tasks/${result.id}' },
    })))).toEqual([]);
  });
});

describe("the props gate refuses `'navigation'` at a page action row's executor key", () => {
  it.each(ROWS)("REFUSAL: %s with `'navigation'` is one finding at its executor key", (_row, node, at, key, subject) => {
    const findings = validateComponentProps(stackWith(node({ [key]: 'navigation', target: '/apps/crm/tasks' })));
    expect(findings.map((f) => [f.rule, f.path])).toEqual([[COMPONENT_PROPS_INVALID, `${at}.${key}`]]);
    expect(findings[0].message).toContain(
      `${subject} is the console runner's local alias of \`'url'\`, refused on page action rows since @objectstack/spec 18, and the url executor has one spelling.`,
    );
  });

  it.each(ROWS)("ACCEPTED CONTROL: %s with `'url'` and the same target reports nothing", (_row, node, _at, key) => {
    expect(validateComponentProps(stackWith(node({ [key]: 'url', target: '/apps/crm/tasks' })))).toEqual([]);
  });
});

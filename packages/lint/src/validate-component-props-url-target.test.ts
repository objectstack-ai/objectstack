// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `os validate`'s props gate on the page action rows' url `target`.
//
// A page's `properties` bag is outside the stack parse, so the props gate is
// the door `os validate` judges an `action:button` / `action:icon` /
// `action:group` member / `action:menu` member through. It parses the bag
// against the row's `ComponentPropsMap` schema, which now applies the shared
// url-target grammar (`navigation-target.ts` in `@objectstack/spec`) to a url
// executor's `target`. These pins hold that the gate reports that refusal at
// the row's own `target` path, with the parse's own first sentence, and stays
// silent on an admitted target. The finding is a `component-props-invalid`
// error, like every finding of the gate (its module header says why).
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
const JAVASCRIPT_REST = ' opens with `javascript:`, a scheme a url target never opens.';

/** [row, the node for a given target, the finding's path, the refusal's subject]. */
const ROWS: ReadonlyArray<readonly [string, (target: string) => AnyRec, string, string]> = [
  ['action:button', (target) => ({ type: 'action:button', properties: { label: 'Open', actionType: 'url', target } }),
    `${BASE}.target`, "An `action:button`'s `target` (`actionType: 'url'`)"],
  ['action:icon', (target) => ({ type: 'action:icon', properties: { label: 'Open', actionType: 'url', target } }),
    `${BASE}.target`, "An `action:icon`'s `target` (`actionType: 'url'`)"],
  ['action:group member', (target) => ({ type: 'action:group', properties: { actions: [{ label: 'Open', type: 'url', target }] } }),
    `${BASE}.actions.0.target`, "An `action:group` member's `target` (`type: 'url'`)"],
  ['action:menu member', (target) => ({ type: 'action:menu', properties: { actions: [{ label: 'Open', type: 'url', target }] } }),
    `${BASE}.actions.0.target`, "An `action:menu` member's `target` (`type: 'url'`)"],
];

describe('the props gate refuses a url `target` outside the shared set on the page action rows', () => {
  it.each(ROWS)('REFUSAL: %s with `javascript:alert(1)` is one finding at its `target`', (_row, node, path, subject) => {
    const findings = validateComponentProps(stackWith(node('javascript:alert(1)')));
    expect(findings.map((f) => [f.rule, f.path])).toEqual([[COMPONENT_PROPS_INVALID, path]]);
    expect(findings[0].message).toContain(`${subject}${JAVASCRIPT_REST}`);
  });

  it.each(ROWS)('ACCEPTED CONTROL: %s with an admitted target reports nothing', (_row, node) => {
    expect(validateComponentProps(stackWith(node('https://example.com/docs')))).toEqual([]);
  });
});

// The name leg. The runner dispatches on `type || actionType || name`, so a
// row with no executor key whose `name` is `url` or `navigation` runs the url
// navigator; the rows judge its `target` by the same set, and the gate reports
// it at the same path. A `name` that names any other handler is untouched.

/** [row, the node for a given name and target, the finding's path, the refusal's subject for a `name`]. */
const NAME_LEG_ROWS: ReadonlyArray<readonly [string, (name: string, target: string) => AnyRec, string, (name: string) => string]> = [
  ['action:button', (name, target) => ({ type: 'action:button', properties: { label: 'Open', name, target } }),
    `${BASE}.target`, (name) => `An \`action:button\`'s \`target\` (\`name: '${name}'\` and no \`actionType\`, so the runner runs the url navigator)`],
  ['action:icon', (name, target) => ({ type: 'action:icon', properties: { label: 'Open', name, target } }),
    `${BASE}.target`, (name) => `An \`action:icon\`'s \`target\` (\`name: '${name}'\` and no \`actionType\`, so the runner runs the url navigator)`],
  ['action:group member', (name, target) => ({ type: 'action:group', properties: { actions: [{ label: 'Open', name, target }] } }),
    `${BASE}.actions.0.target`, (name) => `An \`action:group\` member's \`target\` (\`name: '${name}'\` and no \`type\`, so the runner runs the url navigator)`],
  ['action:menu member', (name, target) => ({ type: 'action:menu', properties: { actions: [{ label: 'Open', name, target }] } }),
    `${BASE}.actions.0.target`, (name) => `An \`action:menu\` member's \`target\` (\`name: '${name}'\` and no \`type\`, so the runner runs the url navigator)`],
];

describe("the props gate judges a name-leg row's `target` on the executor the runner runs", () => {
  it.each(NAME_LEG_ROWS)("REFUSAL: %s named `url` or `navigation`, with no executor key, is one finding at its `target`", (_row, node, path, subject) => {
    for (const name of ['url', 'navigation']) {
      const findings = validateComponentProps(stackWith(node(name, 'javascript:alert(1)')));
      expect(findings.map((f) => [f.rule, f.path]), name).toEqual([[COMPONENT_PROPS_INVALID, path]]);
      expect(findings[0].message, name).toContain(`${subject(name)}${JAVASCRIPT_REST}`);
    }
  });

  it.each(NAME_LEG_ROWS)('ACCEPTED CONTROL: %s named `url` with an admitted target reports nothing', (_row, node) => {
    expect(validateComponentProps(stackWith(node('url', 'https://example.com/docs')))).toEqual([]);
  });

  it.each(NAME_LEG_ROWS)('CONTROL: %s named after another handler reports nothing at its `target`', (_row, node) => {
    expect(validateComponentProps(stackWith(node('navigate_edit', 'convert_lead')))).toEqual([]);
  });
});

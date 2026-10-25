/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9108 - a node-gate predicate parked under `props` is REFUSED BY
 * NAME, loudly: not honoured, and not silently dropped.
 *
 * ## What was measured, and why it could not be seen
 *
 * A node may spell its config bag `properties` (the spec spelling) or `props`
 * (the annotated legacy alias). `SchemaRenderer`'s hoist copies `properties.*`
 * onto the node; nothing copies `props.*`. Both node gates read the post-hoist
 * node, so a predicate authored under the alias was never one of the keys
 * either gate could see:
 *
 * | authored                         | observed           |
 * |----------------------------------|--------------------|
 * | `props: { visible: false }`      | the node RENDERED  |
 * | `props: { hidden: true }`        | the node RENDERED  |
 * | `properties: { visible: false }` | correctly hidden   |
 * | `properties: { hidden: true }`   | correctly hidden   |
 *
 * Fail-OPEN and silent: a gate that never bit renders exactly like a gate that
 * said yes, so no user and no screenshot can find it.
 *
 * ## Which half of that this suite pins
 *
 * BOTH, and they are not the same assertion. The ruling of 2026-09-13 closed
 * the honour arm (PR objectui#9144) and ruled REFUSE, so:
 *
 *   - the VERDICT rows below must read exactly as the defect table above - the
 *     alias still gates nothing. A suite that only pinned the console line
 *     would go green on a tree that had quietly started honouring the alias,
 *     which is the arm the maintainer refused;
 *   - the REFUSAL rows must name the key on the console. A suite that only
 *     pinned the verdicts would go green on today's silence, which is the
 *     defect.
 *
 * ## Both polarities, one harness, in one file
 *
 * Every verdict row is measured in BOTH directions - a truthy predicate and a
 * falsy one - through the same probe in the same suite. A pair of EQUAL
 * verdicts is the signature of a gate that was never consulted, whichever way
 * it landed, and that pair is exactly what the `props` rows must still produce.
 * The `properties` rows are the live control: "the node is hidden" is equally
 * satisfied by a renderer that hides everything, by a broken registry, and by a
 * probe that never mounted, so the control has to run here rather than be
 * asserted elsewhere.
 *
 * ## Plain booleans on purpose
 *
 * objectui#9100 and objectui#9107 are about a CEL envelope being flattened on
 * the way to the engine. This defect is present with a plain boolean and no
 * expression anywhere, and it predates both repairs, so nothing here carries an
 * envelope: an envelope would make a failure ambiguous between the two causes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';
import { SchemaRendererContext } from '../context/SchemaRendererContext';
import {
  REFUSED_PROPS_PREDICATE_PREFIX,
  __resetRefusedPropsPredicateWarnings,
} from '../utils/propsBagDiagnostic';

/** A plain node type - nothing in this repo reads a config bag for it. */
const TYPE = 'probe-9108';

/**
 * A node type in the BAG-READING family. `readsPropsBag` keys on the
 * `element:` prefix, so this exercises the family carve-out without pulling
 * `@object-ui/components` into this package's test graph.
 */
const ELEMENT_TYPE = 'element:probe-9108';

/**
 * Reports what a `schema`-reading renderer can see, so one probe answers both
 * "did the gate bite?" and "was anything hoisted?".
 */
const Probe = (props: { schema?: Record<string, unknown>; disabled?: unknown }) => (
  <div
    data-testid="probe"
    // Whether the node carries the key at TOP LEVEL by the time a renderer is
    // handed it. This is what must NOT move: the refusal reads the alias bag to
    // report it, and copies nothing onto the node.
    data-node-visible={String(props.schema?.visible)}
    // The real `disabled` React prop the renderer receives.
    data-disabled={String(props.disabled === true)}
  />
);

function mount(schema: unknown) {
  return render(
    <SchemaRendererContext.Provider value={{ dataSource: {} } as never}>
      <SchemaRenderer schema={schema as never} />
    </SchemaRendererContext.Provider>,
  );
}

const rendered = (): boolean => screen.queryByTestId('probe') !== null;

/** One authored bag, mounted twice - predicate `true` then `false`. */
function pair(
  bag: 'props' | 'properties',
  key: string,
  type: string = TYPE,
): { truthy: boolean; falsy: boolean } {
  const once = (value: boolean): boolean => {
    mount({ type, [bag]: { [key]: value } });
    const r = rendered();
    cleanup();
    return r;
  };
  return { truthy: once(true), falsy: once(false) };
}

/**
 * Only the lines THIS card emits. `console.error` is a shared channel - React
 * and the schema validator both use it - so a spy read raw would pass on the
 * wrong line and fail on an unrelated one.
 */
let errorSpy: ReturnType<typeof vi.spyOn>;
const refusals = (): string[] =>
  errorSpy.mock.calls
    .map((args: unknown[]) => String(args[0]))
    .filter((line: string) => line.startsWith(REFUSED_PROPS_PREDICATE_PREFIX));

beforeEach(() => {
  ComponentRegistry.register(TYPE, Probe as never);
  ComponentRegistry.register(ELEMENT_TYPE, Probe as never);
  __resetRefusedPropsPredicateWarnings();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  cleanup();
  ComponentRegistry.unregister?.(TYPE);
  ComponentRegistry.unregister?.(ELEMENT_TYPE);
});

describe('objectui#9108 - the alias still gates NOTHING (the refused arm)', () => {
  // SHOW polarity. The `props` rows must produce a pair of EQUAL verdicts -
  // the signature of a gate that was never consulted. The `properties` rows
  // are the control and must still discriminate.
  it.each([
    ['visibleWhen'],
    ['visible'],
    ['visibleOn'],
  ] as const)('props.%s does not gate, properties.%s does', key => {
    expect(pair('props', key)).toEqual({ truthy: true, falsy: true });
    expect(pair('properties', key)).toEqual({ truthy: true, falsy: false });
  });

  // HIDE polarity - the opposite direction, and the reason a one-polarity
  // suite would have passed on half the defect.
  it.each([['hidden'], ['hiddenOn']] as const)(
    'props.%s does not gate, properties.%s does',
    key => {
      expect(pair('props', key)).toEqual({ truthy: true, falsy: true });
      expect(pair('properties', key)).toEqual({ truthy: false, falsy: true });
    },
  );

  // The enablement gate, same bag, quieter symptom: a greyed control is still
  // on screen. `disabled` under `props` reaches the element as a React prop and
  // is then overwritten by the gate's own `disabled`, which is `undefined`
  // because the gate never saw the key.
  it('props.disabled does not reach the enablement gate, properties.disabled does', () => {
    mount({ type: TYPE, props: { disabled: true } });
    expect(screen.getByTestId('probe').getAttribute('data-disabled')).toBe('false');
    cleanup();
    mount({ type: TYPE, properties: { disabled: true } });
    expect(screen.getByTestId('probe').getAttribute('data-disabled')).toBe('true');
  });

  // The fence the ruling is built on: the refusal READS the bag to report it.
  // If this row ever flips, the alias has been hoisted and the honour arm the
  // maintainer closed has come back in through a diagnostic.
  it('nothing is hoisted - `schema.visible` stays undefined for the renderer', () => {
    mount({ type: TYPE, props: { visible: true } });
    expect(screen.getByTestId('probe').getAttribute('data-node-visible')).toBe('undefined');
    cleanup();
    // The canonical spelling IS hoisted, as it always was - the control that
    // proves the assertion above is reading a real attribute.
    mount({ type: TYPE, properties: { visible: true } });
    expect(screen.getByTestId('probe').getAttribute('data-node-visible')).toBe('true');
  });
});

describe('objectui#9108 - and it is refused BY NAME, loudly', () => {
  it.each([
    ['visibleWhen'],
    ['visible'],
    ['visibleOn'],
    ['hidden'],
    ['hiddenOn'],
    ['disabled'],
    ['disabledOn'],
  ] as const)('props.%s is named on the console', key => {
    mount({ type: TYPE, id: 'n1', props: { [key]: true } });
    const lines = refusals();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`\`${key}\``);
    // The address, so the author can find the node rather than the key alone.
    expect(lines[0]).toContain(`\`${TYPE}\``);
    expect(lines[0]).toContain("id: 'n1'");
  });

  // The ruling requires the refusal to carry a NAMED MIGRATION LINE rather than
  // let half the keys quietly start working.
  it('carries the migration line, naming both spellings that do work', () => {
    mount({ type: TYPE, props: { visible: false } });
    const [line] = refusals();
    expect(line).toContain('MIGRATION:');
    expect(line).toContain('`properties`');
    expect(line).toContain('visibleWhen');
    expect(line).toContain('objectui#9108');
  });

  // Two keys in one bag are one authoring mistake and get one line naming both.
  it('names every parked key in one line', () => {
    mount({ type: TYPE, props: { visible: false, hiddenOn: true } });
    const [line] = refusals();
    expect(refusals()).toHaveLength(1);
    expect(line).toContain('`visible`');
    expect(line).toContain('`hiddenOn`');
  });

  // Both halves of the rate limit, together: a test that pins only the first
  // cannot tell a working dedupe from one that suppresses everything.
  it('reports once per distinct authoring bug, and a second bug still reports', () => {
    mount({ type: TYPE, props: { visible: false } });
    cleanup();
    mount({ type: TYPE, props: { visible: false } });
    expect(refusals()).toHaveLength(1);
    cleanup();
    mount({ type: TYPE, id: 'other', props: { hidden: true } });
    expect(refusals()).toHaveLength(2);
  });
});

describe('objectui#9108 - what the refusal must stay SILENT about', () => {
  it('the canonical spelling is not refused', () => {
    mount({ type: TYPE, properties: { visible: false } });
    expect(refusals()).toEqual([]);
  });

  // objectui#5123, maintainer ruling 2026-08-18: `properties` wins on both
  // channels, so a key BOTH bags declare is already answered canonically and
  // nothing is parked. Measured in both directions, so a suite that reported
  // nothing at all could not pass.
  it('a key BOTH bags declare is answered by `properties`, and not refused', () => {
    mount({ type: TYPE, props: { visible: true }, properties: { visible: false } });
    expect(rendered()).toBe(false);
    expect(refusals()).toEqual([]);
    cleanup();
    mount({ type: TYPE, props: { visible: false }, properties: { visible: true } });
    expect(rendered()).toBe(true);
    expect(refusals()).toEqual([]);
  });

  it('a non-predicate key under `props` is not this card\'s subject', () => {
    mount({ type: TYPE, props: { title: 'Customer Summary' } });
    expect(refusals()).toEqual([]);
  });

  // objectui#6752 / objectui#6760: a degenerate bag declares no key for either
  // spelling, and must not have its shape reinterpreted here either - the
  // refusal must not report nine keys named `0` … `8`.
  it('a degenerate `props` refuses nothing', () => {
    mount({ type: TYPE, props: 'not-a-bag' });
    expect(rendered()).toBe(true);
    expect(refusals()).toEqual([]);
  });

  // `enabled` is in PREDICATE_CHAIN_KEYS because the config-bag loops flatten
  // it, but no gate in SchemaRenderer consults it - the action renderers read
  // it one layer down and negate it. Refusing it here would state, of a key
  // this file never asks about, that a gate in this file could not see it.
  it('`enabled` is not a node-gate key and is not refused here', () => {
    mount({ type: TYPE, props: { enabled: false } });
    expect(refusals()).toEqual([]);
  });

  // Measured carve-out: `element:button` / `element:text-input` really do read
  // `props.disabled` out of the bag (`disabled={props.disabled || running}`),
  // so the author got the effect they asked for and a refusal would send them
  // looking for a defect that is not on their screen.
  it('`disabled` on a bag-reading node is honoured by the renderer, not refused', () => {
    mount({ type: ELEMENT_TYPE, props: { disabled: true } });
    expect(refusals()).toEqual([]);
  });

  // ...and the carve-out is exactly one key wide. Nothing in this repo reads a
  // visibility-chain key out of a config bag, so those rows stay refused on the
  // bag-reading family too - if this row ever goes silent, the carve-out has
  // widened from a measurement into a blanket.
  it('a visibility key on a bag-reading node is still refused', () => {
    mount({ type: ELEMENT_TYPE, props: { visible: false } });
    const lines = refusals();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('`visible`');
  });
});

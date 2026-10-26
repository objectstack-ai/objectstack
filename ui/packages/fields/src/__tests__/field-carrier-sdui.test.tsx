/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The SDUI path delivers field metadata on ONE key — objectui#3233.
 *
 * `SchemaRenderer` hands every registered component the authored node as
 * `schema`. That key is the universal SDUI contract (`element:*`, `page:*`,
 * `object-grid`, `ReportRenderer` …) and is NOT retired. What was retired is
 * `schema` on the *field-widget* contract: a widget used to receive the node
 * under `schema` here and the metadata under `field` from the form renderer,
 * which is why ~30 widgets resolved their config as `field || schema`.
 *
 * The translation now happens once, at the registration seam
 * (`withFieldCarrier`), so downstream `field` is the only carrier. That is only
 * correct if the node reaches the widget UNCHANGED — "swap the key, don't drop
 * the cargo". The first test proves it by OBJECT IDENTITY: a spy sits where the
 * registry entry sits, records the object `SchemaRenderer` passed as `schema`,
 * and the widget's `field` must be that exact object. (Identity against the
 * authored literal would be wrong to assert — `SchemaRenderer` shallow-copies
 * the node while evaluating expressions, so the object it delivers is its own.)
 *
 * The last test pins that the REAL registration path goes through the adapter
 * at all: an adapter nobody applied would leave every SDUI-hosted widget
 * reading `undefined`, which is exactly the silent failure this convergence is
 * accused of risking.
 *
 * The sibling half of the invariant — the form path through
 * `renderFieldComponent` — is pinned in `packages/components/src/renderers/
 * form/__tests__/form-field-carrier.test.tsx`.
 */

import React, { Suspense } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';

import { withFieldCarrier } from '../withFieldCarrier';
import { registerField } from '../index';
// Module scope, not a hook: `registerField('boolean')` registers
// `React.lazy(() => import('./widgets/BooleanField'))`, and under a saturated
// transform pipeline a first `import()` can outlive RTL's 1000ms budget. The
// specifier matches `fieldWidgetMap`'s exactly, so ESM's cache makes that
// factory resolve immediately (AGENTS.md 测试纪律 / objectui#3010).
import '../widgets/BooleanField';

/**
 * Capture holder, not bare module variables: `react-hooks/globals` forbids
 * REASSIGNING an outer binding from a component body, which is what a probe
 * has to do. Mutating a property of a stable object is the repo's usual shape
 * for this (see plugin-detail's `RelatedList` probes).
 */
const captured: { props: Record<string, any> | null; node: unknown } = {
  props: null,
  node: null,
};

function CarrierProbe(props: any) {
  captured.props = props;
  return <div data-testid="carrier-probe">{props.field?.label ?? 'NO FIELD'}</div>;
}

const AdaptedProbe = withFieldCarrier(CarrierProbe);

/**
 * Sits exactly where the registry entry sits, so it sees the host's props
 * verbatim, then forwards them to the adapter under test. This is what makes
 * the identity assertion possible: `captured.node` and the widget's `field`
 * are observed within a single render pass.
 */
function CarrierSpy(props: any) {
  captured.node = props.schema;
  return <AdaptedProbe {...props} />;
}

beforeEach(() => {
  captured.props = null;
  captured.node = null;
  ComponentRegistry.register('carrierprobe', CarrierSpy, {
    namespace: 'field',
    skipFallback: true,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SDUI path — the authored node arrives as `field` (objectui#3233)', () => {
  it('hands the widget the very object it used to read through `schema`', () => {
    const node = {
      type: 'field:carrierprobe',
      name: 'city',
      label: 'City',
      placeholder: 'Where?',
      options: [{ label: 'Beijing', value: 'bj' }],
    };

    render(<SchemaRenderer schema={node as any} />);

    expect(screen.getByTestId('carrier-probe')).toHaveTextContent('City');
    expect(captured.props).not.toBeNull();
    expect(captured.node).toBeTruthy();
    // The payload-equivalence proof: same object, by reference. A
    // reconstruction would still render "City" while quietly dropping whatever
    // the copy did not know to carry.
    expect(captured.props!.field).toBe(captured.node);
    // …and it really is the whole authored node, not a narrowed projection.
    expect(captured.props!.field.name).toBe('city');
    expect(captured.props!.field.placeholder).toBe('Where?');
    expect(captured.props!.field.options).toEqual([{ label: 'Beijing', value: 'bj' }]);
  });

  it('consumes `schema` rather than forwarding it to the widget', () => {
    // Key ABSENCE, not `undefined`. Two reasons it must not be forwarded: a
    // widget could resolve `field || schema` again (the second contract
    // survives in practice while the type claims it is gone), and widgets
    // spread their leftover props onto DOM nodes, where an object-valued
    // `schema` attribute is a React warning.
    render(
      <SchemaRenderer schema={{ type: 'field:carrierprobe', name: 'city', label: 'City' } as any} />,
    );

    expect(captured.props).not.toBeNull();
    expect('schema' in captured.props!).toBe(false);
  });

  it('lets an explicit `field` win when a host supplies both', () => {
    // The form renderer passes `field` (resolved metadata) and never `schema`.
    // If some host ever passed both, the resolved metadata is the better
    // answer — the raw node is the fallback, not the override.
    const node = { type: 'field:carrierprobe', name: 'from-node', label: 'From node' };
    const metadata = { name: 'from-field', label: 'From field' };

    render(<AdaptedProbe schema={node} field={metadata} />);

    expect(captured.props!.field).toBe(metadata);
  });

  it('applies the adapter on the REAL registration path (`registerField`)', async () => {
    // The seam is only worth anything if `registerField` goes through it.
    // `BooleanField` reads `widget` / `name` off its metadata carrier and
    // nowhere else: `widget: 'checkbox'` selects the Checkbox over the Switch,
    // and `name` becomes the control's id. Both are node keys, so seeing them
    // honoured here proves the node reached `field` end to end — through the
    // real registry entry, the real SchemaRenderer, and the real widget.
    registerField('boolean');

    render(
      <Suspense fallback={<div>loading</div>}>
        <SchemaRenderer
          schema={
            { type: 'field:boolean', name: 'is_active', label: 'Active', widget: 'checkbox' } as any
          }
        />
      </Suspense>,
    );

    const control = await screen.findByRole('checkbox');
    expect(control).toHaveAttribute('id', 'is_active');
  });
});

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `requiresObject`: the gate draws the "no object named" hint in place of the
 * block when the placement opted in and names its object in neither place —
 * objectui#11605.
 *
 * The object-bound registrations stopped declaring their object key
 * `required`, because the binding can supply it, so the page compile accepts a
 * node that names no object at all. This hint is the answer for that node.
 * The rows below hold the three things the gate decides: it reads the key AFTER
 * the binding lands (a bound node is never told it names no object), it reads
 * the MAPPING's key (not a hard-wired `objectName`), and it does nothing unless
 * the call site opted in.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import * as React from 'react';
import { ElementDataSourceGate, type ElementDataSourceMapping } from '../ElementDataSourceGate';

const makeAdapter = () => ({
  find: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({ name: 'account', listViews: {} }),
});

function Block({ schema }: { schema: unknown }) {
  return <div data-testid="block">{JSON.stringify(schema)}</div>;
}

const renderGate = (
  schema: Record<string, unknown>,
  { requiresObject, mapping }: { requiresObject?: boolean; mapping?: ElementDataSourceMapping } = {},
) =>
  render(
    <ElementDataSourceGate
      schema={schema}
      mapping={mapping}
      dataSource={makeAdapter()}
      testId="probe"
      requiresObject={requiresObject}
    >
      {(bound) => <Block schema={bound} />}
    </ElementDataSourceGate>,
  );

describe('ElementDataSourceGate — requiresObject (objectui#11605)', () => {
  it('a placement that opted in and names no object draws the hint, naming the key, instead of the block', () => {
    const { queryByTestId, getByTestId } = renderGate({ type: 'probe' }, { requiresObject: true });
    expect(queryByTestId('block')).toBeNull();
    expect(getByTestId('probe-no-object').textContent).toBe(
      'No object named: set objectName or dataSource.object.',
    );
  });

  it('a blank object name names nothing', () => {
    const { queryByTestId } = renderGate({ type: 'probe', objectName: '  ' }, { requiresObject: true });
    expect(queryByTestId('probe-no-object')).not.toBeNull();
  });

  it('control: the node names its object on its own key, so the block renders', () => {
    const { queryByTestId } = renderGate({ type: 'probe', objectName: 'account' }, { requiresObject: true });
    expect(queryByTestId('probe-no-object')).toBeNull();
    expect(queryByTestId('block')).not.toBeNull();
  });

  it('control: the binding names the object and the gate lands it before the check, so the block renders', async () => {
    const { queryByTestId, findByTestId } = renderGate(
      { type: 'probe', dataSource: { object: 'account' } },
      { requiresObject: true },
    );
    const block = await findByTestId('block');
    expect(queryByTestId('probe-no-object')).toBeNull();
    expect(JSON.parse(block.textContent ?? '{}').objectName).toBe('account');
  });

  it('control: without the opt-in the block renders, as before', () => {
    const { queryByTestId } = renderGate({ type: 'probe' });
    expect(queryByTestId('probe-no-object')).toBeNull();
    expect(queryByTestId('block')).not.toBeNull();
  });

  it('the hint names the MAPPING\'s object key', () => {
    const { getByTestId } = renderGate(
      { type: 'probe' },
      { requiresObject: true, mapping: { object: 'childObject' } },
    );
    expect(getByTestId('probe-no-object').textContent).toBe(
      'No object named: set childObject or dataSource.object.',
    );
  });

  it('a mapping that lands no object key never draws the hint', () => {
    const { queryByTestId } = renderGate({ type: 'probe' }, { requiresObject: true, mapping: { object: false } });
    expect(queryByTestId('probe-no-object')).toBeNull();
    expect(queryByTestId('block')).not.toBeNull();
  });
});

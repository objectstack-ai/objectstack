/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#25926 — `visibleOn` / `hiddenOn` / `disabledOn` are no longer
 * legs of `SchemaRenderer`'s node gates.
 *
 * The three were objectui-only spellings of `visibleWhen` / `hidden` /
 * `disabled`; `@objectstack/spec` declares `visibleWhen` as the one
 * conditional-visibility predicate at every layer (ADR-0089) and no `*On`
 * suffix on a node. They are `?: never` tombstones on `BaseSchema`, refused by
 * name on the zod mirror and by `objectui validate`. This file pins what the
 * RENDERER does with a document that reached it unvalidated and still carries
 * one: the key is NOT consulted (the node renders, the control stays usable)
 * and it does NOT leak into the component's props as an unknown DOM attribute.
 *
 * Every case has a CONTROL on the surviving spelling with the same value, so
 * "not consulted" cannot be mistaken for "the gate is broken".
 *
 * ## Reverse verification (direction predicted before running)
 *
 * The legs are hand-written `if` blocks in `SchemaRenderer`'s `shouldHide` /
 * `isDisabled` memos (the `VISIBILITY_*_KEYS` lists only drive the
 * diagnostics). Restoring a `visibleOn` leg after the `visible` one — one
 * line, `if (schema.visibleOn !== undefined) return !evaluate(schema.visibleOn)`
 * — turns the first case RED (the node vanishes); a `hiddenOn` leg after
 * `hidden` turns the second and third RED; a `disabledOn` leg after `disabled`
 * turns the fourth RED. The leak cases go RED if the keys leave the strip list
 * in the props destructure. The controls stay GREEN in every direction.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { BaseSchema, DataSource } from '@object-ui/types';
import { SchemaRenderer } from '../SchemaRenderer';
import { SchemaRendererContext } from '../context/SchemaRendererContext';
import { PredicateScopeProvider } from '../hooks/useExpression';
import { __resetVisibilityPredicateWarnings } from '../utils/visibilityDiagnostic';

declare module '@object-ui/types' {
  interface CustomNodeRegistry {
    'probe-25926': BaseSchema;
  }
}

const RETIRED = ['visibleOn', 'hiddenOn', 'disabledOn'] as const;

/**
 * Records the `disabled` prop and whether any retired key reached the props
 * bag, so "rendered", "not disabled" and "did not leak" are separate readings.
 */
const Probe = (props: Record<string, unknown>) => (
  <div
    data-testid="probe"
    data-disabled-prop={props.disabled === undefined ? 'absent' : String(props.disabled)}
    data-leaked={RETIRED.filter((k) => k in props).join(',') || 'none'}
  />
);

const DATA = { status: 'draft', archived: true };

function renderNode(schema: Record<string, unknown>) {
  return render(
    <PredicateScopeProvider scope={{ data: DATA }}>
      <SchemaRendererContext.Provider value={{ dataSource: DATA as unknown as DataSource }}>
        <SchemaRenderer schema={{ type: 'probe-25926', ...schema } as never} />
      </SchemaRendererContext.Provider>
    </PredicateScopeProvider>,
  );
}

const rendered = () => screen.queryByTestId('probe') !== null;
const attr = (name: string) => screen.getByTestId('probe').getAttribute(name);

describe('SchemaRenderer — the retired `visibleOn` / `hiddenOn` / `disabledOn` spellings are not consulted (objectstack#25926)', () => {
  beforeEach(() => {
    __resetVisibilityPredicateWarnings();
    ComponentRegistry.register('probe-25926', Probe as never);
  });
  afterEach(() => {
    cleanup();
    ComponentRegistry.unregister?.('probe-25926');
  });

  it('`visibleOn: "false"` is not a SHOW leg — the node renders; CONTROL `visibleWhen: "false"` hides it', () => {
    renderNode({ visibleOn: 'false' });
    expect(rendered()).toBe(true);
    cleanup();
    renderNode({ visibleWhen: 'false' });
    expect(rendered()).toBe(false);
  });

  it('`hiddenOn: true` is not a HIDE leg — the node renders; CONTROL `hidden: true` hides it', () => {
    renderNode({ hiddenOn: true });
    expect(rendered()).toBe(true);
    cleanup();
    renderNode({ hidden: true });
    expect(rendered()).toBe(false);
  });

  it('`hiddenOn: "data.archived"` (a predicate that holds) is not a HIDE leg either; CONTROL `hidden` with the same source hides', () => {
    renderNode({ hiddenOn: 'data.archived' });
    expect(rendered()).toBe(true);
    cleanup();
    renderNode({ hidden: 'data.archived' });
    expect(rendered()).toBe(false);
  });

  it('`disabledOn: true` is not an enablement leg — no `disabled` prop; CONTROL `disabled: true` forwards `disabled`', () => {
    renderNode({ disabledOn: true });
    expect(attr('data-disabled-prop')).toBe('absent');
    cleanup();
    renderNode({ disabled: true });
    expect(attr('data-disabled-prop')).toBe('true');
  });

  it.each(RETIRED)('a stale `%s` is stripped before the props bag — it never reaches the component', (key) => {
    renderNode({ [key]: 'data.status' });
    expect(attr('data-leaked')).toBe('none');
  });
});

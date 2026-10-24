/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7867 (ruling A, maintainer 「其他同意」 2026-09-20): an action's
 * `params` values are templates, evaluated where `properties` are.
 *
 * Every string leaf of a node's `properties.params` bag, at any depth, is
 * template-evaluated in the `SchemaRenderer` evaluation memo. Before this, CASE
 * B below reached the handler as the raw `${record.id}` text, so a
 * metadata-authored `navigate_edit` button could not name the record it sits on.
 *
 * objectui#10289 (ruling A) narrowed where the values live: an action's
 * `params` is only the `ActionParam[]` input list, so `action:button` reads
 * static values from `properties.params` alone. CASE A (a node-level `params`
 * OBJECT) is therefore pinned as NOT reaching the handler; the full contract is
 * pinned in `action-params-properties-10289.test.tsx`.
 *
 * Driven end to end through the REAL pieces, which is why this pin lives in
 * `@object-ui/components` rather than beside `SchemaRenderer` (that package
 * deliberately does not depend on this one): the real `SchemaRenderer` renders
 * the real `action:button`, the click goes through the real `ActionRunner`, and
 * the value asserted is read off the `ActionDef` the registered handler was
 * handed - the same seat `AppContent` registers `navigate_edit` in. The row is
 * bound the way a record page binds it, through `RecordContextProvider`.
 *
 * The CONTROL (`properties.label`) is the lit instrument: it resolved before
 * this change as well, so a red CASE with a green CONTROL can only mean the
 * `params` leg, never an unbound `record` root.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { ActionContext, ActionDef, ActionResult } from '@object-ui/core';
import type { PublicBlockNodeOf } from '@object-ui/types';
import { undeclaredNode } from '@object-ui/test-support';
import { ActionProvider, RecordContextProvider, SchemaRenderer } from '@object-ui/react';
// Module-scope side-effect import so `action:button` is registered before the
// first render - the light `dom` project does not load the components graph.
// Module scope, not a `beforeAll`, per AGENTS.md 测试纪律.
import '../action-button';

const ROW = { id: 'rec_1', name: 'Acme' };

let navigateEdit: Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  navigateEdit = vi.fn(async () => ({ success: true }));
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

/**
 * Render `schema` on a record page bound to {@link ROW}.
 *
 * Typed as the `action:button` node (objectui#11364, the arm's input: executor
 * keys in the `properties` bag, objectui#11183), so a literal below is checked
 * against the spec's spelling. CASE A's node-level `params` is the one spelling
 * that node refuses on purpose, and it crosses through the one test helper for
 * undeclared input (objectui#11466).
 */
function renderOnRecordPage(schema: PublicBlockNodeOf<'action:button'>) {
  return render(
    <ActionProvider handlers={{ navigate_edit: navigateEdit }}>
      <RecordContextProvider objectName="account" recordId={ROW.id} data={ROW}>
        <SchemaRenderer schema={schema} />
      </RecordContextProvider>
    </ActionProvider>,
  );
}

/** Click the one button and return the `params` the handler received. */
async function paramsReceived(label: string): Promise<Record<string, any>> {
  fireEvent.click(screen.getByRole('button', { name: label }));
  await waitFor(() => expect(navigateEdit).toHaveBeenCalledTimes(1));
  const def = navigateEdit.mock.calls[0][0] as ActionDef;
  return def.params as Record<string, any>;
}

describe('objectui#7867 - `params` values are templates, evaluated where `properties` are', () => {
  it('CONTROL: `properties.label` still resolves against the bound record', () => {
    renderOnRecordPage({
      type: 'action:button',
      properties: { label: 'L-${record.id}', actionType: 'navigate_edit' },
    });
    expect(screen.getByRole('button', { name: 'L-rec_1' })).toBeInTheDocument();
  });

  it('CASE A: a node-level `params` OBJECT is not a values channel (objectui#10289)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // The node-level `params` object is the probe: it is the spelling this
      // case proves is NOT read, so it stays on the node.
      renderOnRecordPage(undeclaredNode({
        type: 'action:button',
        properties: { label: 'Edit', actionType: 'navigate_edit' },
        params: { objectName: 'account', recordId: '${record.id}' },
      }));
      const params = await paramsReceived('Edit');
      expect(params).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it('CASE B: `properties.params.recordId` resolves to the bound record id', async () => {
    renderOnRecordPage({
      type: 'action:button',
      properties: { label: 'Edit', actionType: 'navigate_edit', params: { objectName: 'account', recordId: '${record.id}' } },
    });
    const params = await paramsReceived('Edit');
    expect(params.recordId).toBe('rec_1');
    expect(params.objectName).toBe('account');
  });

  it('a template two levels down resolves, inside objects and inside arrays', async () => {
    renderOnRecordPage({
      type: 'action:button',
      properties: {
        label: 'Edit',
        actionType: 'navigate_edit',
        params: {
          target: { record: { id: '${record.id}' } },
          ids: ['${record.id}', 'literal'],
          caption: 'Edit ${record.name}',
        },
      },
    });
    const params = await paramsReceived('Edit');
    expect(params.target.record.id).toBe('rec_1');
    expect(params.ids).toEqual(['rec_1', 'literal']);
    expect(params.caption).toBe('Edit Acme');
  });

  it('an unresolvable template stays loud: raw at the handler, and reported by the dev diagnostic', async () => {
    renderOnRecordPage({
      type: 'action:button',
      properties: { label: 'Edit', actionType: 'navigate_edit', params: { recordId: '${nope.id}' } },
    });
    const params = await paramsReceived('Edit');
    // The evaluator hands an expression that throws back as its own source, so
    // the verdict an author can see is unchanged: the raw text.
    expect(params.recordId).toBe('${nope.id}');
    // ... and the unevaluated-expression diagnostic names the leaf by its path.
    const reports = consoleError.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .filter((m: string) => m.includes('properties.params.recordId'));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain('${nope.id}');
  });
});

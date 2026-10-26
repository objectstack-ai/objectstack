/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:quick_actions` — the registered `actionNames` description describes
 * what the renderer does (objectui#4663).
 *
 * The registry `inputs` ARE the published authoring surface: `gen-manifest.ts`
 * serializes them into `sdui.manifest.json` and the JSX authoring types, and
 * Studio tooling teaches authors from these sentences. The `actionNames`
 * description promised a fallback that exists on no path —
 *
 *   > 'Action names to expose, in order (else every action declared for the
 *   >  object at this location)'
 *
 * — and it was believed: objectstack#8744's dispatch prompt quoted it verbatim
 * as a declared input, and this is the clause that failed verification there.
 *
 * The measured chain, which the first two cases drive for real rather than
 * restate: no `actionNames` and no host `actions` → `namesToResolve` is empty →
 * `needsLookup` is false → the object metadata is NEVER queried → `actions` is
 * `[]` → the dashed placeholder renders (on a design / preview surface; a
 * runtime view draws nothing, objectui#12995). Per the triage ruling on #4663 the
 * fallback is a behaviour EXPANSION and is not being implemented here, so the
 * sentence is what changes; these cases are what stops it drifting back into a
 * promise.
 *
 * The metadata provider below is deliberately LOADED — it declares an action at
 * this very location — so "the bar stayed empty" cannot be an artefact of a
 * provider that had nothing to give. The control case proves the same wiring
 * delivers that action the moment a name asks for it.
 */

import * as React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { MetadataCtx, PreviewModeProvider, RecordContextProvider } from '@object-ui/react';
import type { MetadataContextValue } from '@object-ui/react';
import { RecordQuickActionsRenderer } from '../renderers/record-quick-actions';
import '../index';

/** Declared on the object, at the location this bar renders by default. */
const APPROVE = {
  name: 'approve',
  label: 'Approve',
  type: 'script',
  locations: ['record_header'],
};

const OBJECT_META = { name: 'crm_account', actions: [APPROVE] };

const getItem = vi.fn(async (type: string, name: string) =>
  type === 'object' && name === 'crm_account' ? OBJECT_META : null,
);

/**
 * A hand-rolled context value, held at MODULE level on purpose: `getItem` is an
 * effect dependency of `useMetadataItem`, so a value rebuilt per render spins
 * that hook forever (the loop `NO_METADATA_PROVIDER` was frozen to fix).
 */
const METADATA: MetadataContextValue = {
  apps: [],
  objects: [OBJECT_META] as any,
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: getItem as unknown as MetadataContextValue['getItem'],
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
};

function mount(schema: Record<string, unknown>, opts: { preview?: boolean } = {}) {
  const tree = (
    <MetadataCtx.Provider value={METADATA}>
      <RecordContextProvider objectName="crm_account" recordId="rec-1" data={{ id: 'rec-1' }}>
        <RecordQuickActionsRenderer schema={schema as any} />
      </RecordContextProvider>
    </MetadataCtx.Provider>
  );
  return render(opts.preview ? <PreviewModeProvider>{tree}</PreviewModeProvider> : tree);
}

const actionNamesInput = () =>
  (ComponentRegistry.getConfig('record:quick_actions')?.inputs ?? []).find(
    (i) => i.name === 'actionNames',
  );

beforeEach(() => getItem.mockClear());

describe('record:quick_actions — `actionNames` description vs measured behaviour (objectui#4663)', () => {
  it('with no `actionNames` and no host `actions`, the object\'s declared actions are NOT pulled in', async () => {
    // On a preview surface, where the empty placeholder is drawn (objectui#12995).
    mount({}, { preview: true });

    // The bar's empty state, not the object's action.
    expect(await screen.findByText(/no actions configured/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    // …and the reason: nothing ever asked the metadata layer. This is the exact
    // step the promised "else every action declared for the object" fallback
    // would have had to take.
    expect(getItem).not.toHaveBeenCalled();
  });

  it('names the actions and the same wiring resolves them (control)', async () => {
    mount({ actionNames: ['approve'] });

    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(getItem).toHaveBeenCalledWith('object', 'crm_account');
  });

  it('the published description does not promise the fallback the renderer lacks', () => {
    const description = actionNamesInput()?.description ?? '';
    expect(description).not.toBe('');
    // The removed claim, named exactly as it was published.
    expect(description).not.toMatch(/every action declared/i);
    // …replaced by the measured outcome of case 1, so an author reading the
    // manifest learns what actually happens when the input is left off.
    expect(description).toMatch(/empty placeholder/i);
  });
});

// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The generic condition mount advertises the roots ITS OWN metadata type's
 * evaluator binds — objectui#9856, the polymorphic mount the curated
 * declaration could not be copied onto.
 *
 * ## The defect these cases reproduce
 *
 * `SchemaForm` routes every predicate-named field to one widget, so one mount
 * serves every metadata type. objectui#8167 gave that mount the host's LINT
 * scope and objectui#9953 gave it the host's SUBJECT vocabulary; the third
 * question — what the raw editor's autocomplete may OFFER — still had no
 * channel. So an `action` edited through the generic form inherited the
 * `scope="record"` default `RECORD_CONDITION_ROOTS`, the set every host of a
 * record-scoped condition binds, while its own host is the browser, where
 * `buildExpressionScope` binds more. The same loss as the curated mounts, one
 * route over.
 *
 * ## Why this is a DERIVATION and not a third literal
 *
 * The two curated action mounts can name the list because they serve one tier.
 * This mount serves every tier, and the two arms disagree: the same value would
 * be right for an action and would hand a hook's author roots its server host
 * never binds — re-opening the trap objectui#9645 closed. So the answer comes
 * from `CONDITION_HOST_BY_METADATA_TYPE`, the one place the client/server
 * verdict is ruled, through `conditionRootsForMetadataType`.
 *
 * ## Read through the WIRING, not from the helper
 *
 * The two rendered cases feed the derivation's own answer to the real widget
 * and read the real suggestion menu. Asserting on `conditionRootsForMetadataType`
 * alone would leave the JSX free to drop the prop with every case still green —
 * the forwarding is half of what is under test.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Module-scope import of the CEL engine, per AGENTS.md's flaky-test rule: the
// scope introspection runs behind a dynamic `import('@objectstack/formula')`
// inside `celAuthoring`, and a cold first load has been measured near a
// `waitFor`'s whole budget. The specifier must match `loadFormula`'s exactly —
// ESM caches by resolved specifier.
import '@objectstack/formula';

// `ConditionBuilder` calls `useObjectFields` unconditionally (objectui#4697),
// so an unmocked client would let a mount-time fetch escape to the real network.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]) },
}));
vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return { ...mod, useMetadataClient: () => state.metadataClient };
});

import { SchemaForm } from './SchemaForm';
import type { WidgetContext } from './widgets';
import {
  CONDITION_HOST_BY_METADATA_TYPE,
  conditionRootsForMetadataType,
} from './conditionScope';
import { CLIENT_CONDITION_ROOTS } from './inspectors/ConditionBuilder';

afterEach(cleanup);

/** A schema whose one field is routed to the condition widget BY NAME. */
const SCHEMA = {
  type: 'object',
  properties: { condition: { type: 'string', title: 'Run only when' } },
} as never;

function Harness({ context }: { context: WidgetContext }) {
  const [value, setValue] = React.useState<Record<string, unknown>>({ condition: '' });
  return (
    <SchemaForm
      schema={SCHEMA}
      value={value}
      onChange={(next) => setValue(next as Record<string, unknown>)}
      widgetContext={context}
    />
  );
}

/** The LABEL of each open suggestion — the first span; the second is its kind tag. */
function offeredLabels(): string[] {
  return screen
    .queryAllByRole('option')
    .map((o) => (o.querySelector('span')?.textContent ?? '').trim());
}

/**
 * Mount the generic form with `roots`, warm the suggestion machinery, and read
 * what it offers for `prefix`.
 *
 * ⚠️ The warm-up is load-bearing: the identifier catalog arrives
 * asynchronously, and a menu that has not opened YET offers nothing — which
 * would satisfy the "is not offered" case below no matter what the widget
 * forwards. `record` is offered on both arms, so completing it begs no question.
 */
async function offeredAtGenericMount(
  roots: string[] | undefined,
  prefix: string,
): Promise<string[]> {
  // One mount per reading: a case that takes two readings would otherwise leave
  // two forms on screen and every `byRole` query would match both.
  cleanup();
  const user = userEvent.setup();
  render(<Harness context={{ conditionScope: 'record', conditionRoots: roots }} />);
  const group = await screen.findByRole('group', { name: /Run only when/ });
  fireEvent.click(within(group).getByText('Expression'));
  const box = within(group)
    .getAllByRole('combobox')
    .find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
  await user.click(box);
  await user.type(box, 'rec');
  expect(await screen.findByRole('option', { name: /record/ }, { timeout: 4000 })).toBeTruthy();
  await user.clear(box);
  await user.type(box, prefix);
  return offeredLabels();
}

/* ── The two arms, both fed the derivation's own answer ────────────────── */

describe('the generic condition mount, editing a CLIENT-evaluated type (objectui#9856)', () => {
  it('offers the roots only a browser host binds', async () => {
    // THE GATE. `conditionRootsForMetadataType('action')` is what
    // `ResourceEditPage` hands this widget for that type, so this case fails if
    // the derivation stops answering, if the widget stops forwarding, or if the
    // list stops carrying what the browser evaluator binds.
    const offered = await offeredAtGenericMount(conditionRootsForMetadataType('action'), 'o');
    expect(offered).toContain('os');
  });

  it('does NOT offer them for a server-evaluated type — the narrowing stays put', async () => {
    // The must-not-widen half, and the reason this member could not have been
    // one value for the whole mount. `undefined` is what the derivation hands
    // back for `hook`, and it leaves `ConditionBuilder`'s record-scoped default
    // exactly where objectui#9645 put it.
    const offered = await offeredAtGenericMount(conditionRootsForMetadataType('hook'), 'o');
    expect(offered).not.toContain('os');
    // Non-vacuity: this arm still completes SOMETHING, so the case above is not
    // passing against a menu that simply never opened.
    expect(await offeredAtGenericMount(conditionRootsForMetadataType('hook'), 'rec'))
      .toContain('record');
  });
});

/* ── The seam between the table and the list ───────────────────────────── */

describe('conditionRootsForMetadataType — derived from the ruled host table (objectui#9856)', () => {
  it('answers with the advertised list itself for every client-evaluated type', () => {
    // Identity, and over the TABLE rather than over one type: a `client` row
    // added tomorrow is covered the day it lands.
    const clientTypes = Object.entries(CONDITION_HOST_BY_METADATA_TYPE)
      .filter(([, host]) => host === 'client')
      .map(([type]) => type);
    expect(clientTypes.length).toBeGreaterThan(0);
    for (const type of clientTypes) {
      expect(conditionRootsForMetadataType(type)).toBe(CLIENT_CONDITION_ROOTS);
    }
  });

  it('declares nothing for every type that is not client-evaluated', () => {
    // Including the unmeasured ones, which is the arm that keeps a tier nobody
    // has put to an evaluator exactly as it was rather than widened on a guess.
    for (const [type, host] of Object.entries(CONDITION_HOST_BY_METADATA_TYPE)) {
      if (host === 'client') continue;
      expect(conditionRootsForMetadataType(type)).toBeUndefined();
    }
    expect(conditionRootsForMetadataType('flow')).toBeUndefined();
    expect(conditionRootsForMetadataType('a-type-this-build-never-heard-of')).toBeUndefined();
  });
});

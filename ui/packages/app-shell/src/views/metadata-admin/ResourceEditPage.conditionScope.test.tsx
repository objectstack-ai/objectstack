// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The generic editor really DERIVES its condition scope from the metadata type
 * it is editing — objectui#8167, the production edge, witnessed.
 *
 * ## Why this file exists at all
 *
 * `ConditionWidget.conditionScope.test.tsx` pins two halves and leaves the seam
 * between them unobserved:
 *
 *   • the WIDGET honours a `conditionScope` it is handed (driven with a
 *     hand-built `WidgetContext`), and
 *   • the TABLE holds the ruled verdict for each tier (read through
 *     `conditionScopeForMetadataType`).
 *
 * Neither one watches the line that JOINS them — `ResourceEditPage`'s
 * `conditionScope: conditionScopeForMetadataType(type)`. A hard-coded
 * `'flattened'` there would compile and leave every one of those cases green,
 * because none of them mounts the host. That is this card's own defect one
 * layer up: a verdict nothing honours, with nothing to notice.
 *
 * So this case mounts the REAL host and reads the REAL engine's answer at the
 * far end. The only stand-ins are the metadata client and the type registry —
 * the network and the server's schema row, which are nobody's contract here.
 * Everything between the host and the verdict is production code: the real
 * derivation, the real `WidgetContext`, the real `SchemaForm` routing by name
 * convention, the real `ConditionWidget`, the real `ConditionBuilder`, and the
 * real `@objectstack/formula`.
 *
 * ## Why a hook
 *
 * `hook`'s ruled verdict is `record`, and it is a type this host renders
 * through its GENERIC form: `hook` has no registered preview, so
 * `ResourceEditPage` takes its plain-form branch — the branch that hands the
 * derived `WidgetContext` to `SchemaForm`. The curated `HookDefaultInspector`
 * (which landed the same verdict at its own mount in objectui#9643) lives on
 * the canvas branch and is not what runs here.
 *
 * ⚠️ Its server schema row is a fixture. That is the honest part to name: this
 * case pins the DERIVATION, not which keys a hook's published schema carries.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Module-scope import of the CEL engine, per AGENTS.md's flaky-test rule: the
// lint runs behind a dynamic `import('@objectstack/formula')` inside
// `celAuthoring`, and a cold first load has been measured near a `waitFor`'s
// whole budget. The specifier must match `loadFormula`'s exactly.
import '@objectstack/formula';

/** The bare shorthand the card is about: retired, and clean under `flattened`. */
const BARE = "status == 'done'";
/** Its canonical twin — the must-not-break half of every narrowing. */
const CANONICAL = "record.status == 'done'";

const HOOK = {
  name: 'stamp',
  label: 'Stamp',
  object: 'invoice',
  events: ['beforeInsert'],
  condition: '',
};

/** The server's `/meta/types` row for `hook`, reduced to what this case reads. */
const HOOK_ENTRY = {
  type: 'hook',
  name: 'hook',
  label: 'Hook',
  // What makes the item writable, and therefore what makes an Edit button exist.
  allowEnvironmentOverlay: true,
  schema: {
    type: 'object',
    properties: {
      label: { type: 'string', title: 'Label' },
      // Routed to the condition widget BY NAME — `condition` is in
      // `SchemaForm`'s `CONDITION_FIELD_NAMES`.
      condition: { type: 'string', title: 'Run only when' },
    },
  },
};

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: HOOK, code: HOOK, editable: true })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => null),
  saveDraft: vi.fn(async () => ({})),
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ entries: [HOOK_ENTRY] }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
// The load-time registrations, exactly as the package entry runs them, so the
// branch this case takes is the branch production takes.
import './register-builtins';
// The built-in designers, which the package entry registers from a chunk it
// loads with a dynamic `import()` (objectui#11939 step 2): called here, at
// module scope, so they are registered before the first render.
import { registerBuiltinDesigners } from './register-builtin-designers';
registerBuiltinDesigners();

afterEach(cleanup);

/** Open the hook editor, enter edit mode, and switch its condition to raw CEL. */
async function openHookCondition(): Promise<HTMLTextAreaElement> {
  render(
    <MemoryRouter initialEntries={['/metadata/hook/stamp']}>
      <MetadataResourceEditPage type="hook" name="stamp" />
    </MemoryRouter>,
  );
  // The host renders an Edit affordance twice (page header and toolbar); either
  // enters edit mode, and WHICH one is not this case's subject.
  fireEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]);
  fireEvent.click(await screen.findByText('Expression'));
  return screen
    .getAllByRole('combobox')
    .find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
}

describe('MetadataResourceEditPage — the condition scope is DERIVED from the type on screen (objectui#8167)', () => {
  it("rejects the bare shorthand on a hook's condition and names the record.<field> fix", async () => {
    // The whole chain, with nothing hand-fed in the middle: the host looks the
    // type up in the ruled table, puts the answer on the `WidgetContext`,
    // `SchemaForm` routes `condition` to the widget by name, the widget passes
    // the verdict to the builder, and the engine answers in that scope.
    //
    // ⇒ this case reddens if ANY link stops carrying it — including the one
    // nothing else watches: hard-coding a scope at the derivation would leave
    // every other case in this card green and fail here.
    const box = await openHookCondition();
    fireEvent.change(box, { target: { value: BARE } });
    await waitFor(() => expect(box.getAttribute('aria-invalid')).toBe('true'), { timeout: 4000 });
    expect(await screen.findByText(/record\.status/, {}, { timeout: 4000 })).toBeTruthy();
  });

  it("still accepts the canonical spelling on a hook's condition", async () => {
    // The other half of a narrowing: the author sent to `record.status` must
    // find it accepted. Also the control that keeps the case above honest — an
    // editor that rejected everything would pass the first case for free.
    const box = await openHookCondition();
    fireEvent.change(box, { target: { value: CANONICAL } });
    expect(await screen.findByText('Valid CEL', {}, { timeout: 4000 })).toBeTruthy();
    expect(box.getAttribute('aria-invalid')).not.toBe('true');
  });
});

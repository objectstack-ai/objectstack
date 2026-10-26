// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7234 — the author-facing channel for the `requiredPermissions` hide.
 *
 * ## What this pins, and why it is a channel rather than a fix
 *
 * The card was opened as "object-bound actions never render". That premise was
 * falsified and the falsification is pinned by
 * `ObjectView.objectBoundActions-7234.test.tsx`: the relay carries
 * `objectDef.actions`, the button IS drawn, and ADR-0066 D4's
 * `requiredPermissions` capability gate is what hides it — at every declared
 * location at once, with no error and no 4xx.
 *
 * The maintainer ruled option B on 2026-09-08: the hide STAYS for end users,
 * and the reason becomes visible where the person who configures the app looks.
 * So there is nothing to fix in the gate, and these cases are not about the
 * gate's verdict at all. They pin that the action designer — the panel pair the
 * console docs name as where an object's `actions[]` are configured — states
 * the reason.
 *
 * ## The two halves are deliberately different, and that is the point
 *
 * • The INSPECTOR reads the live held set (`usePermissions`, the same signal
 *   `useCanAuthorMetadata` consumes) and can therefore answer the reported
 *   complaint in the first person: "I configured the buttons and I see none of
 *   them." Cases C/D are one differential — identical draft, identical code
 *   path, only the held set differs.
 * • The PREVIEW is declaration-side only. It renders a draft, not a session,
 *   and its "Where it appears" frames draw the button in every declared
 *   location; before this change that was an unqualified promise, which is the
 *   shape `PlacementPreview`'s own `global_nav` note rules against.
 *
 * ## Paired assertions
 *
 * Every "the notice appears" case is paired with a control over an action that
 * declares NO `requiredPermissions`, so deleting the notice outright cannot
 * turn a negative pin green for the wrong reason. Case F additionally asserts
 * the placement frames still render in the same tree that carries the notice:
 * the notice is an addition, and nothing was traded away for it.
 *
 * ⛔ The end-user side is pinned elsewhere, in the file named above: ruling
 * part (a) is that NOTHING changes there, and a notice leaking into a running
 * app's list surface is the failure this card must not produce.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

/**
 * The capabilities the host reports for the signed-in principal.
 * `undefined` is "the host reported nothing", which the gate itself reads as
 * unknown and fails OPEN on — so the inspector's first-person clause must stay
 * silent rather than guess (case E).
 */
let heldCapabilities: string[] | undefined;

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    usePermissions: () => ({
      systemPermissions: heldCapabilities,
      hasCapabilities: () => true,
      check: () => ({ allowed: true }),
      checkField: () => true,
      getFieldPermissions: () => [],
      getRowFilter: () => undefined,
      getObjectApiOperations: () => undefined,
      roles: [],
      userId: null,
      isLoaded: true,
      can: () => true,
      cannot: () => false,
    }),
  };
});

// ActionDefaultInspector mounts the object/field pickers behind its two
// ConditionBuilders, which call the shared metadata client at mount. Stub it so
// no fetch escapes; same mechanism ActionDefaultInspector.celGate.test.tsx uses.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]), withPreviewDrafts() { return this; } },
}));
vi.mock('./useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { ActionDefaultInspector } from './inspectors/ActionDefaultInspector';
import { ActionPreview } from './previews/ActionPreview';

/** The reporting app's action, reduced to the members these cases read. */
const GATED = {
  name: 'duly_catalog_apply_to_people',
  label: 'Apply to people',
  type: 'script',
  objectName: 'duly_catalog_item',
  target: 'true',
  locations: ['list_toolbar'],
  requiredPermissions: ['duly.catalog.apply'],
};

/** Same action with the gate removed — the control for every case below. */
const UNGATED = { ...GATED, requiredPermissions: undefined };

function renderInspector(draft: Record<string, unknown>) {
  return render(
    <ActionDefaultInspector
      type="action"
      name={String(draft.name ?? '')}
      draft={draft}
      onPatch={() => {}}
      readOnly={false}
      locale="en-US"
    />,
  );
}

function renderPreview(draft: Record<string, unknown>) {
  return render(<ActionPreview type="action" name={String(draft.name ?? '')} draft={draft} />);
}

const gateNote = () => screen.queryByTestId('action-capability-gate-note');
const selfClause = () => screen.queryByTestId('action-capability-gate-self');
const previewNote = () => screen.queryByTestId('action-preview-capability-gate-note');
const previewRequires = () => screen.queryByTestId('action-preview-required-permissions');

describe('objectui#7234 — the designer states why a gated action is missing', () => {
  beforeEach(() => {
    heldCapabilities = undefined;
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  it('A: the inspector names the gating capability and says HIDDEN, not disabled', () => {
    renderInspector({ ...GATED });
    const note = gateNote();
    expect(note).toBeTruthy();
    expect(note).toHaveTextContent('duly.catalog.apply');
    expect(note?.textContent).toMatch(/hides this action/i);
    expect(note?.textContent).toMatch(/Not greyed out and not an\s+error/i);
  });

  it('B (control): an action declaring no requiredPermissions gets no notice', () => {
    renderInspector({ ...UNGATED });
    expect(gateNote()).toBeNull();
  });

  // C and D are ONE differential: identical draft, identical code path, only
  // the held capability set differs — the same shape that identified the gate
  // as the cause on this card in the first place.

  it('C: a session missing the capability is told so in the first person', () => {
    heldCapabilities = ['duly.task.update_status'];
    renderInspector({ ...GATED });
    expect(selfClause()).toBeTruthy();
    expect(selfClause()).toHaveTextContent('duly.catalog.apply');
  });

  it('D: the SAME draft drops that clause once the session holds it', () => {
    heldCapabilities = ['duly.catalog.apply'];
    renderInspector({ ...GATED });
    // The declaration-side notice stays — the gate still applies to everyone
    // else — but nothing claims this session cannot see the button.
    expect(gateNote()).toBeTruthy();
    expect(selfClause()).toBeNull();
  });

  it('E: an unknown held set stays silent instead of guessing (gate fails OPEN)', () => {
    heldCapabilities = undefined;
    renderInspector({ ...GATED });
    expect(gateNote()).toBeTruthy();
    expect(selfClause()).toBeNull();
  });

  it('F: the preview carries the capability line AND still draws the placement frames', () => {
    renderPreview({ ...GATED });
    expect(previewRequires()).toHaveTextContent('duly.catalog.apply');
    expect(previewNote()).toHaveTextContent('duly.catalog.apply');
    // Paired positive: the notice was added to "Where it appears", it did not
    // replace it. The row strip is unique to `PlacementPreview`'s list_toolbar
    // frame (the bare location name also appears in the metadata strip), so a
    // deleted or emptied PlacementPreview fails here.
    expect(screen.getByText('row 1 · row 2 · row 3')).toBeTruthy();
  });

  it('G (control): the preview says nothing about capabilities for an ungated action', () => {
    renderPreview({ ...UNGATED });
    expect(previewRequires()).toBeNull();
    expect(previewNote()).toBeNull();
    expect(screen.getByText('row 1 · row 2 · row 3')).toBeTruthy();
  });

  it('H: the preview is declaration-side — the held set does not move it', () => {
    heldCapabilities = [];
    renderPreview({ ...GATED });
    // Positive first: without it both reads are `undefined` and the comparison
    // below passes for a deleted notice as readily as for a stable one.
    expect(previewNote()).toBeTruthy();
    const withEmptyHeld = previewNote()?.textContent;
    cleanup();
    heldCapabilities = ['duly.catalog.apply'];
    renderPreview({ ...GATED });
    expect(previewNote()?.textContent).toBe(withEmptyHeld);
  });
});

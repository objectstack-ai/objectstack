/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8920 — a `format`-hinted textual column must reach its renderer
 * through EVERY path `ObjectGrid` can pick, not just the one that happened to
 * apply the published two-step.
 *
 * ## The defect
 *
 * `@object-ui/fields` publishes `getCellRenderer(resolveCellRendererType(f))`.
 * Skip the second step and a `text` + `format: 'phone'` column resolves to
 * `TextCellRenderer`, which destructures only `value` and therefore cannot read
 * `field.format`. Nothing throws, nothing warns: the cell just renders plain
 * truncated text where a `tel:` anchor belongs. Six sites in `ObjectGrid.tsx`
 * resolved a renderer with three conventions and only ONE of them ran the
 * promotion, so which of the grid's paths honoured an author's `format` hint
 * depended on how the columns had been declared.
 *
 * ## Why a RENDERING test, and why one case per path
 *
 * `getCellRenderer(field.type)` type-checks — `field.type` is a `string` and
 * the parameter is a `string` — so every type-level and doc-level gate reads
 * the broken sites green. **A green that cannot go red on this defect is not
 * evidence.** The only oracle that can fail is rendered output: which renderer
 * drew the cell, observed as whether a `tel:` anchor exists.
 *
 * And one case is not enough. A single case through one path proves the shared
 * helper works; it says nothing about whether the divergence is gone. The
 * divergence IS the defect, so the population — every path — is the subject,
 * and each path gets its own case.
 *
 * ## The control, and why it is phone-SHAPED
 *
 * Every case carries an unhinted control column, `note`, whose value is a
 * second, DIFFERENT phone number. So:
 *
 *   - the hinted assertion is `a[href="tel:<hinted>"]` — present;
 *   - the control assertion is `a[href="tel:<control>"]` — absent, while the
 *     control's text still renders.
 *
 * A control holding a non-phone string would only show that the fix did not
 * reach it. This one shows the promotion is driven by the DECLARED `format`
 * and not by the value's shape, which is the other way this could have been
 * "fixed" and would have been worse.
 *
 * ## Reaching each path (measured, not presumed)
 *
 * `generateColumns()` picks its source with `normalizeColumns(schema.columns)`
 * first, then an inline-data branch, then the object-schema branch:
 *
 *   A  `columns` as objects   — `columns: [{ field }]`
 *   B  `columns` as strings   — `columns: ['work_phone']`
 *   C  inline-data projection — no `columns`, `fields` present, `data` inline
 *                               (`fields` is what keeps `rowKeysWouldOutrank
 *                               SchemaPolicy` false once the schema lands)
 *   D  object-schema policy   — no `columns`, no `fields`, rows handed down
 *   E  record-detail panel    — `renderRecordDetail` -> `renderFieldValue`
 *   P  compound-cell prefix   — `col.prefix.type === 'badge'`
 *
 * ## PREDICTED before running, on the pre-fix tree: 4 red, 2 green-both-sides
 *
 * A and P were ALREADY correct — A is the one site that ran the promotion, and
 * P asks for a fixed registry key with no field type to promote. Their cases
 * are PINS (must-not-change), not evidence that anything was fixed; they are
 * here because a shared helper that silently changed either of them would be a
 * regression this file has to catch. B, C, D and E are the genuinely red ones.
 */

import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  assertNoOtherNetworkEscape,
  installRecordSecurityExplainDouble,
} from '@object-ui/test-support';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

/**
 * objectui#9299 — this renderer's record overlay mounts the shared
 * `RecordDetailPanel` now, and its `DetailView` asks
 * `POST /api/v1/security/explain` whether the record may be updated and
 * deleted. With no host `apiFetch` that call degrades to the global `fetch`,
 * which under happy-dom is a real HTTP client — so it is served from a double
 * rather than from the network. Nothing below reads the verdict: the double is
 * permissive and `useRecordEditable` fails open, so no assertion here moves.
 */
beforeEach(() => installRecordSecurityExplainDouble(vi));
afterEach(() => {
  // A request to any OTHER endpoint reds here rather than vanishing into
  // `useRecordEditable`'s best-effort `catch`.
  assertNoOtherNetworkEscape(expect);
  // Unmount BEFORE restoring the real `fetch`: vitest runs `afterEach` hooks in
  // reverse registration order, so this one runs before the root setup's RTL
  // cleanup, and unstubbing first would leave the tree mounted with the real
  // global back in place (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
});

/** The hinted column's value — the one that MUST become a `tel:` anchor. */
const HINTED_PHONE = '+15551234567';
/** The control column's value — phone-SHAPED, declared without a hint. */
const CONTROL_PHONE = '+15559876543';

/**
 * `work_phone` is the subject: a TEXTUAL base type carrying a `format` hint,
 * which is exactly the pair `resolveCellRendererType` exists to promote.
 * `note` is its control — same base type, same value shape, no hint.
 */
const CONTACT_SCHEMA = {
  name: 'contacts',
  label: 'Contact',
  fields: {
    name: { type: 'text', label: 'Name' },
    work_phone: { type: 'text', format: 'phone', label: 'Work Phone' },
    note: { type: 'text', label: 'Note' },
    stage: {
      type: 'select',
      label: 'Stage',
      options: [{ value: 'new', label: 'New' }],
    },
  },
};

const ROWS = [
  {
    id: 'c-1',
    name: 'Alice',
    work_phone: HINTED_PHONE,
    note: CONTROL_PHONE,
    stage: 'new',
  },
];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    getObjectSchema: vi.fn(async () => CONTACT_SCHEMA),
  } as any;
}

/** Every `tel:` href currently in the tree, in DOM order. */
function telHrefs(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('a[href^="tel:"]')).map(
    (a) => a.getAttribute('href') ?? '',
  );
}

function renderGrid(schemaOverrides: Record<string, unknown>, props: Record<string, unknown> = {}) {
  return render(
    <ActionProvider>
      <ObjectGrid
        schema={{ type: 'object-grid', objectName: 'contacts', ...schemaOverrides } as never}
        dataSource={makeDataSource()}
        {...props}
      />
    </ActionProvider>,
  );
}

/**
 * The assertion every path shares: the hinted column drew a `tel:` anchor, the
 * unhinted control did not, and the control's value is still on screen (so the
 * absence half cannot be satisfied by the column having vanished).
 */
async function expectHintHonoured(root: HTMLElement) {
  await waitFor(() => expect(telHrefs(root)).toContain(`tel:${HINTED_PHONE}`));
  expect(telHrefs(root)).not.toContain(`tel:${CONTROL_PHONE}`);
  expect(root.textContent).toContain(CONTROL_PHONE);
}

describe('objectui#8920 — every ObjectGrid path honours a `format` hint', () => {
  /** PATH A — object `columns`. PIN: already correct before the fix. */
  it('A: object `columns` (must-not-change pin — this path already resolved)', async () => {
    const { container } = renderGrid({
      columns: [{ field: 'name' }, { field: 'work_phone' }, { field: 'note' }],
      data: { provider: 'value', items: ROWS },
    });

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    await expectHintHonoured(container);
  });

  /** PATH B — string `columns`. */
  it('B: string `columns`', async () => {
    const { container } = renderGrid({
      columns: ['name', 'work_phone', 'note'],
      data: { provider: 'value', items: ROWS },
    });

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    await expectHintHonoured(container);
  });

  /**
   * PATH C — the inline-data projection.
   *
   * `fields` (not `columns`) is what selects this branch and keeps it selected:
   * `rowKeysWouldOutrankSchemaPolicy` is `!schemaFields && objectName &&
   * objectSchema`, so an authored projection is exactly the condition under
   * which the inline path survives the schema landing.
   */
  it('C: inline-data projection (`fields`, no `columns`)', async () => {
    const { container } = renderGrid({
      fields: ['name', 'work_phone', 'note'],
      data: { provider: 'value', items: ROWS },
    });

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    await expectHintHonoured(container);
  });

  /**
   * PATH D — the object-schema default-columns policy.
   *
   * Rows handed down as a prop with NO authored projection: that is
   * `rowKeysWouldOutrankSchemaPolicy === true`, which skips path C and lands
   * here (objectui#6677's ordering).
   */
  it('D: object-schema default columns (rows handed down, no projection)', async () => {
    const { container } = renderGrid({}, { data: ROWS });

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    await expectHintHonoured(container);
  });

  /**
   * PATH E — the record-detail panel.
   *
   * `work_phone` and `note` are deliberately NOT columns here, so the only
   * place either value can reach the DOM is the panel: no table cell can
   * satisfy these assertions on the panel's behalf. The panel renders through
   * a portal, so it is read by test id rather than from `container`.
   */
  it('E: record-detail panel', async () => {
    renderGrid({
      columns: [{ field: 'name' }],
      data: { provider: 'value', items: ROWS },
      navigation: { mode: 'drawer' },
    });

    fireEvent.click(await screen.findByText('Alice'));
    await waitFor(() => expect(screen.getByTestId('record-detail-panel')).toBeInTheDocument());
    await expectHintHonoured(screen.getByTestId('record-detail-panel'));
  });

  /**
   * PATH P — the compound-cell prefix badge. PIN: this site asks for a FIXED
   * registry key (`select`), not for a field's renderer, so there is nothing to
   * promote and its output must be byte-identical across the fix. It is here
   * because routing it through the shared module is what keeps it from reading
   * as a convention nobody chose — and a shared module that quietly changed it
   * would be a regression.
   */
  it('P: compound-cell prefix badge still draws the select renderer (must-not-change pin)', async () => {
    const { container } = renderGrid({
      columns: [{ field: 'name', prefix: { field: 'stage', type: 'badge' } }, { field: 'work_phone' }],
      data: { provider: 'value', items: ROWS },
    });

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    // The badge renderer translates the option value to its label; a plain
    // text prefix would print the raw `new`.
    await waitFor(() => expect(container.textContent).toContain('New'));
    // …and the hinted column in the same grid is still promoted — which needs
    // a wait of its OWN, because it is the only fact in this case that the two
    // assertions above do not imply (objectui#9035).
    //
    // `Alice` is a raw row value, and the badge label `New` is
    // `humanizeLabel('new')`: the prefix renderer is handed a FIXED-key field
    // descriptor (`{ name, type: BADGE_PREFIX_RENDERER_KEY }`, ObjectGrid.tsx)
    // carrying no `options`, so `SelectCellRenderer` finds no option to
    // translate and humanizes the stored code. ⇒ both settle on the first
    // commit that carries the inline rows, and NEITHER touches the object
    // schema.
    //
    // The `tel:` anchor does. `format: 'phone'` is declared only in
    // `CONTACT_SCHEMA`, which reaches the grid through the async
    // `dataSource.getObjectSchema()` fetch, so the promotion lands in a
    // STRICTLY LATER commit than the two waits above settle on. Read bare, this
    // assertion sampled whatever tick it happened to run on and intermittently
    // saw `[]` — reddening PRs that cannot reach the code under test.
    //
    // ⛔ The wait is the only thing that changed: the assertion is byte-identical
    // and still fails if the hinted column stops being promoted (it retries the
    // same `toContain`, and `telHrefs` re-queries the DOM on every attempt).
    // Note the shape the file's own `expectHintHonoured` already uses: wait on
    // the LATEST-arriving fact, then assert the earlier ones. This case had it
    // inverted.
    await waitFor(() => expect(telHrefs(container)).toContain(`tel:${HINTED_PHONE}`));
  });
});

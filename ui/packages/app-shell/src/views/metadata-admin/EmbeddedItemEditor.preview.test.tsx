// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The embedded editor mounts the registered preview (objectui#4132).
 *
 * `ValidationPreview` is a complete renderer — rule label, description, the
 * severity/message callout, per-variant bodies, tags — and until #4132 the only
 * route that mounted it was `ResourceEditPage`'s Preview tab on the STANDALONE
 * `validation` resource, i.e. the door ADR-0088 / objectstack#4509 retired. The
 * governed path (`object.validations`, which is what the framework actually
 * evaluates) goes Related tab → `MetadataDetailDrawer` → `EmbeddedItemEditor`,
 * and that rendered a bare `SchemaForm`. Retiring the door without moving the
 * renderer would have deleted a working surface from the product; moving it is
 * the point of the change (#4132's shape B).
 *
 * SCOPE OF THIS FILE: `EmbeddedItemEditor` is the entirety of the drawer's
 * embedded branch — `MetadataDetailDrawer` renders `<EmbeddedItemEditor …/>`
 * and nothing else for `kind: 'embedded'`. It is mounted directly here rather
 * than through the drawer because the drawer wraps it in a Radix `Sheet`, which
 * does not settle under this project's light DOM setup (measured: the same
 * assertions through `<MetadataDetailDrawer>` never completed, while the editor
 * alone renders in ~6s). The drawer's half — that it forwards `editAs` to this
 * component — is pinned off source text in `anchors.validation-retired.test.ts`,
 * so both halves of the path are asserted, neither by a hanging render.
 *
 * The wiring is deliberately GENERIC — `getMetadataPreview(editAs)` — not a
 * `validation` special case. Today only `validation` has both an `editAs` anchor
 * and a registered preview, so today it is the only sub-type affected; the
 * control below pins that a sub-type WITHOUT a registered preview (`index`)
 * still renders its editor and grows no empty preview chrome.
 *
 * Read points asserted here are exactly the ones objectstack#7427's liveness
 * sweep graded `dead` for being unreachable — `label`, `description`, `tags` —
 * so this file is the evidence those rows can be re-graded.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * Deliberately WITHOUT a `condition` property. `SchemaForm` routes that name
 * (`CONDITION_FIELD_NAMES`) to the CEL `ConditionWidget`, whose formula loader
 * is a dynamic import — an unbounded module load inside a bounded test window,
 * the trap AGENTS.md §测试纪律 describes (measured here: the file never
 * settles). The rule's `condition` is still asserted below, where it belongs:
 * on the PREVIEW, which reads it straight off the draft.
 */
const VALIDATION_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', title: 'Name' },
    label: { type: 'string', title: 'Label' },
    message: { type: 'string', title: 'Error message' },
  },
} satisfies Record<string, unknown>;

vi.mock('./useMetadata', () => ({
  useMetadataClient: () => ({
    layered: async () => ({ effective: {}, code: null, overlay: null, overlayScope: null }),
    save: async (_t: string, _n: string, payload: Record<string, unknown>) => payload,
  }),
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [
      {
        type: 'validation',
        label: 'Validation Rule',
        allowEnvironmentOverlay: true,
        schema: VALIDATION_SCHEMA,
      },
    ],
  }),
}));

import { EmbeddedItemEditor } from './EmbeddedItemEditor';
import { getMetadataPreview, registerMetadataPreview } from './preview-registry';
import { ValidationPreview } from './previews/ValidationPreview';

// Registered directly rather than via `registerBuiltinPreviews()`: the barrel
// pulls every preview module (flow canvas, dashboard, report…) into this file's
// graph, which is minutes of transform for one form. That the BARREL still
// carries the `validation` line is pinned off its source text in
// `anchors.validation-retired.test.ts`.
registerMetadataPreview('validation', ValidationPreview);

afterEach(cleanup);

/** A spec-shaped script rule as it lives inside `object.validations`. */
const RULE: Record<string, unknown> = {
  name: 'amount_positive',
  label: 'Amount Must Be Positive',
  description: 'Blocks orders whose amount is zero or negative.',
  type: 'script',
  condition: 'record.amount <= 0',
  message: 'Order amount must be greater than zero.',
  severity: 'error',
  active: true,
  events: ['insert', 'update'],
  priority: 10,
  tags: ['finance', 'guardrail'],
};

function openValidation() {
  return render(
    <EmbeddedItemEditor
      parentType="object"
      parentName="sales_order"
      embeddedPath="validations"
      itemName="amount_positive"
      editAs="validation"
      initialRaw={RULE}
    />,
  );
}

describe('a preview is registered for the embedded sub-type', () => {
  it('`validation` still has a registered preview after the standalone retirement', () => {
    // Shape B: the door goes, the renderer moves. If this were ever
    // unregistered, the assertions below would go green for the wrong reason
    // (nothing to mount), so it is asserted before them, not inferred from them.
    expect(getMetadataPreview('validation')).toBeTruthy();
  });

  it('control: a sub-type with no preview is genuinely unregistered', () => {
    expect(getMetadataPreview('index')).toBeUndefined();
  });
});

describe('the embedded editor renders the preview alongside the form', () => {
  it('renders the rule label — objectstack#7427 `validation.label`', () => {
    openValidation();
    expect(screen.getByText('Amount Must Be Positive')).toBeInTheDocument();
  });

  it('renders the rule description — `validation.description`', () => {
    openValidation();
    expect(screen.getByText('Blocks orders whose amount is zero or negative.')).toBeInTheDocument();
  });

  it('renders the rule tags — `validation.tags`', () => {
    openValidation();
    expect(screen.getByText('finance')).toBeInTheDocument();
    expect(screen.getByText('guardrail')).toBeInTheDocument();
  });

  it('renders the type-specific body, not just the envelope', () => {
    openValidation();
    // `script` → the CEL condition block. This is the half that proves the
    // whole preview mounted, rather than a stray label somewhere in the form.
    expect(screen.getByText('Condition')).toBeInTheDocument();
    expect(screen.getByText('record.amount <= 0')).toBeInTheDocument();
    // The severity callout carries the message as TEXT (the form carries it as
    // an input VALUE, which `getByText` does not see).
    expect(screen.getByText('Order amount must be greater than zero.')).toBeInTheDocument();
  });

  it('ALONGSIDE, not instead of: the SchemaForm is still mounted and editable', () => {
    const { container } = openValidation();
    // The form's own labels…
    expect(screen.getByText('Error message')).toBeInTheDocument();
    // …bound to the draft, and the save affordance below it.
    expect(screen.getByDisplayValue('Order amount must be greater than zero.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save into object/i })).toBeInTheDocument();
    // Not the raw-JSON fallback branch (which renders a textarea instead).
    expect(container.querySelector('textarea')).toBeNull();
  });
});

describe('sub-types without a registered preview are unchanged (control)', () => {
  it('renders the editor with no preview chrome', () => {
    render(
      <EmbeddedItemEditor
        parentType="object"
        parentName="sales_order"
        embeddedPath="indexes"
        itemName="idx_email"
        editAs="index"
        initialRaw={{ name: 'idx_email', fields: ['email'], unique: true }}
      />,
    );
    // `index` falls back to EmbeddedItemEditor's inline FALLBACK_SCHEMAS entry,
    // so the form is there…
    expect(screen.getByText('Fields')).toBeInTheDocument();
    // …and nothing preview-shaped is drawn for a type that has no preview.
    expect(screen.queryByText('Amount Must Be Positive')).toBeNull();
    expect(screen.queryByText(/no preview available/i)).toBeNull();
  });
});

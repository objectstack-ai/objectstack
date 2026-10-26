// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SkillPreview vs `SkillSchema` (objectui#3275).
 *
 * Two defects of the same shape, both found by objectui#3266's browser pass:
 *
 *  1. `skill.triggerPhrases` is a `retiredKey()` tombstone in
 *     `@objectstack/spec` 17 (objectstack#3896) — rejected BY NAME. The
 *     preview read it and painted a `TRIGGER PHRASES (n)` block, which was
 *     wrong twice over: the draft could not be saved, and the phrases were
 *     never matched against a user's message even when they were legal.
 *
 *  2. The trigger-conditions table read `cond.expression ?? cond.value` under
 *     a `cond.type` gutter. `SkillTriggerConditionSchema` is
 *     `{ field, operator, value }` — all three REQUIRED — so a spec-VALID
 *     condition rendered as `COND | sales_order`: the value alone, with the
 *     field it tests and the operator it applies both invisible. The author
 *     could not see what their skill actually triggers on.
 *
 * Together these are why a corrected sample made the gallery render less: the
 * only draft that lit this preview up fully was one the spec refuses.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { SkillPreview } from './SkillPreview';

afterEach(cleanup);

/** Parses clean against `ObjectStackSchema` — mirrors the gallery's sample. */
const VALID_DRAFT = {
  name: 'draft_email',
  label: 'Draft Email',
  type: 'prompt',
  description: 'Draft a follow-up email from a record context.',
  active: true,
  instructions: 'Write a concise, friendly follow-up email referencing the order.',
  tools: ['lookup_company'],
  triggerConditions: [{ field: 'objectName', operator: 'eq', value: 'sales_order' }],
} satisfies Record<string, unknown>;

/** Pre-removal shape: retired `triggerPhrases` plus the off-spec condition form. */
const STALE_DRAFT = {
  ...VALID_DRAFT,
  triggerPhrases: ['draft an email', 'follow up with the customer'],
  triggerConditions: [{ type: 'cel', expression: 'context.objectName == "sales_order"' }],
} satisfies Record<string, unknown>;

function renderPreview(draft: Record<string, unknown>) {
  return render(
    <SkillPreview type="skill" name="draft_email" draft={draft} />,
  );
}

describe('SkillPreview renders trigger conditions as field / operator / value', () => {
  it('renders all three columns of a spec-valid condition', () => {
    renderPreview(VALID_DRAFT);
    expect(screen.getByText('Trigger Conditions (1)')).toBeTruthy();
    // Column headers — the two that used to have nowhere to render.
    expect(screen.getByText('Field')).toBeTruthy();
    expect(screen.getByText('Operator')).toBeTruthy();
    expect(screen.getByText('Value')).toBeTruthy();
    // ...and the row, which previously showed only `sales_order`.
    const row = screen.getByText('objectName').closest('tr')!;
    expect(within(row).getByText('eq')).toBeTruthy();
    expect(within(row).getByText('sales_order')).toBeTruthy();
  });

  it('renders an `in` condition whose value is a string array', () => {
    renderPreview({
      ...VALID_DRAFT,
      triggerConditions: [{ field: 'stage', operator: 'in', value: ['open', 'won'] }],
    });
    const row = screen.getByText('stage').closest('tr')!;
    expect(within(row).getByText('in')).toBeTruthy();
    expect(within(row).getByText('open, won')).toBeTruthy();
  });

  it('marks a missing required cell instead of rendering a blank that reads as fine', () => {
    // `operator` is required — an author who omitted it must see that here,
    // not discover it when the save is refused.
    renderPreview({
      ...VALID_DRAFT,
      triggerConditions: [{ field: 'objectName', value: 'sales_order' }],
    });
    const row = screen.getByText('objectName').closest('tr')!;
    expect(within(row).getByText('missing')).toBeTruthy();
  });

  it('spells out the AND semantics once there is more than one condition', () => {
    renderPreview({
      ...VALID_DRAFT,
      triggerConditions: [
        { field: 'objectName', operator: 'eq', value: 'sales_order' },
        { field: 'stage', operator: 'neq', value: 'closed' },
      ],
    });
    expect(screen.getByText(/all conditions must hold/i)).toBeTruthy();
  });
});

describe('SkillPreview renders nothing from retired SkillSchema keys', () => {
  it('paints no TRIGGER PHRASES block for a stale draft carrying `triggerPhrases`', () => {
    renderPreview(STALE_DRAFT);
    expect(screen.queryByText(/trigger phrases/i)).toBeNull();
    expect(screen.queryByText('draft an email')).toBeNull();
    expect(screen.queryByText('follow up with the customer')).toBeNull();
  });

  it('does not resurrect the off-spec condition shape through `expression`', () => {
    renderPreview(STALE_DRAFT);
    // `expression` / `type` are not condition keys — reading them was what let
    // a non-conforming condition look rendered. The row now reports the three
    // required cells as missing, which is the truth about this draft.
    expect(screen.queryByText('context.objectName == "sales_order"')).toBeNull();
    expect(screen.getAllByText('missing')).toHaveLength(3);
  });
});

describe('SkillPreview still renders everything the spec accepts', () => {
  it('keeps label, machine name, description, instructions and tools', () => {
    renderPreview(VALID_DRAFT);
    expect(screen.getByText('Draft Email')).toBeTruthy();
    expect(screen.getByText('draft_email')).toBeTruthy();
    expect(screen.getByText('Draft a follow-up email from a record context.')).toBeTruthy();
    expect(screen.getByText(/write a concise, friendly follow-up email/i)).toBeTruthy();
    expect(screen.getByText('Tools (1)')).toBeTruthy();
    expect(screen.getByText('lookup_company')).toBeTruthy();
  });
});

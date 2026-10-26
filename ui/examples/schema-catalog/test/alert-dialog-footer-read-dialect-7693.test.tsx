/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7693 — the four `alert-dialog` catalog fixtures authored an
 * `actions` array that no surface carries, so the docs page's own examples
 * rendered an EMPTY footer.
 *
 * ## Why nothing was red before this file
 *
 * `BaseSchema` is `.passthrough()` (`packages/types/src/zod/base.zod.ts:241`),
 * so `actions` rode through `safeValidateSchema` unvalidated and every gate
 * stayed green while the rendered dialog had no buttons at all. The renderer
 * (`packages/components/src/renderers/overlay/alert-dialog.tsx`) draws
 * `AlertDialogCancel` ONLY from `schema.cancelText` and `AlertDialogAction`
 * ONLY from `schema.actionText`; `schema.actions` has zero read sites.
 *
 * ## The two pins, and why both
 *
 * The DOM pin is the one that names the SYMPTOM the card reported (an empty
 * footer), and it is the one that would have gone red on `origin/main`: all
 * four fixtures drew zero footer buttons. The fixture-key pin is the cheap
 * companion that closes the CLASS — it walks every catalog entry, not just the
 * four, so a future `alert-dialog` node re-authored under `actions` reds here
 * even if nobody adds a render assertion for it.
 *
 * Each pin is paired with a live control, because a render that draws nothing
 * satisfies a "no `actions` key" assertion trivially and a harness that renders
 * nothing at all satisfies both:
 *
 *   - `RENDERS_IN_THE_READ_DIALECT` — an inline node in the read dialect MUST
 *     draw two footer buttons. If the harness cannot see a footer button, this
 *     control reds first and the fixture rows below mean nothing.
 *   - `THE_PRE_REPAIR_SHAPE_DRAWS_NOTHING` — the same node authored the way the
 *     fixtures were authored (an `actions` array, no label keys) MUST draw zero
 *     footer buttons, and MUST still validate. That is the defect reproduced in
 *     one place, and it is what makes the fixture rows a measurement of the
 *     SPELLING rather than of some unrelated render failure.
 *
 * ⛔ Do NOT "fix" a red row here by declaring `actions` on `AlertDialogSchema`.
 * Making a variant-carrying action list live is a renderer + types feature on
 * the manual floor, explicitly ruled out of this card's scope; the fixtures
 * follow the dialect the renderer READS.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@object-ui/components';
import { SchemaRenderer, toRenderableSchema } from '@object-ui/react';
import { safeValidateSchema } from '@object-ui/types/zod';
import { allExamples, getExample } from '../src/index.js';

/** The four entries the docs page embeds, in the order it embeds them. */
const FIXTURE_IDS = [
  'components-overlay-alert-dialog/basic-alert-dialog',
  'components-overlay-alert-dialog/destructive-action',
  'components-overlay-alert-dialog/confirmation-dialog',
  'components-overlay-alert-dialog/custom-actions',
] as const;

/**
 * Render one entry the way the docs gallery does, forced OPEN.
 *
 * `defaultOpen` is the only thing the test adds: the fixtures are authored
 * closed (that is what the docs page wants — a trigger you click), and a closed
 * Radix dialog mounts no content, so the footer could not be measured at all.
 * Everything the assertions read comes from the fixture's own keys.
 */
function footerButtons(schema: unknown): string[] {
  render(
    <SchemaRenderer
      schema={toRenderableSchema({ ...(schema as object), defaultOpen: true } as never) as never}
    />,
  );
  // Radix portals the content to document.body, so the RTL container is empty
  // by construction — query the dialog itself. An `alert-dialog` has no close
  // affordance of its own, so every button inside the content IS a footer
  // button (the trigger stays behind, in the container).
  const content = document.body.querySelector('[role="alertdialog"]');
  if (!content) return [];
  return Array.from(content.querySelectorAll('button')).map((b) => b.textContent ?? '');
}

/** Report the issues rather than `false`, so a red run says what broke. */
function reasons(schema: unknown): string[] {
  const r = safeValidateSchema(schema);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

const READ_DIALECT_NODE = {
  type: 'alert-dialog',
  title: 'Are you sure?',
  trigger: { type: 'button', label: 'Open' },
  cancelText: 'Cancel',
  actionText: 'Continue',
};

const PRE_REPAIR_NODE = {
  type: 'alert-dialog',
  title: 'Are you sure?',
  trigger: { type: 'button', label: 'Open' },
  actions: [
    { type: 'button', label: 'Cancel', variant: 'outline' },
    { type: 'button', label: 'Continue', variant: 'destructive' },
  ],
};

describe('objectui#7693 — controls: the harness can tell a drawn footer from an empty one', () => {
  it('RENDERS_IN_THE_READ_DIALECT: `cancelText` + `actionText` draw two footer buttons', () => {
    expect(footerButtons(READ_DIALECT_NODE)).toEqual(['Cancel', 'Continue']);
  });

  it('THE_PRE_REPAIR_SHAPE_DRAWS_NOTHING: an `actions` array draws an empty footer', () => {
    // The defect, reproduced in one place. `actions` is not refused — it is
    // simply never read, which is why every gate stayed green.
    expect(footerButtons(PRE_REPAIR_NODE)).toEqual([]);
    expect(reasons(PRE_REPAIR_NODE)).toEqual([]);
  });
});

describe('objectui#7693 — every alert-dialog fixture renders a real footer', () => {
  it.each(FIXTURE_IDS)('%s draws at least one footer button', (id) => {
    const labels = footerButtons(getExample(id).schema);
    expect(labels.length).toBeGreaterThanOrEqual(1);
    // ...and each one carries text, so a button rendered from an empty label
    // cannot satisfy the count.
    for (const label of labels) expect(label.trim().length).toBeGreaterThan(0);
  });

  it.each(FIXTURE_IDS)('%s still validates under safeValidateSchema', (id) => {
    expect(reasons(getExample(id).schema)).toEqual([]);
  });
});

describe('objectui#7693 — no alert-dialog node in the catalog authors `actions`', () => {
  /** Every object in an example's schema tree, the example's id carried along. */
  function* nodes(value: unknown, id: string): Generator<[string, Record<string, unknown>]> {
    if (Array.isArray(value)) {
      for (const item of value) yield* nodes(item, id);
    } else if (value !== null && typeof value === 'object') {
      yield [id, value as Record<string, unknown>];
      for (const child of Object.values(value as Record<string, unknown>)) yield* nodes(child, id);
    }
  }

  it('the whole catalog is clean, not just the four the docs page embeds', () => {
    const offenders: string[] = [];
    for (const example of allExamples()) {
      for (const [id, node] of nodes(example.schema, example.id)) {
        if (node.type === 'alert-dialog' && 'actions' in node) offenders.push(id);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('anti-vacuity: the walk really does reach alert-dialog nodes', () => {
    // Without this, the assertion above passes just as well when the walk is
    // broken, or when the catalog holds no alert-dialog at all.
    const seen = new Set<string>();
    for (const example of allExamples()) {
      for (const [id, node] of nodes(example.schema, example.id)) {
        if (node.type === 'alert-dialog') seen.add(id);
      }
    }
    expect([...seen].sort()).toEqual([...FIXTURE_IDS].sort());
  });

  it('anti-vacuity: the offender test would catch one', () => {
    // The same predicate, over the pre-repair shape, must report it.
    const offenders: string[] = [];
    for (const [id, node] of nodes(PRE_REPAIR_NODE, 'inline/pre-repair')) {
      if (node.type === 'alert-dialog' && 'actions' in node) offenders.push(id);
    }
    expect(offenders).toEqual(['inline/pre-repair']);
  });
});

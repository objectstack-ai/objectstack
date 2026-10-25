/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6063 — `resolveDisplay`'s opaque-id suppression is a rule about the
 * VALUE, not about the field's declared type. This file is the pin that says so.
 *
 * ## What was removed, and why the pin has to exist
 *
 * `resolveDisplay` (the card-description helper in `ObjectKanban.tsx`) ended:
 *
 *     const isLookup = isExpandableFieldType(def);
 *     if (isLookup && isOpaqueId(raw)) return undefined;
 *     if (isOpaqueId(raw)) return undefined;
 *     return raw;
 *
 * The second line subsumes the first for EVERY input — same `raw` (a `const`,
 * unmodified between the two lines), same predicate, and `isOpaqueId` is pure:
 * `OPAQUE_ID_RE` carries no `g`/`y` flag, so repeated `.test()` on it is
 * stateless (a sticky/global regex is the one thing that would have made the
 * two calls disagree, and would have made the guard live). So `isLookup` was
 * computed, branched on, and discarded — deleted here.
 *
 * ⚠️ **A deletion's green is weak evidence.** Every assertion below passes with
 * the dead branch present AND absent — that is what "dead" means, and it is why
 * a passing suite is not the argument. The argument is the subsumption above.
 * What these assertions are for is the OTHER half: they pin the behaviour that
 * SURVIVES, so the deletion cannot be quietly upgraded into a behaviour change.
 *
 * The card named two readings and the deletion is only correct under one:
 *
 *   A. the guard is redundant — the unconditional line is the intent   ← taken
 *   B. the unconditional line is over-broad — it was meant to be gated
 *      on `isLookup`, so a non-relation `text` column holding an
 *      id-shaped string would still render
 *
 * The first two tests below are exactly the discriminator: they are GREEN under
 * A and RED under B. Measured, not asserted — ablation record in the PR body:
 * re-gating the surviving line on `isLookup` (i.e. implementing B) turns both
 * of them red and leaves the relation-typed test green.
 *
 * Why A: the helper's own docblock declares both clauses ("skips raw FK IDs,
 * AND skips lookup-typed fields whose value didn't get expanded"); the same
 * `isOpaqueId` is already applied with NO type gate to the incoming
 * `description` further down the same function; and `objectDef` is optional, so
 * B would fail open — suppressing nothing — precisely when the field types it
 * depends on are unavailable.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-kanban`.
import '../index';
// The cards asserted below render INSIDE `KanbanRenderer`'s `React.lazy`
// boundary. Importing the chunk at module scope bills the cold transform to the
// import phase (unbounded) instead of racing a `waitFor` budget under full
// parallelism — the objectui#3010 rule, same specifier as `index.tsx`'s factory
// so ESM's module cache makes that factory resolve immediately.
import '../KanbanImpl';

/**
 * An id-shaped string by `isOpaqueId`'s rule: 12–32 chars of
 * `[A-Za-z0-9_-]` with at least two of {upper, lower, digit-or-separator}.
 */
const OPAQUE = 'aXbY9zHWBfjYjZ4';
/** Human text of the same length, deliberately NOT id-shaped (it has spaces). */
const HUMAN = 'Northwind Traders';

/**
 * A board with NO `cardFields` and NO `highlightFields`, so cards fall to the
 * legacy semantic heuristic — the only branch that calls `resolveDisplay`.
 * `company` is one of the hard-coded organisation keys that helper probes.
 *
 * `fields` is passed through verbatim so a test can hand over an object schema
 * that declares nothing at all (`{}`), which is what makes `def` `undefined` at
 * the read site.
 */
function makeAdapter(company: string, fields: Record<string, unknown>) {
  return {
    find: vi.fn().mockResolvedValue({
      data: [{ id: '1', name: 'Q3 renewal', status: 'open', company }],
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'deal', fields }),
  };
}

async function renderBoard(company: string, fields: Record<string, unknown>) {
  const { container } = render(
    <SchemaRendererProvider dataSource={makeAdapter(company, fields) as any}>
      <SchemaRenderer
        schema={
          {
            type: 'object-kanban',
            objectName: 'deal',
            groupBy: 'status',
            columns: [{ id: 'open', title: 'Open' }],
          } as any
        }
      />
    </SchemaRendererProvider>,
  );
  // The cards render past a Suspense boundary and after the fetch resolves.
  // Waiting on the TITLE is what makes the negative assertions below mean
  // "the card rendered and the value is not on it" rather than "nothing
  // rendered yet" — the failure mode that would make an absence pin vacuous.
  await waitFor(() => expect(container.textContent).toContain('Q3 renewal'));
  return container;
}

const TEXT_SCHEMA = {
  name: { type: 'text' },
  status: { type: 'text' },
  company: { type: 'text' },
};

describe('kanban card descriptions suppress id-shaped values by VALUE, not by declared type (objectui#6063)', () => {
  it('a `text` column holding an id-shaped string is suppressed', async () => {
    // THE discriminator. `company` is declared `text` — not a member of
    // `EXPANDABLE_FIELD_TYPES` — so the deleted `isLookup && …` line could
    // never have fired for it. This passes only because the suppression is
    // unconditional; re-gating it on `isLookup` (reading B) turns this red.
    const container = await renderBoard(OPAQUE, TEXT_SCHEMA);
    expect(container.textContent).not.toContain(OPAQUE);
  });

  it('an id-shaped string is suppressed even when the object declares no fields at all', async () => {
    // `objectDef.fields.company` is `undefined` here, so `isExpandableFieldType`
    // answers `false` by construction. Under reading B this board would print
    // the raw id — the heuristic would fail OPEN exactly when the type
    // information it would depend on is missing, which is the common case on a
    // board whose object schema is thin or absent.
    const container = await renderBoard(OPAQUE, {});
    expect(container.textContent).not.toContain(OPAQUE);
  });

  it('a relation-typed column holding an unexpanded id is suppressed too', async () => {
    // The outcome the deleted guard claimed for itself. It is unchanged by the
    // deletion — the surviving line already covered it, which is the whole
    // finding. Kept so the removal cannot silently take this case with it.
    const container = await renderBoard(OPAQUE, {
      ...TEXT_SCHEMA,
      company: { type: 'lookup', reference: 'account' },
    });
    expect(container.textContent).not.toContain(OPAQUE);
  });

  it('a human-readable value on the same column still renders', async () => {
    // Positive control. Without it, every assertion above is satisfied by a
    // board that renders no description at all — including one where
    // `resolveDisplay` was deleted outright rather than trimmed.
    const container = await renderBoard(HUMAN, TEXT_SCHEMA);
    expect(container.textContent).toContain(HUMAN);
  });
});

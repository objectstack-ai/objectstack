/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8695 — `LookupCellRenderer` answered ONE epistemic state two
 * opposite ways, and which one you got was decided by the SHAPE of the string.
 *
 * ── Re-measured on this base, before anything was changed ─────────────────
 * The card's readings were taken at `da5e4f69e`; `packages/fields/src/index.tsx`
 * has since been released by objectui#9068. Both readings reproduce verbatim.
 * `getCellRenderer('lookup')`, `reference_to: 'sys_user'`, no data source, in
 * ONE render:
 *
 *   'Ada Lovelace'     → <span class="block max-w-full truncate"
 *                          title="Ada Lovelace">Ada Lovelace</span>
 *   'wo_1'             → <span class="block max-w-full truncate"
 *                          title="wo_1">wo_1</span>
 *   '01HQZX9K2M4N6P8R' → <span class="block max-w-full truncate
 *                          text-muted-foreground" title="—">—</span>
 *
 * The first two are BYTE-IDENTICAL to what a `text` cell prints for the same
 * string — the screen states a confident fact it does not have, so a dirty row
 * reads exactly like a clean one. The third destroys the raw id, which
 * objectui#8434's triage named as "the only clue for diagnosing existing dirty
 * rows". Two opposite failures, one state, chosen by `isLikelyOpaqueId`.
 *
 * ── ⭐ Why the pins below assert AGREEMENT ────────────────────────────────
 * A per-shape assertion ("the opaque one now shows its id") would go green on
 * a repair that made both shapes wrong in a NEW matching way. The disagreement
 * IS the finding, so the load-bearing assertion is that the three shapes get
 * the SAME treatment — their markup normalises to one string — with a floor
 * underneath it (the affordance is present, the raw value survives, and the
 * sentence is epistemic) so that "identically wrong" cannot pass either.
 *
 * ── ⭐ How many states hide behind "unresolved" — measured, not assumed ────
 * Six causes reach this arm and the renderer distinguishes NONE of them:
 * never fetched (no dataSource / no `reference`), IN FLIGHT, the resolver
 * threw, the resolver answered with no record, it answered with a record no
 * display field could name, and — for array entries after the first — never
 * asked at all (`primaryPrimitiveId`). `useLookupName` returns
 * `string | undefined`, dropping the `pending`/`err`/`ok` discriminator its own
 * cache holds. So the card's premise that this renderer "can genuinely
 * distinguish 'fetched and absent' from 'never fetched'" is false as the code
 * stands, and even surfacing the discriminator could not upgrade the sentence:
 * a throw and an empty answer also cover a record the VIEWER may not read, and
 * "cannot read" vs "does not exist" is an existence-oracle boundary this lane
 * does not cross (objectui#8631). ⇒ the sentence must stay EPISTEMIC, exactly
 * as objectui#8434 ruled, and `THE SENTENCE` below pins that.
 *
 * ⚠️ Since objectui#13335 one of the six no longer reaches this arm: a read
 * that SETTLED with no record (`findOne` → `null`, a 404 for this reader) now
 * draws "Restricted record" instead — still fused, deliberately, over "cannot
 * read" and "does not exist". The other five keep this affordance, and
 * `lookupCell.restrictedRecord-13335.test.tsx` pins the boundary between them.
 *
 * ── ⛔ What this file must not let pass ───────────────────────────────────
 * The controls are the other half: a genuinely RESOLVED reference must render
 * exactly as it does today, unmarked (three ways of resolving: an expanded
 * record, the author's `options`, and the fetch-on-demand resolver), and an
 * empty cell must keep `EmptyValue`. Without them a reviewer cannot tell this
 * repair from "every lookup now looks broken".
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { en } from '@object-ui/i18n';
import { SchemaRendererProvider, RelatedRecordActionsProvider } from '@object-ui/react';
import { getCellRenderer, resolveCellRendererType } from '../index';

afterEach(() => cleanup());

/** Resolve + render exactly the way a consumer builds a read-mode cell. */
function renderCell(type: string, value: unknown, field: Record<string, unknown> = {}) {
  const Renderer = getCellRenderer(resolveCellRendererType({ type }) || type);
  return render(
    <Renderer value={value as any} field={{ type, name: type, ...field } as any} />,
  );
}

/** The unresolved-reference affordance, counted at its own seam. */
const marks = (root: HTMLElement) =>
  root.querySelectorAll<HTMLElement>('[data-slot="unresolved-reference"]');

const textOf = (root: HTMLElement) => (root.textContent ?? '').replace(/\s+/g, ' ').trim();

/**
 * The three primitive shapes that reach the unresolved arm. All three are the
 * SAME state — a reference this screen did not resolve — and the old code gave
 * the first two one answer and the third the opposite one.
 */
const SHAPES: ReadonlyArray<readonly [label: string, value: string]> = [
  ['name-shaped (a person written into a reference column)', 'Ada Lovelace'],
  ['a short readable id — the commonest stored form', 'wo_1'],
  ['opaque, the shape `isLikelyOpaqueId` used to mute away', '01HQZX9K2M4N6P8R'],
];

const REF = { reference: 'sys_user' };

/** Every family that routes through `LookupCellRenderer` — a bigger surface than `user`. */
const FAMILIES = ['lookup', 'master_detail', 'tree'] as const;

describe('objectui#8695 — AGREEMENT: one epistemic state gets ONE answer', () => {
  it('all three shapes render the same treatment, in ONE render', () => {
    const Renderer = getCellRenderer('lookup');
    const { container } = render(
      <div>
        {SHAPES.map(([, value]) => (
          <div key={value} data-shape={value}>
            <Renderer value={value as any} field={{ type: 'lookup', name: 'owner', ...REF } as any} />
          </div>
        ))}
      </div>,
    );

    // Normalise each cell by its OWN raw value: what remains is the treatment.
    // Equality across the three is the assertion the card's title asks for.
    const normalised = SHAPES.map(([, value]) => {
      const cell = container.querySelector<HTMLElement>(`[data-shape="${value}"]`)!;
      return cell.innerHTML.split(value).join('«RAW»');
    });

    expect(
      new Set(normalised).size,
      `the shapes still disagree — one state, ${new Set(normalised).size} answers:\n${[...new Set(normalised)].join('\n')}`,
    ).toBe(1);

    // …and the floor, so "identically wrong" cannot pass the equality above.
    expect(normalised[0], 'the shared answer must BE the stated affordance').toContain(
      'data-slot="unresolved-reference"',
    );
    expect(normalised[0], 'and it must be where the raw value is').toContain('«RAW»');
  });

  it.each(SHAPES)('%s — states unresolved and KEEPS its raw value', (label, value) => {
    const { container } = renderCell('lookup', value, REF);

    expect(marks(container), `${label}: exactly one affordance`).toHaveLength(1);
    // ⛔ The evidence-destruction half of the defect: the muted `—` replaced
    // the id outright, so the only readable trace of a dirty row was gone.
    expect(
      textOf(container),
      `${label}: the raw value is the only clue for diagnosing a dirty row`,
    ).toBe(value);

    const stated = marks(container)[0]!.getAttribute('title') ?? '';
    expect(stated.length, `${label}: the affordance must state something`).toBeGreaterThan(0);
    expect(stated, `${label}: the sentence must name the value it is about`).toContain(value);
  });

  it.each(FAMILIES)('`%s` routes to the same answer — the surface is all three', (family) => {
    const seen = SHAPES.map(([, value]) => {
      const { container } = renderCell(family, value, REF);
      const html = container.innerHTML.split(value).join('«RAW»');
      cleanup();
      return html;
    });
    expect(new Set(seen).size, `${family}: the shapes disagree on this family`).toBe(1);
    expect(seen[0], `${family} must state the affordance too`).toContain(
      'data-slot="unresolved-reference"',
    );
  });
});

describe('objectui#8695 — ADDITIVE, NOT SUBTRACTIVE: the sentence that graded this card', () => {
  // The name-shaped case is the dangerous one: on the unfixed tree the lookup
  // cell and the `text` cell produced the SAME string of DOM, so nothing on
  // screen separated "we resolved this reference" from "we resolved nothing".
  it.each(SHAPES)('%s no longer renders identically to a `text` cell', (label, value) => {
    const asLookup = renderCell('lookup', value, REF).container.innerHTML;
    cleanup();
    const asText = renderCell('text', value).container.innerHTML;

    expect(asText, 'control: a text cell prints the bare string, unchanged by this card').toBe(
      `<span class="block max-w-full truncate" title="${value}">${value}</span>`,
    );
    expect(
      asLookup,
      `${label}: a lookup cell that is byte-identical to a text cell states nothing`,
    ).not.toBe(asText);
  });

  it('the multi-value shape is not left silent while the scalar one speaks', () => {
    // One unresolved entry of each shape and one RESOLVED entry, in one cell:
    // the resolved chip is this render's own positive control.
    const { container } = renderCell(
      'lookup',
      ['Ada Lovelace', '01HQZX9K2M4N6P8R', { id: 'a_1', name: 'Globex' }],
      { reference: 'account' },
    );

    expect(marks(container), 'both unresolved chips say so').toHaveLength(2);
    expect(
      [...marks(container)].map((m) => m.textContent),
      'and both keep their raw value inside the chip',
    ).toEqual(['Ada Lovelace', '01HQZX9K2M4N6P8R']);
    expect(textOf(container), 'the resolved chip is untouched').toContain('Globex');
  });

  it('the overflow chip lists the values it hides, not a row of dashes', () => {
    const { container } = renderCell(
      'lookup',
      ['a', 'b', 'c', 'Ada Lovelace', '01HQZX9K2M4N6P8R'],
      { reference: 'account' },
    );
    const overflow = screen.getByText('+2');
    expect(
      overflow.getAttribute('title'),
      'the hidden references stay reachable — `—, —` named nothing',
    ).toBe('Ada Lovelace, 01HQZX9K2M4N6P8R');
    expect(container).toBeTruthy();
  });
});

describe('objectui#8695 — THE SENTENCE: epistemic, and about a RECORD', () => {
  it.each(SHAPES)('%s — says what it knows, never that the record is absent', (label, value) => {
    const { container } = renderCell('lookup', value, REF);
    const stated = marks(container)[0]!.getAttribute('title') ?? '';

    // Six causes reach this arm — including a record the viewer may simply not
    // be allowed to read. An ontological claim would be false for most of them.
    expect(
      stated,
      `${label}: this cell cannot know the record is absent — only that it did not resolve it`,
    ).not.toMatch(/not found|does not exist|no such|invalid|missing/i);
    expect(stated, `${label}: it must say what it DOES know`).toMatch(/unresolved/i);
  });

  // ⭐ The one place objectui#8434's remedy did NOT transplant as-is. Its pack
  // value ends "was not resolved to a user", which is false on a `lookup`
  // pointing at any other object — and two existing tests pin that wording
  // byte-for-byte, so it could not be widened in place either.
  it('the lookup sentence is a SIBLING key, and never claims the target is a user', () => {
    const { container } = renderCell('lookup', 'Ada Lovelace', { reference: 'mtc_work_order' });
    const stated = marks(container)[0]!.getAttribute('title') ?? '';

    expect(stated, 'a work order is not a user').not.toMatch(/\buser\b/i);
    expect(
      (en as any).detail.unresolvedLookupReference,
      'the two sentences must stay separate keys',
    ).not.toBe((en as any).detail.unresolvedReference);
  });

  it('the provider-less sentence is byte-equal to the `en` pack value', () => {
    // The English fallback lives in code (the provider-less path) and the pack
    // serves the same sentence; `check:i18n-keys` cannot compare this shape,
    // so this pin is the comparison instead.
    const { container } = renderCell('lookup', 'Ada Lovelace', REF);
    const stated = marks(container)[0]!.getAttribute('title');
    const packed = (en as any).detail.unresolvedLookupReference.replace('{{value}}', 'Ada Lovelace');
    expect(stated, 'the code fallback and the en pack must not drift apart').toBe(packed);
  });
});

describe('objectui#8695 — POSITIVE CONTROLS: a resolved reference is untouched', () => {
  // Three ways a lookup resolves. All three must render exactly as they do
  // today, unmarked — otherwise this repair is indistinguishable from
  // "every lookup now looks broken".
  it('an EXPANDED record renders its name, unmarked, exactly as before', () => {
    const { container } = renderCell('lookup', { id: 'a_1', name: 'Globex' }, { reference: 'account' });
    expect(marks(container), 'a resolved reference is not unresolved').toHaveLength(0);
    expect(container.innerHTML).toBe(
      '<span class="block max-w-full truncate" title="Globex">Globex</span>',
    );
  });

  it("the author's `options` resolve the id, unmarked, exactly as before", () => {
    const { container } = renderCell('lookup', '01HQZX9K2M4N6P8R', {
      ...REF,
      options: [{ value: '01HQZX9K2M4N6P8R', label: 'Globex' }],
    });
    expect(marks(container), 'an authored option names the reference').toHaveLength(0);
    expect(container.innerHTML).toBe(
      '<span class="block max-w-full truncate" title="Globex">Globex</span>',
    );
  });

  it('the fetch-on-demand resolver names it, and the affordance goes away', async () => {
    const findOne = vi.fn(async (_o: string, id: string) => ({ id, name: 'Globex' }));
    const Renderer = getCellRenderer('lookup');
    const { container } = render(
      <SchemaRendererProvider dataSource={{ findOne, find: vi.fn() } as any}>
        <Renderer
          value={'01ARZ3NDEKTSV4RRFFQ69G5FAV' as any}
          field={{ type: 'lookup', name: 'account', reference: 'account' } as any}
        />
      </SchemaRendererProvider>,
    );

    // ⚠️ The first paint is one of the six causes: IN FLIGHT. The sentence is
    // true of it too — this screen has not resolved it — which is why no
    // separate "loading" answer is invented here. It is also not new: the same
    // paint drew the muted `—` before this card.
    expect(marks(container), 'the pending paint states the same true thing').toHaveLength(1);
    await waitFor(() => expect(screen.getByText('Globex')).toBeInTheDocument());
    expect(marks(container), 'once resolved, nothing is marked').toHaveLength(0);
  });

  it('an EMPTY cell keeps `EmptyValue` — a different state, a different answer', () => {
    const { container } = renderCell('lookup', null, REF);
    expect(marks(container), 'nothing to resolve is not a failure to resolve').toHaveLength(0);
    expect(container.querySelector('[data-slot="empty-value"]')).not.toBeNull();
    expect(textOf(container)).toBe('—');
  });

  it('the affordance sits INSIDE the record link, which still addresses the record', () => {
    // The raw value IS the foreign key, so an unresolved reference is still
    // worth being able to open (objectui#4336). The marker must not cost that.
    const Renderer = getCellRenderer('lookup');
    const host = {
      resolve: () => ({}),
      recordHref: (objectName: string, recordId: string | number) => `/o/${objectName}/r/${recordId}`,
      openRecord: vi.fn(),
    } as any;
    const { container } = render(
      <RelatedRecordActionsProvider value={host}>
        <Renderer
          value={'01HQZX9K2M4N6P8R' as any}
          field={{ type: 'lookup', name: 'account', reference: 'account' } as any}
        />
      </RelatedRecordActionsProvider>,
    );
    const anchor = container.querySelector('a');
    expect(anchor, 'the reference is still navigable').not.toBeNull();
    expect(anchor).toHaveAttribute('href', '/o/account/r/01HQZX9K2M4N6P8R');
    expect(marks(container), 'and it states that it did not resolve').toHaveLength(1);
  });
});

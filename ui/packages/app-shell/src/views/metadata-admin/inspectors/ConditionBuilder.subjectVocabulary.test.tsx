// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ConditionBuilder — caller-supplied subject vocabulary (objectui#6296).
 *
 * Two things are pinned here, and the second is the one that protects
 * production:
 *
 *  1. A caller may declare the subject vocabulary this mount site actually
 *     binds — a `fieldPrefix` (so a FLATTENED-scoped site such as the flow
 *     designer's entry condition gets bare `status`, not `record.status`) and
 *     `includePrevious` (so `previous.FIELD` subjects, and the create-path
 *     idiom `previous == null`, are offerable).
 *
 *  2. DEFAULT-PATH INVARIANCE. Most consumer files mount this component
 *     without declaring a vocabulary, so every one of them must keep behaving
 *     exactly as it did. The pins below assert the `record.` prefix
 *     POSITIVELY (the option list, and the CEL a fresh row compiles to)
 *     rather than snapshotting, so changing the default would go red rather
 *     than merely re-baseline.
 *
 *     ⚠️ This paragraph used to give the mount-site census as a figure and to
 *     state that no consumer passes `subjects`. Both had expired by the time
 *     objectui#9855 read them — the flow trigger declares a `context` today —
 *     so they are replaced by a pointer rather than a fresh number (AGENTS.md
 *     #9): `git grep '<ConditionBuilder'` enumerates the mount sites.
 *
 * ── The acceptance-criterion instrument ──────────────────────────────────
 *
 * The corpus below is every start-node entry condition shipped in
 * objectstack's example apps, plus the HotCRM example quoted in #6226's body.
 * The measurement is ROW MODE adoption, and "row mode" is asserted
 * STRUCTURALLY, never by "the editor shows my text back":
 *
 *   - RAW mode renders the `Builder` toggle and a CelPredicateField; it has
 *     NO per-row remove buttons and NO compiled-CEL preview.
 *   - ROW mode renders the `Expression` toggle, one `Remove condition` button
 *     PER PARSED ROW, and a preview of the CEL those rows compile to.
 *
 * So a row-mode verdict here requires N structured rows to exist as controls.
 * An implementation that widened the raw fallback to swallow the corpus would
 * score zero on this instrument, not full marks: `rows` would be 0 and the
 * `Builder` toggle would be on screen.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ConditionBuilder calls useObjectFields(objectName) unconditionally even when
// `fields` is supplied (objectui#4697), so stub the shared metadata client to
// keep mount-time fetches off the network. Same mechanism as
// ConditionBuilder.test.tsx.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]), withPreviewDrafts() { return this; } },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { ConditionBuilder } from './ConditionBuilder';

afterEach(cleanup);

const FIELDS = [
  { name: 'status', label: 'Status' },
  { name: 'amount', label: 'Amount' },
  { name: 'secret', label: 'Secret', hidden: true },
];

/* ── mode probe ─────────────────────────────────────────────────────────── */

interface Probe {
  /** 'row' | 'raw' — from the toggle button, which is mutually exclusive. */
  mode: 'row' | 'raw' | 'indeterminate';
  /** Structured rows actually mounted as controls (0 in raw mode). */
  rows: number;
  /** The CEL those rows compile to, as previewed (null in raw mode). */
  compiled: string | null;
}

function probe(container: HTMLElement): Probe {
  const buttons = Array.from(container.querySelectorAll('button'));
  const hasBuilderToggle = buttons.some((b) => b.textContent?.includes('Builder'));
  const hasExprToggle = buttons.some((b) => b.textContent?.includes('Expression'));
  const mode = hasExprToggle && !hasBuilderToggle
    ? 'row'
    : hasBuilderToggle && !hasExprToggle
      ? 'raw'
      : 'indeterminate';
  const rows = container.querySelectorAll('[aria-label="Remove condition"]').length;
  // Read the compiled preview ONLY in row mode, and only from a <div>. The raw
  // editor is itself a mono <textarea>, so a bare `.font-mono` lookup would
  // hand back the author's own text and make a widened raw fallback read as a
  // successful round-trip — the exact false green this instrument exists to
  // rule out.
  const preview = mode === 'row' ? container.querySelector('div.font-mono') : null;
  return { mode, rows, compiled: preview ? (preview.textContent ?? '') : null };
}

function mount(value: string, vocab?: Record<string, unknown>) {
  const { container } = render(
    <ConditionBuilder
      label="Entry condition"
      value={value}
      onCommit={() => {}}
      objectName="showcase_task"
      fields={FIELDS}
      {...vocab}
    />,
  );
  return container;
}

/* ── the corpus ─────────────────────────────────────────────────────────── */

/** Every start-node entry condition shipped in objectstack's example apps
 *  (measured on objectstack `origin/main`), plus the HotCRM example from
 *  #6226's card body. `parens` marks the two that are beyond the row grammar
 *  for reasons that have nothing to do with subjects — mixed `&&`/`||` with a
 *  parenthesised group. Extending the grammar is out of this card's scope, so
 *  those two are expected to stay on raw mode and are excluded from the
 *  round-trip denominator (counted separately, so the number stays honest). */
/* `src` names the FILE only. It carried a line address until objectui#8047:
 * `$src` is spliced into the case name below, nothing reads a test name, and a
 * line in another repository's example app moves without anything here going
 * red. `$#` restores the identity the address was carrying. */
const CORPUS: Array<{ src: string; cel: string; parens?: true }> = [
  { src: 'showcase/dynamic-approval.flow.ts', cel: 'title != previous.title' },
  { src: 'showcase/flows/index.ts', cel: 'status == "done" && previous.status != "done"' },
  { src: 'showcase/flows/index.ts', cel: 'assignee != previous.assignee' },
  { src: 'showcase/flows/index.ts', cel: 'budget > 100000 && budget != previous.budget' },
  { src: 'showcase/flows/index.ts', cel: 'status == "done" && previous.status != "done"' },
  { src: 'showcase/flows/index.ts', cel: 'status == "done" && previous.status != "done"' },
  { src: 'showcase/flows/index.ts', cel: 'status == "done" && previous.status != "done"' },
  { src: 'showcase/flows/index.ts', cel: 'status == "completed" && previous.status != "completed"' },
  { src: 'showcase/flows/index.ts', cel: 'status == "done" && previous.status != "done"' },
  { src: 'showcase/flows/index.ts', cel: 'status == "done" && previous.status != "done"' },
  { src: 'showcase/flows/index.ts', cel: 'status == "sent" && previous.status != "sent"' },
  { src: 'showcase/flows/index.ts', cel: 'health == "red" && previous.health != "red"' },
  { src: 'showcase/flows/index.ts', cel: 'status == "submitted" && previous.status != "submitted"' },
  { src: 'showcase/flows/index.ts', cel: 'status == "submitted" && previous.status != "submitted" && total_amount >= 5000' },
  { src: 'showcase/flows/index.ts', cel: "priority == 'urgent' && (previous == null || previous.priority != 'urgent')", parens: true },
  { src: 'todo/task.flow.ts', cel: 'status == "completed" && previous.status != "completed"' },
  { src: '#6226 card body (HotCRM)', cel: 'contract_term_months > 24 && (previous == null || previous.contract_term_months <= 24)', parens: true },
];

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('#6296 acceptance criterion — shipped flow-entry conditions round-trip into ROW mode', () => {
  const roundTrippable = CORPUS.filter((c) => !c.parens);

  it.each(roundTrippable)('adopts $src (corpus row $#) as structured rows', ({ cel }) => {
    const p = probe(mount(cel));
    expect(p.mode).toBe('row');
    // Structural, not textual: the rows exist as controls...
    expect(p.rows).toBeGreaterThan(0);
    // ...and they compile back to the author's own CEL.
    expect(norm(p.compiled ?? '')).toBe(norm(cel));
  });

  it('reports the corpus-wide adoption rate', () => {
    const adopted = roundTrippable.filter((c) => {
      const p = probe(mount(c.cel));
      cleanup();
      return p.mode === 'row' && p.rows > 0 && norm(p.compiled ?? '') === norm(c.cel);
    });
    expect(adopted.length).toBe(roundTrippable.length);
  });

  it.each(CORPUS.filter((c) => c.parens))(
    'leaves $src on raw mode — mixed joins with a parenthesised group are a GRAMMAR limit, not a subject one',
    ({ cel }) => {
      const p = probe(mount(cel));
      expect(p.mode).toBe('raw');
      expect(p.rows).toBe(0);
      expect(p.compiled).toBeNull();
    },
  );
});

/* ── positive controls for the instrument itself ────────────────────────── */

describe('#6296 probe instrument — positive controls', () => {
  it('a predicate the builder has always adopted reads as ROW with rows > 0', () => {
    const p = probe(mount("record.status == 'done'"));
    expect(p).toMatchObject({ mode: 'row', rows: 1 });
    expect(p.compiled).toBe("record.status == 'done'");
  });

  it('a predicate the builder has never adopted reads as RAW with rows === 0', () => {
    const p = probe(mount("record.status in ['sent', 'paid']"));
    expect(p).toMatchObject({ mode: 'raw', rows: 0, compiled: null });
  });

  it('an empty value opens in ROW mode with no rows (fresh condition)', () => {
    const p = probe(mount(''));
    expect(p).toMatchObject({ mode: 'row', rows: 0, compiled: null });
  });
});

/* ── the subject vocabulary ─────────────────────────────────────────────── */

beforeAll(() => {
  // Radix Select probes pointer-capture APIs the test DOM lacks.
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!Element.prototype[m]) {
      // @ts-expect-error test shim
      Element.prototype[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
});

/** Open the row's SUBJECT dropdown and read back every subject it offers. */
async function subjectOptions(container: HTMLElement): Promise<string[]> {
  const trigger = container.querySelectorAll('[role="combobox"]')[0] as HTMLElement;
  await userEvent.click(trigger);
  const opts = await screen.findAllByRole('option');
  return opts.map((o) => o.textContent ?? '');
}

/** A mounted builder holding exactly one row, ready to have its subject read. */
function mountOneRow(vocab?: Record<string, unknown>) {
  const onCommit = vi.fn();
  const { container } = render(
    <ConditionBuilder
      label="Entry condition"
      value="placeholder_subject == 'x'"
      onCommit={onCommit}
      objectName="showcase_task"
      fields={FIELDS}
      {...vocab}
    />,
  );
  return { container, onCommit };
}

describe('#6296 DEFAULT-PATH INVARIANCE — the record-scoped consumers are untouched', () => {
  // These assert the record-scoped default POSITIVELY, so changing it goes red.
  //
  // ⚠️ This block's heading used to carry a census of the mount sites and the
  // claim that none of them passes `subjects`. Both had already expired when
  // objectui#9855 read them — the flow trigger declares a `context` today — so
  // the numbers are gone rather than refreshed (AGENTS.md #9: point at the
  // instrument, never write down its answer). `git grep '<ConditionBuilder'`
  // enumerates the mount sites, and the mounts that declare a vocabulary are
  // the ones that pass `subjects`.
  it('offers record.<field> for the catalog, plus the record/user context, and nothing else', async () => {
    const { container } = mountOneRow();
    const opts = await subjectOptions(container);
    expect(opts).toEqual([
      'record.status',
      'record.amount',
      'record.id',
      'user.id',
      'user.email',
      'user.role',
      'user.isAdmin',
      // ⛔ no `org.id`: objectui#9855 withdrew it — no host binds an `org` root
      // and the engine refuses the spelling. The verdict behind that removal is
      // re-derived from the engine in `ConditionBuilder.contextSubjects.test.tsx`;
      // this case is the shape half, and reddens if the offer comes back.
      // the row's own out-of-vocabulary subject is appended so it is not lost
      'placeholder_subject',
    ]);
  });

  it('offers no previous.* subject by default', async () => {
    const { container } = mountOneRow();
    const opts = await subjectOptions(container);
    expect(opts.filter((o) => o.startsWith('previous'))).toEqual([]);
  });

  it('hides hidden fields, as it always has', async () => {
    const { container } = mountOneRow();
    expect(await subjectOptions(container)).not.toContain('record.secret');
  });

  it('COMPILES a chosen subject with the record. prefix — the behavioural half', async () => {
    const { container, onCommit } = mountOneRow();
    const opts = await subjectOptions(container);
    expect(opts).toContain('record.amount');
    await userEvent.click(screen.getByRole('option', { name: 'record.amount' }));
    expect(onCommit).toHaveBeenCalledWith("record.amount == 'x'");
  });

  it('still emits single quotes for a value the author types here', () => {
    const onCommit = vi.fn();
    const { container } = render(
      <ConditionBuilder label="c" value="record.status == 'done'" onCommit={onCommit}
        objectName="showcase_task" fields={FIELDS} />,
    );
    const valueBox = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(valueBox, { target: { value: 'sent' } });
    expect(onCommit).toHaveBeenCalledWith("record.status == 'sent'");
  });
});

describe('#6296 a caller may DECLARE the vocabulary its site binds', () => {
  it("fieldPrefix: '' declares a flattened scope — bare field names", async () => {
    const { container } = mountOneRow({ subjects: { fieldPrefix: '' } });
    const opts = await subjectOptions(container);
    expect(opts).toContain('status');
    expect(opts).toContain('amount');
    expect(opts).not.toContain('record.status');
  });

  it('includePrevious offers previous.<field> AND the whole-record `previous`', async () => {
    const { container } = mountOneRow({ subjects: { fieldPrefix: '', includePrevious: true } });
    const opts = await subjectOptions(container);
    expect(opts).toContain('previous');
    expect(opts).toContain('previous.status');
    expect(opts).toContain('previous.amount');
    expect(opts).not.toContain('previous.secret');
  });

  it('a declared context list replaces the record-scoped default', async () => {
    const { container } = mountOneRow({
      subjects: { fieldPrefix: '', context: [{ value: 'user.id' }] },
    });
    const opts = await subjectOptions(container);
    expect(opts).toContain('user.id');
    // `record.id` is not bound at a flattened site, so it must not be offered.
    expect(opts).not.toContain('record.id');
  });

  it('authors the create-path idiom `previous == null` end to end', async () => {
    const onCommit = vi.fn();
    const { container } = render(
      <ConditionBuilder label="Entry condition" value="placeholder_subject == 'x'" onCommit={onCommit}
        objectName="showcase_task" fields={FIELDS}
        subjects={{ fieldPrefix: '', includePrevious: true }} />,
    );
    await userEvent.click(container.querySelectorAll('[role="combobox"]')[0] as HTMLElement);
    await userEvent.click(screen.getByRole('option', { name: 'previous' }));
    const valueBox = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(valueBox, { target: { value: 'null' } });
    expect(onCommit).toHaveBeenLastCalledWith('previous == null');
  });

  it('a flattened site round-trips its own output back into rows', () => {
    const p = probe(mount('status == "done" && previous.status != "done"',
      { subjects: { fieldPrefix: '', includePrevious: true } }));
    expect(p).toMatchObject({ mode: 'row', rows: 2 });
    expect(p.compiled).toBe('status == "done" && previous.status != "done"');
  });
});

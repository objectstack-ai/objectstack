// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **The flow designer's Entry condition opens in the row builder** (objectui#6226).
 *
 * ## What this file measures, and why it is not the sibling file's measurement
 *
 * `ConditionBuilder.subjectVocabulary.test.tsx` (objectui#6296) mounts
 * `ConditionBuilder` DIRECTLY and hands it a `subjects` object written by the
 * test. That proved the component can express a flattened vocabulary. It could
 * not — and did not — prove anything about the flow designer, because it never
 * mounted it: its corpus sweep would score exactly the same against a tree where
 * `FlowNodeConfigField` has never heard of `ConditionBuilder`. Re-running that
 * shape here would measure the prerequisite a second time and report it as this
 * card's result.
 *
 * So the instrument here mounts **the flow inspector's field**, driven by the
 * **real descriptor** out of `FLOW_NODE_CONFIG` and the **real vocabulary**
 * `resolveFlowScope` computes from a real draft. Nothing about the wiring is
 * supplied by the test: the test supplies a flow, and asks what the author sees.
 *
 * Concretely, every assertion below runs through the whole chain —
 *
 *     draft ──resolveFlowScope──▶ TriggerScope ──▶ FlowNodeConfigField
 *       │                         (fieldPrefix,        │
 *       │                          includePrevious)    ▼
 *       └──fieldsForNodeType('start')──▶ descriptor ──▶ ConditionBuilder
 *                                        (conditionBuilder: true)
 *
 * — so cutting ANY link in it goes red here. `FlowNodeInspector.entryCondition
 * .test.tsx` next door closes the last gap by mounting the whole inspector, so
 * the `useFlowScope` → inspector → field plumbing is measured too rather than
 * assumed.
 *
 * ## Row mode is asserted structurally
 *
 * Same discipline as the sibling suite, for the same reason: a "row mode"
 * verdict requires N structured row controls to EXIST, plus the compiled-CEL
 * preview that only row mode renders. An implementation that widened a raw
 * fallback to swallow the corpus would score zero here, not full marks.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The trigger object's field catalog. Stubbed at the hook rather than at the
 * transport so it arrives SYNCHRONOUSLY: the catalog only shapes the subject
 * dropdown, and an async arrival would make every mode probe race a fetch it
 * does not depend on. Same stub the sibling FlowNodeInspector suites use.
 */
const FIELDS = vi.hoisted(() => [
  { name: 'status', label: 'Status', type: 'text', hidden: false },
  { name: 'amount', label: 'Amount', type: 'number', hidden: false },
  { name: 'contract_term_months', label: 'Contract term (months)', type: 'number', hidden: false },
  { name: 'secret', label: 'Secret', type: 'text', hidden: true },
]);
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: FIELDS, loading: false, error: null }),
}));

// The raw-mode editor (CelPredicateField) still reaches for the shared metadata
// client; keep its mount-time fetches off the network (objectui#4697).
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]) },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

/** Field names the stubbed catalog puts in scope. */
const FIELD_NAMES_IN_SCOPE = FIELDS.filter((f) => !f.hidden).map((f) => f.name);

import { FlowNodeConfigField } from './FlowNodeConfigField';
import { fieldsForNodeType, type FlowConfigField } from './flow-node-config';
import { resolveFlowScope, type TriggerScope } from './flow-scope';

afterEach(cleanup);

beforeAll(() => {
  // Radix Select probes pointer-capture APIs the test DOM lacks.
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!Element.prototype[m]) {
      // @ts-expect-error test shim
      Element.prototype[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
});

/* ── the real descriptor, the real scope ─────────────────────────────────── */

/** The Start node's `Entry condition` descriptor, read from the shipped config
 *  schema — never a hand-written stand-in, so a descriptor that loses its
 *  `conditionBuilder` flag turns this whole file red. */
const ENTRY_CONDITION: FlowConfigField = (() => {
  const f = fieldsForNodeType('start').find((x) => x.id === 'condition');
  if (!f) throw new Error('start node has no `condition` field — the card premise moved');
  return f;
})();

/** The second `expression` gate on the same node — the LEGACY `criteria` key.
 *  Fenced out of this wiring on purpose; pinned negatively below. */
const LEGACY_CRITERIA: FlowConfigField = (() => {
  const f = fieldsForNodeType('start').find((x) => x.id === 'criteria');
  if (!f) throw new Error('start node has no `criteria` field — the fence premise moved');
  return f;
})();

/** A record-triggered flow, selected AT its start node — the surface the card
 *  is about. `record-after-write` fires on create OR update, so `previous` is
 *  bound (and `previous == null` is the create leg). */
function startNodeScope(triggerType = 'record-after-write'): TriggerScope | undefined {
  const draft = {
    nodes: [{ id: 'start', type: 'start', config: { triggerType, objectName: 'crm_lead' } }],
    edges: [],
  };
  return resolveFlowScope(draft, 'start').trigger;
}

/* ── mode probe (structural — see the header) ────────────────────────────── */

interface Probe {
  mode: 'row' | 'raw' | 'indeterminate';
  rows: number;
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
  // Read the compiled preview ONLY in row mode, and only from a <div>: the raw
  // editor is itself a mono <textarea>, so a bare `.font-mono` lookup would hand
  // back the author's own text and let a widened raw fallback read as a
  // successful round-trip.
  const preview = mode === 'row' ? container.querySelector('div.font-mono') : null;
  return { mode, rows, compiled: preview ? (preview.textContent ?? '') : null };
}

/** True when the field rendered the PRE-#6226 control: a single-line
 *  VariableTextInput, which is neither builder mode. */
function isPlainTextInput(container: HTMLElement): boolean {
  const p = probe(container);
  return p.mode === 'indeterminate' && p.rows === 0 && container.querySelector('textarea, input') !== null;
}

function mountField(opts: {
  value: string;
  field?: FlowConfigField;
  triggerScope?: TriggerScope;
  onCommit?: (v: unknown) => void;
}) {
  const { container } = render(
    <FlowNodeConfigField
      field={opts.field ?? ENTRY_CONDITION}
      value={opts.value}
      onCommit={opts.onCommit ?? (() => {})}
      triggerScope={'triggerScope' in opts ? opts.triggerScope : startNodeScope()}
    />,
  );
  return container;
}

/* ── the corpus ──────────────────────────────────────────────────────────── */

/**
 * Every start-node entry condition shipped in objectstack's example apps, plus
 * the HotCRM example from #6226's card body — the same frozen snapshot the
 * sibling `ConditionBuilder.subjectVocabulary.test.tsx` measures the COMPONENT
 * against. Held as a second copy on purpose: importing it would re-execute that
 * file's whole suite inside this one. `CORPUS_SIZE` below pins the count in both
 * places, so a copy that silently loses an entry goes red instead of quietly
 * under-measuring.
 *
 * `parens` marks the two that are beyond the row grammar for a reason that has
 * nothing to do with subjects — `&&` mixed with a parenthesised `||` group.
 * Extending the grammar is explicitly a separate card, so those two are EXPECTED
 * to stay on raw mode and are held out of the round-trip denominator instead of
 * flattering it.
 */
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

/** Pinned in BOTH copies of the corpus. See the comment above. */
const CORPUS_SIZE = 17;
const ROW_ELIGIBLE = CORPUS.filter((c) => !c.parens);

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/* ── ACCEPTANCE: the FLOW FIELD, before/after ────────────────────────────── */

describe('#6226 acceptance — the flow Entry condition opens in ROW mode', () => {
  it('the corpus is the size both copies pin', () => {
    expect(CORPUS).toHaveLength(CORPUS_SIZE);
    expect(ROW_ELIGIBLE).toHaveLength(15);
  });

  it.each(ROW_ELIGIBLE)('adopts $src (corpus row $#) as structured rows AT THE FLOW FIELD', ({ cel }) => {
    const p = probe(mountField({ value: cel }));
    expect(p.mode).toBe('row');
    // The rows exist as controls…
    expect(p.rows).toBeGreaterThan(0);
    // …and compile back to the author's own CEL, byte for byte.
    expect(norm(p.compiled ?? '')).toBe(norm(cel));
  });

  it('reports the adoption rate at the flow field: 15/15 row-eligible, 15/17 of the corpus', () => {
    const adopted = ROW_ELIGIBLE.filter((c) => {
      const p = probe(mountField({ value: c.cel }));
      cleanup();
      return p.mode === 'row' && p.rows > 0 && norm(p.compiled ?? '') === norm(c.cel);
    });
    expect(adopted).toHaveLength(ROW_ELIGIBLE.length);
    expect(adopted.length / CORPUS.length).toBeCloseTo(15 / 17);
  });

  it.each(CORPUS.filter((c) => c.parens))(
    'leaves $src on the raw escape hatch — a GRAMMAR limit, not a subject one',
    ({ cel }) => {
      const p = probe(mountField({ value: cel }));
      expect(p.mode).toBe('raw');
      expect(p.rows).toBe(0);
    },
  );
});

/* ── the instrument's own positive controls ──────────────────────────────── */

describe('#6226 probe instrument — positive controls', () => {
  it('an empty condition opens in ROW mode with no rows (a fresh flow)', () => {
    expect(probe(mountField({ value: '' }))).toMatchObject({ mode: 'row', rows: 0, compiled: null });
  });

  it('a predicate outside the row grammar reads RAW with rows === 0', () => {
    expect(probe(mountField({ value: "status in ['sent', 'paid']" }))).toMatchObject({
      mode: 'raw',
      rows: 0,
    });
  });

  it('`isPlainTextInput` can see the PRE-#6226 control, so its absence below is a measurement', () => {
    // Same field, vocabulary withheld → the old single-line control. If this
    // probe could not recognise it, every "no longer a plain input" assertion
    // in this file would be vacuous.
    expect(isPlainTextInput(mountField({ value: 'status == "done"', triggerScope: undefined }))).toBe(true);
  });
});

/* ── the subject vocabulary AT THIS SITE ─────────────────────────────────── */

/** Open the row's SUBJECT dropdown and read back every subject offered. */
async function subjectOptions(container: HTMLElement): Promise<string[]> {
  const trigger = container.querySelectorAll('[role="combobox"]')[0] as HTMLElement;
  await userEvent.click(trigger);
  const opts = await screen.findAllByRole('option');
  return opts.map((o) => o.textContent ?? '');
}

/** The field holding exactly one row, ready to have its subject read. The
 *  catalog is supplied through the stubbed metadata client the builder fetches
 *  with, so the vocabulary under test is the one the WIRING produced. */
function mountOneRow(triggerScope: TriggerScope | undefined = startNodeScope()) {
  const onCommit = vi.fn();
  const { container } = render(
    <FlowNodeConfigField
      field={ENTRY_CONDITION}
      value="placeholder_subject == 'x'"
      onCommit={onCommit}
      triggerScope={triggerScope}
    />,
  );
  return { container, onCommit };
}

describe('#6226 the flow entry field offers the FLATTENED trigger vocabulary', () => {
  it('offers BARE field names — not record.<field>', async () => {
    const opts = await subjectOptions(mountOneRow().container);
    expect(opts).toContain('status');
    expect(opts).toContain('amount');
    expect(opts).not.toContain('record.status');
  });

  it('offers `previous` and `previous.<field>` — the change-detection idiom', async () => {
    const opts = await subjectOptions(mountOneRow().container);
    expect(opts).toContain('previous');
    expect(opts).toContain('previous.status');
    expect(opts).toContain('previous.amount');
  });

  it('does NOT offer `record.id` — one subject per value, in the bare spelling', async () => {
    const opts = await subjectOptions(mountOneRow().container);
    // The builder's record-scoped DEFAULT context would have put it here. The
    // flow entry field declares its own (empty) context: the engine binds
    // `record` at this gate too (objectui#11789), but `record.FIELD` is the
    // same value as the bare `FIELD` already offered, not a second subject.
    expect(opts).not.toContain('record.id');
    expect(opts.filter((o) => o.startsWith('record.'))).toEqual([]);
  });

  it('hides hidden fields', async () => {
    const opts = await subjectOptions(mountOneRow().container);
    expect(opts).not.toContain('secret');
    expect(opts).not.toContain('previous.secret');
  });

  it('every offered subject has a root the field\'s OWN ref-check accepts', async () => {
    // The self-contradiction guard, as a closed property rather than a spot
    // check: this editor may not offer a spelling the warning rendered directly
    // beneath it would call out of scope. Roots come from the same resolved
    // scope the inspector hands the check.
    const opts = await subjectOptions(mountOneRow().container);
    const offered = opts.filter((o) => o !== 'placeholder_subject');
    expect(offered.length).toBeGreaterThan(0);
    const allowedRoots = new Set([...FIELD_NAMES_IN_SCOPE, 'previous']);
    for (const o of offered) expect(allowedRoots.has(o.split('.')[0])).toBe(true);
  });

  it('COMPILES a chosen subject BARE — the behavioural half', async () => {
    const { container, onCommit } = mountOneRow();
    const opts = await subjectOptions(container);
    expect(opts).toContain('amount');
    await userEvent.click(screen.getByRole('option', { name: 'amount' }));
    expect(onCommit).toHaveBeenCalledWith("amount == 'x'");
  });

  it('authors the create-path idiom `previous == null` end to end', async () => {
    const { container, onCommit } = mountOneRow();
    await userEvent.click(container.querySelectorAll('[role="combobox"]')[0] as HTMLElement);
    await userEvent.click(screen.getByRole('option', { name: 'previous' }));
    const valueBox = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(valueBox, { target: { value: 'null' } });
    expect(onCommit).toHaveBeenLastCalledWith('previous == null');
  });

  it('re-emits a double-quoted literal as authored, so an adopted flow is not rewritten', () => {
    const onCommit = vi.fn();
    const container = mountField({ value: 'status == "done" && previous.status != "done"', onCommit });
    const valueBox = container.querySelectorAll('input')[0] as HTMLInputElement;
    fireEvent.change(valueBox, { target: { value: 'shipped' } });
    expect(onCommit).toHaveBeenCalledWith('status == "shipped" && previous.status != "done"');
  });
});

/* ── the escape hatch ────────────────────────────────────────────────────── */

describe('#6226 raw CEL remains reachable — the ruling\'s escape hatch', () => {
  it('a row-mode field can be switched to the raw expression editor', async () => {
    const container = mountField({ value: 'status == "done"' });
    expect(probe(container).mode).toBe('row');
    const toggle = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Expression'),
    )!;
    expect(toggle).toBeTruthy();
    await userEvent.click(toggle);
    expect(probe(container).mode).toBe('raw');
  });

  it('a raw-mode field offers the way back to the builder', () => {
    const container = mountField({ value: CORPUS.find((c) => c.parens)!.cel });
    expect(probe(container).mode).toBe('raw');
    const back = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Builder'),
    );
    expect(back).toBeTruthy();
  });
});

/* ── FENCES: what this wiring deliberately does NOT touch ────────────────── */

describe('#6226 fences — declared opt-in, never inferred from `kind`', () => {
  it('the LEGACY `criteria` gate keeps the raw input (fold-or-fence: FENCED)', () => {
    // `criteria` is the second `expression` gate on the same node. It renders
    // only when a stored value is already present (`showWhen.__legacy__` never
    // matches), its own help steers authors to `condition`, and the builder
    // recompiles a predicate wholesale on first edit — so upgrading it would
    // polish a key the product is retiring instead of migrating it. Reasoned in
    // the PR body; pinned here so the fence is not lost by omission.
    expect(LEGACY_CRITERIA.kind).toBe('expression');
    expect(LEGACY_CRITERIA.conditionBuilder).toBeUndefined();
    expect(isPlainTextInput(mountField({ value: 'status == "active"', field: LEGACY_CRITERIA }))).toBe(true);
  });

  it('an `expression` field that did NOT opt in keeps the raw input', () => {
    // `expression` is not a synonym for "record predicate": a `recordId` is a
    // scalar lookup, a `collection` is a list. Only a flagged
    // descriptor may become a builder, even with a vocabulary in hand.
    const plain: FlowConfigField = {
      id: 'recordId', path: ['config', 'recordId'], label: 'Record', kind: 'expression',
    };
    expect(isPlainTextInput(mountField({ value: 'record.id', field: plain }))).toBe(true);
  });

  it('an opted-in field with NO declared vocabulary keeps the raw input', () => {
    // A schedule / manual / webhook trigger binds no record, so
    // `resolveFlowScope` returns no TriggerScope. The builder is not mounted
    // against a guessed scope — the field degrades to what it renders today.
    expect(startNodeScope('schedule')).toBeUndefined();
    expect(isPlainTextInput(mountField({ value: 'status == "done"', triggerScope: undefined }))).toBe(true);
  });

  it("a loop's collection never opts in, so it is never a condition builder (objectui#12390)", () => {
    // A body-less loop's `collection` is a variable name, not a predicate; with
    // the `refMode: 'template'` mark retired, the opt-in is what keeps it out.
    const collection = fieldsForNodeType('loop').find((f) => f.id === 'collection')!;
    expect(collection.conditionBuilder).toBeFalsy();
    expect(isPlainTextInput(mountField({ value: 'leadList', field: collection }))).toBe(true);
  });
});

/* ── the field's other halves still work ─────────────────────────────────── */

describe('#6226 the surrounding field behaviour is unchanged', () => {
  it('still surfaces the ADR-0032 brace-in-CEL error beneath the builder', () => {
    mountField({ value: '{status} == "done"' });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('still shows the descriptor help when the value is clean', () => {
    mountField({ value: 'status == "done"' });
    expect(screen.getByText(ENTRY_CONDITION.help!)).toBeInTheDocument();
  });
});

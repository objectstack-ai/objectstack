// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#3229 — the Page block inspector's conditional-visibility control
 * must author `visibleWhen`, and must SAY "visible when" while doing it.
 *
 * The control used to read/write `block.hidden`. `PageComponentSchema`
 * (`ui/page.zod.ts`) is `.strict()` and has no `hidden` key at all, so the
 * designer — a PRODUCER — was emitting drafts guaranteed to be rejected on
 * save, with a parse error naming a key the author never typed. The canonical
 * key is `visibleWhen` (ADR-0089); `visibility` survives as a deprecated alias.
 *
 * ## Why direction, not just the key name, is pinned here
 *
 * `hidden` and `visibleWhen` are INVERSES (`hidden` true ⇒ gone,
 * `visibleWhen` true ⇒ shown). Renaming the key while leaving "hidden"-flavoured
 * copy on screen would have produced metadata that PARSES and means the
 * opposite — the objectui#3276 class, which #3257's guard is structurally blind
 * to because it only asks whether a draft parses. So these tests assert the
 * rendered OUTCOME of the inspector's own output, in both directions, rather
 * than just `expect(patch).toHaveProperty('visibleWhen')`.
 *
 * FIXTURE DISCIPLINE (objectui#3216's method): no envelope is hand-written.
 * Every fixture is the AUTHORED input fed through `PageSchema.parse`, so a
 * fixture cannot drift from the spec — `visibleWhen` is `ExpressionInputSchema`,
 * which normalizes a bare string into `{ dialect: 'cel', source }`.
 */

import { describe, it, expect, vi, afterEach, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PageSchema } from '@objectstack/spec/ui';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, PredicateScopeProvider } from '@object-ui/react';
import { PageBlockInspector } from './PageBlockInspector';
import type { MetadataInspectorProps } from '../inspector-registry';
import type { SupportedLocale } from '../i18n';

afterEach(cleanup);

/** Selection id for the single block in the fixture page. */
const BLOCK_PATH = 'regions[0].components[0]';

/**
 * Author a page the way a user does, parse it with the spec, and hand the
 * RESULT to the inspector — exactly what the metadata editor loads.
 */
function pageDraft(block: Record<string, unknown>): Record<string, unknown> {
  return PageSchema.parse({
    name: 'home',
    label: 'Home',
    type: 'home',
    template: 'default',
    regions: [{ name: 'main', components: [{ type: 'text', id: 'b1', ...block }] }],
  }) as unknown as Record<string, unknown>;
}

function renderInspector(
  draft: Record<string, unknown>,
  // `onPatch` carries the inspector prop's own signature: `ReturnType<typeof
  // vi.fn>` is the un-instantiated `Mock<Procedure | Constructable>`, which the
  // prop does not accept (objectui#4040). `locale` likewise takes the closed
  // union instead of `string`, which is what forced the `as never` below.
  {
    locale = 'en-US',
    onPatch = vi.fn(),
  }: {
    locale?: SupportedLocale;
    onPatch?: Mock<MetadataInspectorProps['onPatch']>;
  } = {},
) {
  render(
    <PageBlockInspector
      type="page"
      name="home"
      draft={draft}
      selection={{ kind: 'block', id: BLOCK_PATH }}
      onPatch={onPatch}
      onClearSelection={() => {}}
      readOnly={false}
      locale={locale}
    />,
  );
  return onPatch;
}

/**
 * The block as the inspector last wrote it. `onPatch` carries a SHALLOW patch
 * (`{ regions }`), not the whole draft.
 */
function committedBlock(onPatch: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const patch = onPatch.mock.calls.at(-1)![0] as any;
  return patch.regions[0].components[0] as Record<string, unknown>;
}

/** What the editor would actually save: the shallow patch applied to the draft. */
function savedDraft(
  draft: Record<string, unknown>,
  onPatch: ReturnType<typeof vi.fn>,
): Record<string, unknown> {
  return { ...draft, ...(onPatch.mock.calls.at(-1)![0] as Record<string, unknown>) };
}

/** The no-code builder's value box for the single parsed row. */
const rowValueInput = () => screen.getByPlaceholderText('value') as HTMLInputElement;
/** The raw-expression editor (CelPredicateField renders a combobox TEXTAREA). */
const rawEditor = () =>
  screen.getAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;

/* ───────────────────────── the key that is committed ───────────────────── */

describe('PageBlockInspector — conditional visibility authors `visibleWhen` (#3229)', () => {
  it('reads the `source` of a persisted envelope into the control', () => {
    const draft = pageDraft({ visibleWhen: 'record.amount > 10' });
    // Pin what the platform actually stores, so this fails loudly if the spec
    // stops normalizing rather than passing on a stale assumption.
    expect((draft as any).regions[0].components[0].visibleWhen).toEqual({
      dialect: 'cel',
      source: 'record.amount > 10',
    });

    renderInspector(draft);

    // The builder adopted the predicate: its value box carries `10` and the
    // compiled preview echoes the whole thing.
    expect(rowValueInput().value).toBe('10');
    expect(screen.getByText('record.amount > 10')).toBeInTheDocument();
  });

  it('commits `visibleWhen` — and never `hidden`', () => {
    const onPatch = renderInspector(pageDraft({ visibleWhen: 'record.amount > 10' }));

    fireEvent.change(rowValueInput(), { target: { value: '20' } });

    const block = committedBlock(onPatch);
    expect(block).toHaveProperty('visibleWhen');
    // The whole point of the issue: the designer must not type a key the
    // `.strict()` page schema does not have.
    expect(block).not.toHaveProperty('hidden');
    expect(block.visibleWhen).toEqual({ dialect: 'cel', source: 'record.amount > 20' });
  });

  it('the committed draft PARSES — the shape the old `hidden` key could not', () => {
    const draft = pageDraft({ visibleWhen: 'record.amount > 10' });
    const onPatch = renderInspector(draft);
    fireEvent.change(rowValueInput(), { target: { value: '20' } });

    // What the author would be saving. Before #3229 this threw
    // `unrecognized_keys … ["hidden"]`.
    expect(() => PageSchema.parse(savedDraft(draft, onPatch))).not.toThrow();

    // And the counter-proof that the strictness under test is real.
    expect(() => pageDraft({ hidden: 'record.amount > 20' })).toThrow(/hidden/);
  });

  it('authoring from scratch commits the bare-string shorthand under `visibleWhen`', () => {
    const draft = pageDraft({});
    expect((draft as any).regions[0].components[0].visibleWhen).toBeUndefined();
    const onPatch = renderInspector(draft);

    // No prior value ⇒ the builder opens in row mode; switch to the raw editor
    // to author a predicate without driving Radix selects.
    fireEvent.click(screen.getByText('Expression'));
    fireEvent.change(rawEditor(), { target: { value: 'record.amount > 20' } });

    const block = committedBlock(onPatch);
    expect(block.visibleWhen).toBe('record.amount > 20');
    expect(block).not.toHaveProperty('hidden');
    // The spec's pipe normalizes the shorthand to exactly the envelope.
    expect((PageSchema.parse(savedDraft(draft, onPatch)) as any).regions[0].components[0].visibleWhen)
      .toEqual({ dialect: 'cel', source: 'record.amount > 20' });
  });

  it('preserves a non-`cel` dialect and `meta` across an edit (#3218 write rule)', () => {
    const draft = pageDraft({
      visibleWhen: { dialect: 'cel', source: 'record.amount > 10', meta: { rationale: 'Large deals only' } },
    });
    const onPatch = renderInspector(draft);

    fireEvent.change(rowValueInput(), { target: { value: '20' } });

    expect(committedBlock(onPatch).visibleWhen).toEqual({
      dialect: 'cel',
      source: 'record.amount > 20',
      meta: { rationale: 'Large deals only' },
    });
  });

  it('clears the predicate to `undefined` when the author empties it', () => {
    const onPatch = renderInspector(pageDraft({ visibleWhen: 'record.amount > 10' }));

    fireEvent.click(screen.getByLabelText('Remove condition'));

    expect(committedBlock(onPatch).visibleWhen).toBeUndefined();
  });
});

/* ─────────────────────────── the UI copy (semantics) ───────────────────── */

describe('PageBlockInspector — the label says "visible", not "hidden" (#3229)', () => {
  it('labels the control "Visible when" in English', () => {
    renderInspector(pageDraft({}));
    expect(screen.getByText(/Visible when/i)).toBeInTheDocument();
    // A "hide when" label over a show-when-truthy key is how authors come to
    // write the predicate backwards (the #3276 defect class).
    expect(screen.queryByText(/^Hidden/i)).not.toBeInTheDocument();
  });

  it('labels the control 显示条件 in Chinese', () => {
    renderInspector(pageDraft({}), { locale: 'zh-CN' });
    expect(screen.getByText(/显示条件/)).toBeInTheDocument();
    expect(screen.queryByText(/隐藏条件/)).not.toBeInTheDocument();
  });
});

/* ──────────────────────────────── DIRECTION ────────────────────────────── */

/**
 * The acceptance criterion the issue calls a hard requirement: what the
 * inspector writes must MEAN "visible when". These render the inspector's own
 * committed block through `SchemaRenderer` — the renderer `PageBlockCanvas`
 * hands blocks to — and assert both directions.
 */
describe('PageBlockInspector — `visibleWhen` direction is show-when-truthy (#3229)', () => {
  const Block = () => <div data-testid="block">Block</div>;

  beforeEach(() => {
    ComponentRegistry.register('text', Block);
  });
  afterEach(() => {
    ComponentRegistry.unregister?.('text');
  });

  /** Author `record.amount > 20` through the inspector and return the block. */
  function authoredBlock(): Record<string, unknown> {
    const onPatch = renderInspector(pageDraft({ visibleWhen: 'record.amount > 10' }));
    fireEvent.change(rowValueInput(), { target: { value: '20' } });
    const block = committedBlock(onPatch);
    cleanup();
    return block;
  }

  function renderBlock(block: Record<string, unknown>, record: Record<string, unknown>) {
    return render(
      <PredicateScopeProvider scope={{ record }}>
        <SchemaRenderer schema={block as never} />
      </PredicateScopeProvider>,
    );
  }

  it('renders the block when the authored predicate is TRUE', () => {
    renderBlock(authoredBlock(), { amount: 30 });
    expect(screen.getByTestId('block')).toBeInTheDocument();
  });

  it('does NOT render the block when the authored predicate is FALSE', () => {
    const { container } = renderBlock(authoredBlock(), { amount: 5 });
    expect(screen.queryByTestId('block')).not.toBeInTheDocument();
    expect(container.innerHTML).toBe('');
  });

  it('renders the block when there is no predicate at all', () => {
    renderBlock({ type: 'text', id: 'b1' }, { amount: 5 });
    expect(screen.getByTestId('block')).toBeInTheDocument();
  });
});

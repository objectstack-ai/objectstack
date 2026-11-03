// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12897 — on a narrow title row the actions slot no longer takes the
 * title's whole width: a chip that folds by `useStudioTabRowFold` folds to its
 * icon when the title would otherwise be cut, and a cut title says its whole
 * text in its tooltip, before the tooltip the pillar gives it.
 *
 * jsdom has no layout, so the widths are measured in Chromium by
 * `e2e/studio-item-header-title-width.spec.ts` (the Interfaces leaf's 422 px
 * row). Here the row's geometry is stubbed, as the objectui#12707 pin stubs
 * the tab row's: the row's width is the case's, the icon, the kind chip and
 * the other actions are fixed, the chip is as wide as its form, and the
 * title's box is the room the row leaves it, capped at its text. Gaps read 0
 * (no stylesheet).
 *
 * objectstack#29693 (the last describe block) — the title keeps a readable
 * width: when the row would leave it less than its first twelve characters,
 * the identity chips and the item tools fold into the ⋯ menu. The same stubbed
 * row, with the tools (the header's fold contract, as `StudioItemTools` keeps
 * it) and the header's own ⋯ as boxes of their own, and the twelve
 * characters' width stubbed on the text range.
 *
 * objectstack#29691 (the note describe block) — the header's note line (where
 * a pair's edits are saved) sits under the title row, never in it: a note as
 * wide as the row leaves the fold as it was. The stub gives the note its width
 * wherever it is, so a note drawn inside the row takes the title's room.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Workflow } from 'lucide-react';
import { StudioItemHeader, useStudioItemHeaderFold, useStudioTabRowFold, type StudioFoldedTool } from './StudioItemHeader';
import { STUDIO_FOLD_LABEL, STUDIO_KIND_CHIP } from './studio-tokens';
import { StudioCustomizeButton, StudioOverrideChip } from './StudioCustomizeControls';
import { FlowLedgerSwitch } from './FlowLedgerSwitch';
import { t } from '../metadata-admin/i18n';

const TITLE = 'Task board (kanban view)';
const INTERNAL_ID = 'Internal id: object · showcase_task';

/** Stubbed widths, in px. */
const ICON = 32;
const KIND_CHIP = 38;
const OPEN_IN_DATA = 137;
const CHIP_FULL = 132;
const CHIP_FOLDED = 28;
const TITLE_TEXT = 178;
/** objectstack#29693 — the item tools' button group, and the header's own ⋯. */
const TOOLS = 146;
const OWN_MORE = 32;
/** objectstack#29693 — a labelled action: its glyph, and its label while the row shows labels. */
const ACTION_GLYPH = 28;
const ACTION_LABEL = 60;
/** objectstack#29691 — the note line's text: wider than the title row leaves free. */
const NOTE = 400;
const layout = { row: 632 };

const resizeCallbacks = new Set<() => void>();
const spies: Array<{ mockRestore: () => void }> = [];
const realRect = HTMLElement.prototype.getBoundingClientRect;
const rect = (width: number) =>
  ({ left: 0, right: width, width, top: 0, bottom: 32, height: 32, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

const isRow = (el: Element) => el.classList.contains('@container');
const chipWidth = () => {
  const chip = screen.queryByTestId('probe-chip');
  return chip ? (chip.hasAttribute('data-folded') ? CHIP_FOLDED : CHIP_FULL) : 0;
};
const toolsWidth = () => (screen.queryByTestId('probe-tools') ? TOOLS : 0);
const ownMoreWidth = () => (screen.queryByTestId('hdr-more') ? OWN_MORE : 0);
const labelsShown = () => !document.querySelector('[data-fold="labels"]');
/** The labelled actions (the Customize button, the ledger switch): glyph, plus label while shown. */
const labelledWidth = () =>
  document.querySelectorAll('[data-studio-fold-label]').length * (ACTION_GLYPH + (labelsShown() ? ACTION_LABEL : 0));
const actionsWidth = () => chipWidth() + OPEN_IN_DATA + toolsWidth() + ownMoreWidth() + labelledWidth();
/** The kind chip, while the row holds it (objectstack#29693: it can fold into the menu). */
const kindChipWidth = () => {
  const chip = screen.queryByTestId('hdr-kind-chip');
  return chip && !chip.closest('[role="menu"]') ? KIND_CHIP : 0;
};
/** objectstack#29691 — the note, while it is a box of the title row. */
const noteInRowWidth = () => {
  const note = document.querySelector('[data-slot="item-note"]');
  return note?.parentElement && isRow(note.parentElement) ? NOTE : 0;
};
/** The title's box: what the row leaves it, capped at its text. */
const titleBox = () =>
  Math.max(0, Math.min(TITLE_TEXT, layout.row - ICON - kindChipWidth() - actionsWidth() - noteInRowWidth()));

beforeEach(() => {
  layout.row = 632;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly cb: () => void;
      constructor(cb: () => void) {
        this.cb = cb;
        resizeCallbacks.add(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {
        resizeCallbacks.delete(this.cb);
      }
    },
  );
  spies.push(
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (isRow(this)) return rect(layout.row);
      if (this.dataset.testid === 'probe-chip') return rect(chipWidth());
      if (this.dataset.testid === 'hdr-kind-chip') return rect(KIND_CHIP);
      if (this.dataset.testid === 'probe-tools') return rect(TOOLS);
      if (this.dataset.testid === 'hdr-more') return rect(OWN_MORE);
      if (this.hasAttribute('data-studio-fold-label')) return rect(labelsShown() ? ACTION_LABEL : 1);
      if (this.dataset.testid === 'hdr-title') return rect(titleBox());
      if (this.dataset.slot === 'item-note') return rect(NOTE);
      if (this.parentElement && isRow(this.parentElement)) {
        // The identity chips' wrapper is a `contents` box in the console;
        // with no stylesheet here it is a box as wide as the chips it holds.
        if (this.dataset.slot === 'identity-chips') return rect(kindChipWidth());
        if (this.tagName === 'SPAN') return rect(ICON);
        if (this.tagName === 'DIV') return rect(actionsWidth());
      }
      return realRect.call(this);
    }),
  );
  spies.push(
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      if (isRow(this)) return layout.row;
      if (this.dataset.testid === 'hdr-title') return titleBox();
      return 0;
    }),
  );
  spies.push(
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === 'hdr-title' ? TITLE_TEXT : 0;
    }),
  );
});

afterEach(() => {
  cleanup();
  resizeCallbacks.clear();
  for (const spy of spies.splice(0)) spy.mockRestore();
  vi.unstubAllGlobals();
});

/** A chip that folds by the shared rule, as the read-only link does. */
function Probe() {
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const folded = useStudioTabRowFold(ref, 'Read-only');
  return (
    <span ref={ref} data-testid="probe-chip" data-folded={folded || undefined}>
      Read-only
    </span>
  );
}

function Leaf({ withProbe = true }: { withProbe?: boolean }) {
  return (
    <StudioItemHeader
      icon={Workflow}
      title={TITLE}
      titleProps={{ 'data-testid': 'hdr-title', title: INTERNAL_ID }}
      chips={
        <span className={STUDIO_KIND_CHIP} data-testid="hdr-kind-chip">
          View
        </span>
      }
      actions={
        <>
          {withProbe && <Probe />}
          <button type="button">Open in Data</button>
        </>
      }
    />
  );
}

function resizeRow(width: number) {
  layout.row = width;
  act(() => {
    for (const cb of resizeCallbacks) cb();
  });
}

describe('a foldable chip in the title row gives way before the title (objectui#12897)', () => {
  it('at a 422 px row the chip folds, and the title gets the room it frees', () => {
    layout.row = 422;
    render(<Leaf />);
    // With the chip whole the title would get 422 − 32 − 38 − 132 − 137 = 83 px
    // of its 178: the chip folds, and the 187 px left hold the title whole.
    expect(screen.getByTestId('probe-chip')).toHaveAttribute('data-folded', 'true');
    expect(titleBox()).toBe(TITLE_TEXT);
    expect(screen.getByTestId('hdr-title')).toHaveAttribute('title', INTERNAL_ID);
  });

  it('a cut title says its whole text in its tooltip, then the pillar’s own tooltip', () => {
    layout.row = 360;
    render(<Leaf />);
    expect(screen.getByTestId('probe-chip')).toHaveAttribute('data-folded', 'true');
    expect(screen.getByTestId('hdr-title')).toHaveAttribute('title', `${TITLE}\n${INTERNAL_ID}`);
  });

  it('CONTROL: at a 632 px row the title fits beside the whole chip: nothing folds, the tooltip is the pillar’s', () => {
    render(<Leaf />);
    expect(screen.getByTestId('probe-chip')).not.toHaveAttribute('data-folded');
    expect(screen.getByTestId('hdr-title')).toHaveAttribute('title', INTERNAL_ID);
  });

  it('it follows the row: folds when the row narrows, unfolds when it widens again', () => {
    render(<Leaf />);
    expect(screen.getByTestId('probe-chip')).not.toHaveAttribute('data-folded');
    resizeRow(422);
    expect(screen.getByTestId('probe-chip')).toHaveAttribute('data-folded', 'true');
    resizeRow(632);
    expect(screen.getByTestId('probe-chip')).not.toHaveAttribute('data-folded');
  });

  it('CONTROL: without a foldable chip the title is cut and its tooltip still says it whole', () => {
    layout.row = 300;
    render(<Leaf withProbe={false} />);
    expect(screen.getByTestId('hdr-title')).toHaveAttribute('title', `${TITLE}\n${INTERNAL_ID}`);
  });
});

/** objectstack#29693 — the twelve characters' width the text range answers. */
const READABLE = 120;

/**
 * The item tools as `StudioItemTools` keeps the header's fold contract: the
 * button group (`data-studio-fold`) leaves the row while the header is
 * folded, and the tools are handed over as menu items.
 */
function ProbeTools({ onOpen }: { onOpen: (id: string) => void }) {
  const fold = useStudioItemHeaderFold();
  const setTools = fold?.setTools;
  React.useEffect(() => {
    if (!setTools) return;
    const tools: StudioFoldedTool[] = [
      { id: 'layers', label: 'Layers', icon: Workflow, onSelect: () => onOpen('layers') },
      { id: 'references', label: 'References', icon: Workflow, count: 3, onSelect: () => onOpen('references') },
    ];
    setTools(tools);
    return () => setTools(null);
  }, [setTools, onOpen]);
  if (fold?.folded) return null;
  return <div data-testid="probe-tools" data-studio-fold="tools" />;
}

function FoldingLeaf({
  onOpen = () => {},
  foldMenu = true,
  labelled = false,
  onCustomize = () => {},
  onToggle = () => {},
  kind = 'View',
  note,
}: {
  /** What the kind chip holds: its word, or (objectstack#29692) the override mark. */
  kind?: React.ReactNode;
  onOpen?: (id: string) => void;
  foldMenu?: boolean;
  /** The labelled actions a pillar draws: the Customize button and a flow's ledger switch. */
  labelled?: boolean;
  onCustomize?: () => void;
  onToggle?: () => void;
  /** objectstack#29691 — the header's note line. */
  note?: React.ReactNode;
}) {
  return (
    <StudioItemHeader
      icon={Workflow}
      title={TITLE}
      titleProps={{ 'data-testid': 'hdr-title', title: INTERNAL_ID }}
      chips={
        <span className={STUDIO_KIND_CHIP} data-testid="hdr-kind-chip">
          {kind}
        </span>
      }
      foldMenu={foldMenu ? { label: 'More', testId: 'hdr-more' } : undefined}
      note={note}
      tabs={<button type="button">Fields</button>}
      actions={
        <>
          {labelled && <StudioCustomizeButton block={null} baseLabel="HotCRM" locale="en" onCustomize={onCustomize} />}
          {labelled && <FlowLedgerSwitch checked reading="on" busy={false} locale="en" onToggle={onToggle} />}
          <ProbeTools onOpen={onOpen} />
          <button type="button">Open in Data</button>
        </>
      }
    />
  );
}

/** Open the header's own ⋯ (Radix opens a menu on pointer down). */
function openOwnMore(): HTMLElement {
  const trigger = screen.getByTestId('hdr-more');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.getByRole('menu');
}

describe('the title keeps a readable width: chips and item tools fold into the ⋯ menu first (objectstack#29693)', () => {
  let rangeSpy: { mockRestore: () => void } | null = null;
  beforeEach(() => {
    rangeSpy = vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(() => rect(READABLE));
  });
  afterEach(() => {
    rangeSpy?.mockRestore();
    rangeSpy = null;
  });

  it('at a 330 px row the kind chip and the tools leave the row, a ⋯ holds them, and the title keeps its twelve characters', () => {
    layout.row = 330;
    render(<FoldingLeaf />);
    // Shown, they would leave the title 330 − 32 − 38 − 146 − 137 = −23 px.
    // Folded, 330 − 32 − 137 − 32 = 129 px: at least the 120 px of twelve characters.
    expect(screen.queryByTestId('probe-tools')).toBeNull();
    expect(screen.queryByTestId('hdr-kind-chip')).toBeNull();
    expect(screen.getByTestId('hdr-more')).toHaveAccessibleName('More');
    expect(titleBox()).toBeGreaterThanOrEqual(READABLE);
  });

  it('the ⋯ menu holds the folded chips and the tools, and a tool opens from it', () => {
    layout.row = 330;
    const onOpen = vi.fn();
    render(<FoldingLeaf onOpen={onOpen} />);
    const menu = openOwnMore();
    expect(within(menu).getByTestId('studio-item-header-folded-chips')).toContainElement(within(menu).getByTestId('hdr-kind-chip'));
    expect(within(menu).getAllByRole('menuitem').map((el) => el.getAttribute('data-testid'))).toEqual([
      'studio-item-header-folded-chips',
      'studio-item-tool-layers',
      'studio-item-tool-references',
    ]);
    expect(within(menu).getByTestId('studio-item-tool-references')).toHaveTextContent('References3');
    fireEvent.click(within(menu).getByTestId('studio-item-tool-references'));
    expect(onOpen).toHaveBeenCalledWith('references');
  });

  it('it follows the row: folds when the row narrows, comes back when the title would keep its width beside them', () => {
    render(<FoldingLeaf />);
    expect(screen.getByTestId('probe-tools')).toBeInTheDocument();
    expect(screen.queryByTestId('hdr-more')).toBeNull();
    resizeRow(330);
    expect(screen.queryByTestId('probe-tools')).toBeNull();
    // 480 − 32 − 38 − 146 − 137 = 127 px with them back: they come back.
    resizeRow(480);
    expect(screen.getByTestId('probe-tools')).toBeInTheDocument();
    expect(screen.getByTestId('hdr-kind-chip')).toBeInTheDocument();
    expect(screen.queryByTestId('hdr-more')).toBeNull();
  });

  it('CONTROL: at 470 px the title would keep only 117 px beside them: they stay folded', () => {
    render(<FoldingLeaf />);
    resizeRow(330);
    resizeRow(470);
    expect(screen.queryByTestId('probe-tools')).toBeNull();
    expect(screen.getByTestId('hdr-more')).toBeInTheDocument();
  });

  it('CONTROL: at a 632 px row the title has its room: nothing folds and there is no ⋯ of the header’s own', () => {
    render(<FoldingLeaf />);
    expect(screen.getByTestId('probe-tools')).toBeInTheDocument();
    expect(screen.getByTestId('hdr-kind-chip')).toBeInTheDocument();
    expect(screen.queryByTestId('hdr-more')).toBeNull();
  });

  it('CONTROL: a header whose pillar names no fold menu folds nothing (the title is cut instead)', () => {
    layout.row = 330;
    render(<FoldingLeaf foldMenu={false} />);
    expect(screen.getByTestId('probe-tools')).toBeInTheDocument();
    expect(screen.getByTestId('hdr-kind-chip')).toBeInTheDocument();
    expect(screen.getByTestId('hdr-title')).toHaveAttribute('title', `${TITLE}\n${INTERNAL_ID}`);
  });
});

describe('the fold order: chips and tools, then labels, then the title (objectstack#29693)', () => {
  let rangeSpy: { mockRestore: () => void } | null = null;
  beforeEach(() => {
    rangeSpy = vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(() => rect(READABLE));
  });
  afterEach(() => {
    rangeSpy?.mockRestore();
    rangeSpy = null;
  });

  const customize = () => screen.getByTestId('studio-customize');
  const ledger = () => screen.getByTestId('auto-ledger-switch');
  const actions = () => screen.getByTestId('hdr-title').parentElement!.lastElementChild as HTMLElement;

  it('stage 1 first: at 560 px the chips and the tools fold, and the labelled actions keep their labels', () => {
    layout.row = 560;
    render(<FoldingLeaf labelled />);
    // Shown: 560 − 32 − 38 − 2 × 88 − 146 − 137 = 31 px. Chips and tools folded: 560 − 32 − 176 − 137 − 32 = 183 px.
    expect(screen.queryByTestId('probe-tools')).toBeNull();
    expect(screen.queryByTestId('hdr-kind-chip')).toBeNull();
    expect(actions()).not.toHaveAttribute('data-fold');
    expect(titleBox()).toBe(TITLE_TEXT);
  });

  it('stage 2 next: at 420 px the labels leave too, and the title keeps its twelve characters', () => {
    layout.row = 420;
    render(<FoldingLeaf labelled />);
    // Stage 1 leaves 420 − 32 − 176 − 137 − 32 = 43 px; without the labels, 163 px.
    expect(screen.queryByTestId('probe-tools')).toBeNull();
    expect(actions()).toHaveAttribute('data-fold', 'labels');
    expect(titleBox()).toBeGreaterThanOrEqual(READABLE);
  });

  it('the title is cut last: at 300 px both stages are taken and the ⋯ stays in the row', () => {
    layout.row = 300;
    render(<FoldingLeaf labelled />);
    expect(actions()).toHaveAttribute('data-fold', 'labels');
    expect(screen.getByTestId('hdr-more')).toBeInTheDocument();
    expect(titleBox()).toBeLessThan(READABLE);
    expect(screen.getByTestId('hdr-title')).toHaveAttribute('title', `${TITLE}\n${INTERNAL_ID}`);
  });

  it('unfolds in reverse: the labels come back before the chips and the tools', () => {
    layout.row = 420;
    render(<FoldingLeaf labelled />);
    expect(actions()).toHaveAttribute('data-fold', 'labels');
    resizeRow(560);
    expect(actions()).not.toHaveAttribute('data-fold');
    expect(screen.queryByTestId('probe-tools')).toBeNull();
    resizeRow(700);
    expect(screen.getByTestId('probe-tools')).toBeInTheDocument();
    expect(screen.getByTestId('hdr-kind-chip')).toBeInTheDocument();
  });

  it('icon-only, each labelled action keeps its label as its accessible name, and fires the same action', () => {
    layout.row = 420;
    const onCustomize = vi.fn();
    const onToggle = vi.fn();
    render(<FoldingLeaf labelled onCustomize={onCustomize} onToggle={onToggle} />);
    expect(actions()).toHaveAttribute('data-fold', 'labels');
    for (const label of document.querySelectorAll('[data-studio-fold-label]')) {
      expect(label.className).toBe(STUDIO_FOLD_LABEL);
    }
    expect(customize()).toHaveAccessibleName(t('engine.studio.customize.action', 'en'));
    expect(ledger()).toHaveAccessibleName(t('engine.studio.auto.ledger.on', 'en'));
    // Customize keeps the first slot of the actions.
    expect(actions().firstElementChild).toBe(customize());
    fireEvent.click(customize());
    fireEvent.click(ledger());
    expect(onCustomize).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('the folded chips are one menu entry, and choosing it keeps the menu open', () => {
    layout.row = 330;
    render(<FoldingLeaf />);
    const menu = openOwnMore();
    const entry = within(menu).getByTestId('studio-item-header-folded-chips');
    expect(entry).toHaveAttribute('role', 'menuitem');
    fireEvent.click(entry);
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});

describe('the override mark folded into the ⋯ menu (objectstack#29692)', () => {
  let rangeSpy: { mockRestore: () => void } | null = null;
  beforeEach(() => {
    rangeSpy = vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(() => rect(READABLE));
  });
  afterEach(() => {
    rangeSpy?.mockRestore();
    rangeSpy = null;
  });

  function foldedMark(onRestore = vi.fn()) {
    layout.row = 330;
    render(<FoldingLeaf kind={<StudioOverrideChip baseLabel="HotCRM" basedOn="4.0.0" locale="en" onRestore={onRestore} />} />);
    const menu = openOwnMore();
    const entry = within(menu).getByTestId('studio-item-header-folded-chips');
    return { menu, entry, chip: within(entry).getByTestId('studio-override-chip'), onRestore };
  }

  it('a press on the mark opens its popover once, and the menu stays open under it', () => {
    const { chip } = foldedMark();
    fireEvent.click(chip);
    // One press, one toggle: the entry's own select does not press the mark again.
    expect(chip).toHaveAttribute('data-state', 'open');
    expect(screen.getAllByTestId('studio-override-popover')).toHaveLength(1);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    // A second press closes it, and the menu is still there.
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('data-state', 'closed');
    expect(screen.queryByTestId('studio-override-popover')).toBeNull();
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('chosen by the keys, the folded entry presses the mark: its popover opens and the menu stays open', () => {
    const { entry, chip } = foldedMark();
    act(() => entry.focus());
    fireEvent.keyDown(entry, { key: 'Enter' });
    expect(chip).toHaveAttribute('data-state', 'open');
    expect(screen.getAllByTestId('studio-override-popover')).toHaveLength(1);
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('Restore in the popover asks the host once and closes the popover and the menu with it', () => {
    const { chip, onRestore } = foldedMark();
    fireEvent.click(chip);
    fireEvent.click(screen.getByTestId('studio-override-restore'));
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('studio-override-popover')).toBeNull();
    // The confirmation replaces both: no menu is left open (hidden) behind it to take the next Enter.
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a pointer moving over the open popover and pressing in it neither focuses the menu entry nor closes the popover', () => {
    const { entry, chip, onRestore } = foldedMark();
    fireEvent.click(chip);
    const popover = screen.getByTestId('studio-override-popover');
    const facts = within(popover).getByTestId('studio-override-popover-facts');
    // Over the mark, then into the popover: the entry would take the focus from it on a pointer move.
    fireEvent.pointerMove(chip, { pointerType: 'mouse' });
    fireEvent.pointerMove(facts, { pointerType: 'mouse' });
    fireEvent.pointerDown(facts, { button: 0, pointerType: 'mouse' });
    fireEvent.pointerUp(facts, { button: 0, pointerType: 'mouse' });
    fireEvent.click(facts);
    fireEvent.keyDown(facts, { key: 'Enter' });
    expect(document.activeElement).not.toBe(entry);
    expect(chip).toHaveAttribute('data-state', 'open');
    expect(screen.getAllByTestId('studio-override-popover')).toHaveLength(1);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(onRestore).not.toHaveBeenCalled();
  });
});

describe('the note line sits under the title row, outside the fold (objectstack#29691)', () => {
  let rangeSpy: { mockRestore: () => void } | null = null;
  beforeEach(() => {
    rangeSpy = vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(() => rect(READABLE));
  });
  afterEach(() => {
    rangeSpy?.mockRestore();
    rangeSpy = null;
  });

  const SAVED_TO = 'Saved to HotCRM’s customizations';
  const titleRow = () => screen.getByTestId('hdr-title').parentElement as HTMLElement;
  const note = () => document.querySelector('[data-slot="item-note"]') as HTMLElement | null;

  it('the note is a line of its own, after the title row and before the tabs', () => {
    render(<FoldingLeaf note={SAVED_TO} />);
    expect(note()).toHaveTextContent(SAVED_TO);
    expect(isRow(titleRow())).toBe(true);
    expect(titleRow()).not.toContainElement(note());
    expect(titleRow().nextElementSibling).toBe(note());
    expect(note()!.nextElementSibling?.tagName).toBe('NAV');
  });

  it('a note wider than the free room folds nothing: at 632 px the chips and the tools stay, with no ⋯', () => {
    render(<FoldingLeaf note={SAVED_TO} />);
    // In the row, the 400 px note would leave the title 632 − 32 − 38 − 146 − 137 − 400 = −121 px.
    expect(screen.getByTestId('probe-tools')).toBeInTheDocument();
    expect(screen.getByTestId('hdr-kind-chip')).toBeInTheDocument();
    expect(screen.queryByTestId('hdr-more')).toBeNull();
    expect(titleBox()).toBe(TITLE_TEXT);
  });

  it('the row follows its own width with the note there: folds at 330 px, unfolds at 480 px', () => {
    render(<FoldingLeaf note={SAVED_TO} />);
    resizeRow(330);
    expect(screen.queryByTestId('probe-tools')).toBeNull();
    resizeRow(480);
    expect(screen.getByTestId('probe-tools')).toBeInTheDocument();
    expect(screen.queryByTestId('hdr-more')).toBeNull();
  });

  it('CONTROL: without a note there is no note line, and the tabs follow the title row', () => {
    render(<FoldingLeaf />);
    expect(note()).toBeNull();
    expect(titleRow().nextElementSibling?.tagName).toBe('NAV');
  });
});

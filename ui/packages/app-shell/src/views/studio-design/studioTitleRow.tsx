// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The controls the Studio top bar used to hold for the open page, at the
 * right end of that page's own title row (objectstack#37455, phase 1 of the
 * top-bar removal, epic objectstack#37424; the maintainer's 「按推荐启动」):
 *
 *  - Cancel and Save, in the item header's right-aligned action slot
 *    (`StudioItemHeader`): the page's Save, after the page's own actions; on
 *    a page that saves with no item header, at the right end of its own
 *    title row ({@link StudioTitleRowEnd});
 *  - the AI assistant button (or, with no copilot served, the right slot's
 *    show / hide icon) at the very end of every title row, the list page's
 *    and the item header's, behind a hairline, as the front end's page
 *    header ends with the shell's button group (`PageHeader`,
 *    objectstack#36111).
 *
 * The surface still OWNS them (`StudioDesignSurface`): it runs the save
 * coordinator and the right slot, and hands the rendered controls down
 * through {@link StudioTitleRowProvider}. A title row places them; it never
 * builds them, so they work exactly as they did in the top bar.
 *
 * One page, one place: every title row under the surface registers its row,
 * and only the first in document order draws the controls (the page's own
 * header, never a header nested in it or a compact row embedded further
 * down), so a page never draws two Saves. Outside the surface (Setup, a
 * suite that mounts a page bare) nothing is drawn.
 */

import * as React from 'react';

/** What the surface hands its title rows. */
export interface StudioTitleRowControls {
  /** Cancel and Save, while the page holds unsaved edits; `null` otherwise. */
  save: React.ReactNode;
  /** The AI assistant button or the slot's show / hide icon; `null` when the slot is not there. */
  assistant: React.ReactNode;
}

/** The rows that registered, and which of them draws the controls. */
interface TitleRowRegistry {
  add: (row: Element) => () => void;
  subscribe: (listener: () => void) => () => void;
  owner: () => Element | null;
}

function createTitleRowRegistry(): TitleRowRegistry {
  const rows = new Set<Element>();
  const listeners = new Set<() => void>();
  let owner: Element | null = null;
  const settle = () => {
    let first: Element | null = null;
    for (const row of rows) {
      // `DOCUMENT_POSITION_PRECEDING`: `row` comes before `first`.
      if (!first || first.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_PRECEDING) first = row;
    }
    if (first === owner) return;
    owner = first;
    listeners.forEach((listener) => listener());
  };
  return {
    add: (row) => {
      rows.add(row);
      settle();
      return () => {
        rows.delete(row);
        settle();
      };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    owner: () => owner,
  };
}

interface StudioTitleRowValue extends StudioTitleRowControls {
  registry: TitleRowRegistry;
}

const StudioTitleRowContext = React.createContext<StudioTitleRowValue | null>(null);

/** The surface's side: the controls its pages' title rows place. */
export function StudioTitleRowProvider({
  save,
  assistant,
  children,
}: StudioTitleRowControls & { children: React.ReactNode }): React.ReactElement {
  // One registry for the surface's life (state, not a memo: ui AGENTS.md #10).
  const [registry] = React.useState(createTitleRowRegistry);
  const value = React.useMemo<StudioTitleRowValue>(() => ({ registry, save, assistant }), [registry, save, assistant]);
  return <StudioTitleRowContext.Provider value={value}>{children}</StudioTitleRowContext.Provider>;
}

const noSubscription = () => () => {};
const noOwner = () => null;

/**
 * A title row's side: the controls this row draws, given the row's element.
 * `null` outside the surface, and for every row but the page's first.
 */
export function useStudioTitleRowControls(row: React.RefObject<Element | null>): StudioTitleRowControls | null {
  const value = React.useContext(StudioTitleRowContext);
  const registry = value?.registry ?? null;
  const [element, setElement] = React.useState<Element | null>(null);
  React.useLayoutEffect(() => {
    const el = row.current;
    if (!registry || !el) return;
    setElement(el);
    return registry.add(el);
  }, [registry, row]);
  const owner = React.useSyncExternalStore(registry?.subscribe ?? noSubscription, registry?.owner ?? noOwner, noOwner);
  if (!value || !element || owner !== element) return null;
  return { save: value.save, assistant: value.assistant };
}

/** The hairline before the assistant, as the front end's page header draws it before the shell's group. */
export function StudioTitleRowDivider(): React.ReactElement {
  return <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" data-testid="studio-title-row-divider" />;
}

/**
 * The end of a title row that is not an item header (the list page's, the
 * directory's, a page that saves with no item header): drop it after the
 * row's last action. It draws the page's Cancel and Save while the page holds
 * unsaved edits, then the assistant behind a hairline (`divider`: the row has
 * actions of its own before it; Save always counts as one). Draws nothing
 * outside the surface.
 */
export function StudioTitleRowEnd({ divider = true }: { divider?: boolean }): React.ReactElement | null {
  const inSurface = React.useContext(StudioTitleRowContext) !== null;
  const anchor = React.useRef<HTMLSpanElement | null>(null);
  const controls = useStudioTitleRowControls(anchor);
  if (!inSurface) return null;
  const save = controls?.save ?? null;
  const assistant = controls?.assistant ?? null;
  return (
    <span ref={anchor} className="contents" data-slot="studio-title-row-end">
      {save}
      {assistant ? (
        <>
          {(divider || save) && <StudioTitleRowDivider />}
          {assistant}
        </>
      ) : null}
    </span>
  );
}

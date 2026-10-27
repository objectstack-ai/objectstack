/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The empty-list fold of a related-list STACK (#25895).
 *
 * A record's Related tab stacks one `record:related_list` per relationship, and
 * an empty one used to keep a full row of its own wherever it was declared
 * (「客户 0 · 暂无相关记录 · + 新建」 between two lists with records). Here the
 * lists of one stack fold their empty members into ONE line, drawn after the
 * last list of the stack, naming each folded list and keeping its New action.
 *
 * ## Who the stack is
 *
 * The lists that share a container: the DOM parent of each block's root. That
 * is the seam because the container is not this package's: on the record page
 * `page:tabs` draws a tab's children as plain siblings, and an authored page
 * may draw them from any container. Neither the container nor the page
 * synthesizer knows how many rows a list has; each list does, once its read
 * answers. So the lists coordinate among themselves, through the small store
 * below, keyed by that container. A list placed alone, or wrapped in its own
 * container, is a stack of one and never folds.
 *
 * ## The rule (`decideEmptyFold`)
 *
 *  - Nothing folds until EVERY list of the stack has answered, so a stack does
 *    not fold in steps while reads land one at a time.
 *  - Nothing folds unless at least one list has records: a stack whose lists
 *    are all empty draws every list as it always has.
 *  - A list folds when it is empty and offers nothing beyond New. A list with
 *    an `add` picker, child toolbar actions or an authoring notice keeps its
 *    own row, because the line carries New alone.
 *  - The LAST list of the stack, in document order, draws the line, after its
 *    own card (or in place of it, when it is folded too).
 *
 * A folded list stays MOUNTED, hidden, so it keeps listening for writes: when
 * it gains a record it answers "not empty" and returns to its place. A refetch
 * keeps the list's last answer while it is in flight (the block's `reportListEmpty`), so a
 * write elsewhere does not unfold and refold the whole stack around it.
 */

import * as React from 'react';
import { Plus } from 'lucide-react';
import { Button, cn } from '@object-ui/components';
import { useDetailTranslation } from './useDetailTranslation';

/** What one list of a stack tells the others. */
export interface EmptyFoldMemberState {
  /** The list's resolved title, as its card shows it. */
  title: string;
  /** `true` empty, `false` has records, `null` not answered yet. */
  empty: boolean | null;
  /** The list offers nothing the fold line cannot carry (New alone, or nothing). */
  foldable: boolean;
  /** The list offers New. */
  hasNew: boolean;
  /** Its New is drawn disabled (the host's `createDisabled`). */
  newDisabled: boolean;
}

interface FoldStackEntry extends EmptyFoldMemberState {
  id: string;
  el: Element;
  /** The list's current New handler, read at click time. */
  onNew: { current: (() => void) | undefined };
}

/** The verdict for one stack: which lists fold, and which list draws the line. */
interface EmptyFoldVerdict {
  folded: string[];
  host: string | null;
}

const NO_FOLD: EmptyFoldVerdict = { folded: [], host: null };

/** The fold rule, over the stack's lists in document order; the file header states it in words. */
function decideEmptyFold(
  ordered: ReadonlyArray<Pick<EmptyFoldMemberState, 'empty' | 'foldable'> & { id: string }>,
): EmptyFoldVerdict {
  if (ordered.length < 2) return NO_FOLD;
  if (ordered.some((m) => m.empty === null)) return NO_FOLD;
  if (!ordered.some((m) => m.empty === false)) return NO_FOLD;
  const folded = ordered.filter((m) => m.empty === true && m.foldable).map((m) => m.id);
  if (folded.length === 0) return NO_FOLD;
  return { folded, host: ordered[ordered.length - 1].id };
}

class Stack {
  readonly members = new Map<string, FoldStackEntry>();
  private readonly listeners = new Set<() => void>();
  private version = 0;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getVersion = (): number => this.version;
  emit(): void {
    this.version += 1;
    for (const listener of [...this.listeners]) listener();
  }
  /** The members in document order. */
  ordered(): FoldStackEntry[] {
    return [...this.members.values()].sort((a, b) =>
      a.el === b.el ? 0 : a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
  }
}

/** One stack per container element; it goes with the element. */
const stacks = new WeakMap<Element, Stack>();

const stackOf = (container: Element): Stack => {
  let stack = stacks.get(container);
  if (!stack) {
    stack = new Stack();
    stacks.set(container, stack);
  }
  return stack;
};

const noSubscribe = (): (() => void) => () => {};
const noVersion = (): number => 0;

export interface RelatedListStackSlotProps extends EmptyFoldMemberState {
  /** The list's New handler; absent when the list offers no New. */
  onNew?: () => void;
  /** The block's root attributes (class, designer keys, `aria`). */
  className?: string;
  rootProps?: Record<string, unknown>;
  /** The block's content: its notices and its `RelatedList`. */
  children: React.ReactNode;
}

/**
 * The root of one `record:related_list` block, as a member of its stack. It
 * draws the block's content (hidden while folded) and, on the stack's last
 * list, the fold line.
 */
export const RelatedListStackSlot: React.FC<RelatedListStackSlotProps> = ({
  title,
  empty,
  foldable,
  hasNew,
  newDisabled,
  onNew,
  className,
  rootProps,
  children,
}) => {
  const id = React.useId();
  const [root, setRoot] = React.useState<HTMLDivElement | null>(null);

  const onNewRef = React.useRef(onNew);
  React.useLayoutEffect(() => {
    onNewRef.current = onNew;
  });

  const container = root?.parentElement ?? null;
  const stack = container ? stackOf(container) : null;

  React.useLayoutEffect(() => {
    if (!stack || !root) return undefined;
    stack.members.set(id, {
      id,
      el: root,
      onNew: onNewRef,
      title: '',
      empty: null,
      foldable: false,
      hasNew: false,
      newDisabled: false,
    });
    stack.emit();
    return () => {
      stack.members.delete(id);
      stack.emit();
    };
  }, [stack, root, id]);

  React.useLayoutEffect(() => {
    const member = stack?.members.get(id);
    if (!stack || !member) return;
    if (
      member.title === title &&
      member.empty === empty &&
      member.foldable === foldable &&
      member.hasNew === hasNew &&
      member.newDisabled === newDisabled
    ) {
      return;
    }
    Object.assign(member, { title, empty, foldable, hasNew, newDisabled });
    stack.emit();
  }, [stack, id, title, empty, foldable, hasNew, newDisabled]);

  // Re-render whenever any list of the stack changes.
  React.useSyncExternalStore(stack ? stack.subscribe : noSubscribe, stack ? stack.getVersion : noVersion, noVersion);

  const ordered = stack ? stack.ordered() : [];
  const verdict = decideEmptyFold(ordered);
  const folded = verdict.folded.includes(id);
  const line =
    verdict.host === id ? ordered.filter((m) => verdict.folded.includes(m.id)) : null;

  return (
    <div ref={setRoot} className={className} {...rootProps}>
      <div hidden={folded || undefined}>{children}</div>
      {line && line.length > 0 && <EmptyFoldLine entries={line} standalone={folded} />}
    </div>
  );
};

/** The one line naming a stack's folded lists, each with its New action. */
const EmptyFoldLine: React.FC<{ entries: FoldStackEntry[]; standalone: boolean }> = ({ entries, standalone }) => {
  const { t } = useDetailTranslation();
  return (
    <div
      data-testid="record-related-list-empty-fold"
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border/60 bg-muted/10 px-4 py-2',
        !standalone && 'mt-3',
      )}
    >
      <span className="text-xs italic text-muted-foreground/70">{t('detail.noRelatedRecords')}</span>
      {entries.map((entry) => (
        <div key={entry.id} role="group" aria-label={entry.title} className="inline-flex items-center gap-1">
          <span className="text-sm font-medium text-muted-foreground">{entry.title}</span>
          {entry.hasNew && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={entry.newDisabled}
              data-testid="related-list-empty-fold-new"
              onClick={() => entry.onNew.current?.()}
              className="gap-1 h-9 sm:h-7 px-2 text-xs shadow-none"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('detail.new')}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
};

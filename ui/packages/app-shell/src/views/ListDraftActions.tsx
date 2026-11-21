/**
 * objectstack#35955 — Discard and Save on a Console list, drawn while the list
 * holds a DRAFT: a change the reader made on the list (`./listDraftStore.ts`)
 * that applies at once and is not saved anywhere. It replaces the
 * 「Personalized · Reset」 marker (objectstack#28950) at the end of the
 * condition row (objectstack#35878); with no draft the slot is empty.
 *
 * - **Discard** puts the list back as its view declares it (the host's
 *   `onDiscard`).
 * - **Save** opens its choices: 「Save to this view」 (`onSaveToView`, offered
 *   only where the host may write the open view) and 「Save as my view」
 *   (`onSaveAsMyView`, which asks a name first). The menu names what is
 *   unsaved, so a reader sees what a save keeps.
 *
 * As the list narrows (the phone list draws this same control in its chip
 * row, objectstack#35883), the two faces fold into ONE Save whose menu also
 * holds Discard: one control, one save path, at every width. Where no save
 * is offered, both faces are Discard alone.
 *
 * Nothing here is configurable: no metadata key or option reaches it.
 */

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import type { ListViewProps } from '@object-ui/plugin-list';
import { ChevronDown, CopyPlus, RotateCcw, Save } from 'lucide-react';

/** One part of a list that can differ from its view (`ListView`'s vocabulary). */
export type ListPersonalizationPart = Parameters<NonNullable<ListViewProps['onPersonalizationChange']>>[0][number];

/** The order the menu names the unsaved parts in: the toolbar's, then the Display panel's. */
const LIST_DRAFT_PART_ORDER: readonly ListPersonalizationPart[] = [
  'filters',
  'sort',
  'grouping',
  'columns',
  'hiddenFields',
  'layout',
  'rowColor',
  'inlineEdit',
];

export function ListDraftActions({
  parts,
  onDiscard,
  onSaveToView,
  onSaveAsMyView,
  className,
}: {
  /** The list's unsaved parts; nothing is drawn while there is none. */
  parts: ReadonlyArray<ListPersonalizationPart>;
  onDiscard: () => void;
  /** Save the list into the open view; absent where the reader may not write it. */
  onSaveToView?: () => void;
  /** Save the list as one of the reader's own views; absent where they may not create one. */
  onSaveAsMyView?: () => void;
  className?: string;
}) {
  const { t } = useObjectTranslation();
  if (parts.length === 0) return null;
  const ordered = LIST_DRAFT_PART_ORDER.filter((part) => parts.includes(part));
  // Each label a literal key, so the i18n call-site and dead-key gates read it.
  const partLabels: Record<ListPersonalizationPart, string> = {
    filters: t('console.objectView.personalizedParts.filters'),
    search: t('console.objectView.personalizedParts.search'),
    sort: t('console.objectView.personalizedParts.sort'),
    grouping: t('console.objectView.personalizedParts.grouping'),
    columns: t('console.objectView.personalizedParts.columns'),
    hiddenFields: t('console.objectView.personalizedParts.hiddenFields'),
    density: t('console.objectView.personalizedParts.density'),
    layout: t('console.objectView.personalizedParts.layout'),
    rowColor: t('console.objectView.personalizedParts.rowColor'),
    inlineEdit: t('console.objectView.personalizedParts.inlineEdit'),
  };
  const discardLabel = t('console.objectView.draft.discard');
  const discardTitle = t('console.objectView.draft.discardTitle');
  const saveLabel = t('console.objectView.draft.save');
  const offersSave = !!onSaveToView || !!onSaveAsMyView;

  const saveItems = (
    <>
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground" data-testid="list-draft-parts">
        {t('console.objectView.draft.heading')}
        {': '}
        {ordered.map((part) => partLabels[part]).join(t('console.objectView.draft.partSeparator'))}
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {onSaveToView ? (
        <DropdownMenuItem onSelect={() => onSaveToView()} data-testid="list-draft-save-to-view">
          <Save className="mr-2 h-4 w-4" aria-hidden="true" />
          {t('console.objectView.draft.saveToView')}
        </DropdownMenuItem>
      ) : null}
      {onSaveAsMyView ? (
        <DropdownMenuItem onSelect={() => onSaveAsMyView()} data-testid="list-draft-save-as">
          <CopyPlus className="mr-2 h-4 w-4" aria-hidden="true" />
          {t('console.objectView.draft.saveAsMyView')}
        </DropdownMenuItem>
      ) : null}
    </>
  );

  return (
    <span className={cn('flex shrink-0 items-center gap-1', className)} data-testid="list-draft">
      {/* The wide face: Discard beside Save ▾. */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        title={discardTitle}
        data-testid="list-draft-discard"
        className="hidden h-6 shrink-0 gap-1 px-1.5 text-sm font-normal text-muted-foreground shadow-none @[40rem]/list:inline-flex"
        onClick={onDiscard}
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        {discardLabel}
      </Button>
      {offersSave ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="default"
              size="sm"
              data-testid="list-draft-save"
              className="hidden h-6 shrink-0 gap-1 px-2 text-sm @[40rem]/list:inline-flex"
            >
              {saveLabel}
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64" data-testid="list-draft-save-menu">
            {saveItems}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {/* The narrow face: one Save, whose menu also holds Discard. With no
          save offered, a Save would hold nothing to save: Discard alone. */}
      {offersSave ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="default"
              size="sm"
              data-testid="list-draft-compact"
              className="inline-flex h-6 shrink-0 gap-1 px-2 text-sm @[40rem]/list:hidden"
            >
              {saveLabel}
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64" data-testid="list-draft-compact-menu">
            {saveItems}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onDiscard()} data-testid="list-draft-compact-discard">
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
              {discardLabel}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title={discardTitle}
          data-testid="list-draft-compact-discard"
          className="inline-flex h-6 shrink-0 gap-1 px-1.5 text-sm font-normal text-muted-foreground shadow-none @[40rem]/list:hidden"
          onClick={onDiscard}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          {discardLabel}
        </Button>
      )}
    </span>
  );
}

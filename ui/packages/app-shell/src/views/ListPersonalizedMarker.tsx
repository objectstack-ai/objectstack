/**
 * objectstack#28950 — the 「Personalized」 marker of a Console list: drawn beside
 * the list title while the reader's list differs from the view, and the ONE way
 * back to the view. Opening it names what differs and offers a single reset,
 * whose sentence says everything it puts back and what it leaves alone.
 *
 * The parts come from the list itself (`ListView`'s `onPersonalizationChange`)
 * plus the host's stored column layout; the reset is the host's
 * (`useObjectViewListUrlState`'s `handleResetView`). Nothing here is
 * configurable: no metadata key or option reaches it.
 *
 * On one of the reader's own views (objectstack#30073) it also offers 保存
 * (`onSave`): the list on screen becomes the view's stored body. Edits not
 * saved stay the reader's temporary list state, never written to the view.
 *
 * Below `sm` the trigger is an icon alone (named by its `aria-label`), so on a
 * narrow row it never pushes the view name out.
 */

import { useState } from 'react';
import { Button, Popover, PopoverContent, PopoverTrigger, cn } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import type { ListViewProps } from '@object-ui/plugin-list';
import { RotateCcw, Save, UserPen } from 'lucide-react';

/** One part of a list that can differ from its view (`ListView`'s vocabulary). */
export type ListPersonalizationPart = Parameters<NonNullable<ListViewProps['onPersonalizationChange']>>[0][number];

/** The order the marker names the parts in: the toolbar's, then the Display panel's. */
const LIST_PERSONALIZATION_PART_ORDER: readonly ListPersonalizationPart[] = [
  'filters',
  'search',
  'sort',
  'grouping',
  'columns',
  'hiddenFields',
  'density',
  'layout',
  'rowColor',
  'rowNumbers',
  'inlineEdit',
];

export function ListPersonalizedMarker({
  parts,
  onReset,
  onSave,
  className,
}: {
  parts: ReadonlyArray<ListPersonalizationPart>;
  onReset: () => void;
  /** Save the list on screen into the open view; offered only for a view the reader owns and may update. */
  onSave?: () => void;
  className?: string;
}) {
  const { t } = useObjectTranslation();
  const [open, setOpen] = useState(false);
  if (parts.length === 0) return null;
  const ordered = LIST_PERSONALIZATION_PART_ORDER.filter((part) => parts.includes(part));
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
    rowNumbers: t('console.objectView.personalizedParts.rowNumbers'),
    inlineEdit: t('console.objectView.personalizedParts.inlineEdit'),
  };
  const label = t('console.objectView.personalized');
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={label}
          title={label}
          data-testid="list-personalized-marker"
          className={cn(
            'h-6 shrink-0 gap-1 rounded-full px-1.5 sm:px-2 text-xs font-normal text-muted-foreground shadow-none',
            className,
          )}
        >
          <UserPen className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3" data-testid="list-personalized-popover">
        <p className="text-sm font-medium">{t('console.objectView.personalizedHeading')}</p>
        <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="list-personalized-parts">
          {ordered.map((part) => (
            <li
              key={part}
              data-part={part}
              className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-foreground"
            >
              {partLabels[part]}
            </li>
          ))}
        </ul>
        {onSave ? (
          <Button
            type="button"
            size="sm"
            className="mt-3 w-full gap-1.5"
            data-testid="list-personalized-save"
            onClick={() => {
              setOpen(false);
              onSave();
            }}
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            {t('common.save')}
          </Button>
        ) : null}
        <p className="mt-3 text-xs text-muted-foreground">{t('console.objectView.resetViewTitle')}</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3 w-full gap-1.5"
          data-testid="list-personalized-reset"
          onClick={() => {
            setOpen(false);
            onReset();
          }}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          {t('console.objectView.resetView')}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

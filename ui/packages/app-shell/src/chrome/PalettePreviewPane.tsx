/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ⌘K palette's right-hand pane (objectstack#36286): the record hit the
 * keyboard is on, drawn read-only, beside the results.
 *
 * It draws the record as `RecordPreviewCard` draws any record reference: the
 * object's label, the record's title (the ADR-0079 ladder) and the object's
 * declared key fields (`highlightFields`, ADR-0085) through the record page's
 * own highlight strip, with field-level security applied to the row. An
 * object that declares no key fields shows its title alone, as the record
 * page's strip does: nothing is guessed.
 *
 * The card reads the record by id, one read per record shown. The pane hands
 * it the selection only once the selection has rested for
 * {@link PREVIEW_SETTLE_MS} (the record shown until then stays), so holding an
 * arrow key through the results reads nothing on the way, and the card drops
 * the answer of a read whose record is no longer the one shown.
 *
 * The pane is drawn only while the palette is at least 45rem (720px) wide, a
 * container query on the palette's frame: a narrower palette shows the
 * results alone, and never scrolls sideways.
 */

import { useEffect, useState } from 'react';
import { useObjectTranslation } from '@object-ui/i18n';
import { RecordPreviewCard, type RecordPreviewSource } from '../views/record-preview/RecordPreviewCard.js';

/** How long a selection rests before the pane reads its record. */
export const PREVIEW_SETTLE_MS = 150;

/** The record a pane shows: the selected record hit's pair. */
export interface PalettePreviewTarget {
  objectName: string;
  recordId: string;
}

/** The pane's frame classes: hidden below a 45rem palette (see the module doc). */
export const PREVIEW_PANE_CLASS =
  'hidden @min-[45rem]/palette:block w-[50cqw] max-h-[300px] min-w-0 overflow-y-auto border-l p-3';

/**
 * `target` once it has stayed the same for `ms`. While a new target settles the
 * previous one is still answered, so the pane does not blink between two
 * records; with no target, nothing is.
 */
function useSettledTarget(target: PalettePreviewTarget | null, ms: number): PalettePreviewTarget | null {
  // Keyed on the pair's text, never on the object handed in (ui/AGENTS.md #10).
  const objectName = target?.objectName ?? null;
  const recordId = target?.recordId ?? null;
  const [settled, setSettled] = useState<PalettePreviewTarget | null>(null);
  useEffect(() => {
    if (objectName === null || recordId === null) {
      setSettled(null);
      return;
    }
    const timer = setTimeout(() => setSettled({ objectName, recordId }), ms);
    return () => clearTimeout(timer);
  }, [objectName, recordId, ms]);
  return objectName !== null && recordId !== null ? settled : null;
}

export function PalettePreviewPane({
  target,
  dataSource,
}: {
  /** The selected record hit, or `null` when the selection is not a record hit. */
  target: PalettePreviewTarget | null;
  dataSource?: RecordPreviewSource | null;
}) {
  const { t } = useObjectTranslation();
  const settled = useSettledTarget(target, PREVIEW_SETTLE_MS);
  return (
    <aside data-testid="palette-preview" data-preview-record={settled?.recordId} className={PREVIEW_PANE_CLASS}>
      {settled ? (
        <RecordPreviewCard
          objectName={settled.objectName}
          recordId={settled.recordId}
          dataSource={dataSource}
        />
      ) : target ? null : (
        <p className="px-1 py-2 text-sm text-muted-foreground">
          {t('console.commandPalette.previewEmpty', { defaultValue: 'Select a record to see its details.' })}
        </p>
      )}
    </aside>
  );
}

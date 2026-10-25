/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@object-ui/components';
import { usePrintPage } from '@object-ui/react';
import type { DetailViewSection } from '@object-ui/types';
import { hasCellValue } from './emptiness';
import { useDetailTranslation } from './useDetailTranslation';

export interface EmptySectionsFoldProps {
  /** The sections the body draws, as handed to each `DetailSection`. */
  sections: DetailViewSection[];
  /** The record as the sections read it (record plus the inline-edit draft). */
  data: Record<string, unknown> | null | undefined;
  isEditing: boolean;
  /** The rendered sections. */
  children: React.ReactNode;
}

/**
 * How many empty fields the body would fold into one row, or `0` when it does
 * not fold. Exported for the tests that pin the rule.
 *
 * The body folds when every section that draws anything is all-empty and at
 * least TWO of them are kept. A section with no fields draws nothing and an
 * all-empty `hideEmpty: true` section hides itself, so neither counts as a
 * kept section and neither adds to the count; one kept section is already one
 * fold row on its own, so folding it again would only drop its heading.
 * Emptiness is `hasCellValue` over `data[name] ?? field.value`, the reading
 * `DetailSection` folds by.
 */
export function emptySectionsFoldCount(
  sections: DetailViewSection[],
  data: Record<string, unknown> | null | undefined,
): number {
  // This runs ABOVE every per-section error boundary in `DetailView`, so a
  // malformed section must not throw from here and blank the whole body
  // (objectui#8497): a section with no field array, or anything that throws
  // while reading, turns the fold off, leaving each section to render, or to
  // fail visibly, inside its own boundary.
  try {
    let kept = 0;
    let emptyFields = 0;
    for (const section of sections) {
      if (!Array.isArray(section?.fields)) return 0;
      const fields = section.fields;
      if (fields.length === 0) continue;
      if (fields.some((field) => hasCellValue(data?.[field?.name] ?? field?.value))) return 0;
      if (section.hideEmpty === true) continue;
      kept += 1;
      emptyFields += fields.length;
    }
    return kept >= 2 ? emptyFields : 0;
  } catch {
    return 0;
  }
}

/**
 * The tab-level fold (objectui#13386, ruling C, item 2 of objectui#12618): a
 * detail body whose sections are ALL empty draws one "Show N empty fields" row
 * for the whole body instead of one folded section after another. Revealing
 * it draws the sections as they are, each folded on its own, and a closing
 * "Hide empty fields" row folds the body again.
 *
 * Same boundaries as the section fold in `DetailSection`: edit mode draws
 * every section, its fields are the inputs; a print page draws them all, as
 * paper cannot toggle (objectui#12717).
 */
export const EmptySectionsFold: React.FC<EmptySectionsFoldProps> = ({
  sections,
  data,
  isEditing,
  children,
}) => {
  const { t } = useDetailTranslation();
  const isPrintPage = usePrintPage() !== null;
  const [revealed, setRevealed] = React.useState(false);

  const count = isEditing || isPrintPage ? 0 : emptySectionsFoldCount(sections, data);
  if (count === 0) return <>{children}</>;

  const toggle = (
    <div className="-ml-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setRevealed((r) => !r)}
        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        {revealed ? (
          <EyeOff className="h-3.5 w-3.5 mr-1.5" />
        ) : (
          <Eye className="h-3.5 w-3.5 mr-1.5" />
        )}
        {revealed
          ? t('detail.hideEmptyFields', { defaultValue: 'Hide empty fields' })
          : t('detail.showEmptyFields', { count, defaultValue: 'Show {{count}} empty fields' })}
      </Button>
    </div>
  );

  if (!revealed) return toggle;
  return (
    <>
      {children}
      {toggle}
    </>
  );
};

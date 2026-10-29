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

/**
 * Whether a section is ENTIRELY empty and kept — a section the v3 line folds
 * (objectstack#27055). Same reading as {@link emptySectionsFoldCount}: a
 * section with no fields draws nothing and an all-empty `hideEmpty: true`
 * section hides itself, so neither is folded into the line.
 */
export function isFoldableEmptySection(
  section: DetailViewSection,
  data: Record<string, unknown> | null | undefined,
): boolean {
  try {
    const fields = Array.isArray(section?.fields) ? section.fields : null;
    if (!fields || fields.length === 0) return false;
    if (section.hideEmpty === true) return false;
    return !fields.some((field) => hasCellValue(data?.[field?.name] ?? field?.value));
  } catch {
    return false;
  }
}

export interface EmptySectionsLineProps {
  /** The sections the body draws, in order. */
  sections: DetailViewSection[];
  /** The record as the sections read it (record plus the inline-edit draft). */
  data: Record<string, unknown> | null | undefined;
  isEditing: boolean;
  /** Draw one section (its error boundary included) at its index. */
  renderSection: (section: DetailViewSection, index: number) => React.ReactNode;
}

/**
 * The record page v3 fold of empty sections (objectstack#27055, Target 2):
 * every section that is ENTIRELY empty leaves its place and the body ends in
 * ONE quiet line naming them — 「地址 · 转化 · 附加信息 · 3 个空分区 · 展开」.
 * Sections with a value draw in their order as before. Expanding the line
 * draws every section in its own place and turns the line into a 「收起」.
 *
 * Drawn on the synthesized default page only (`DetailView` asks
 * `useDefaultRecordPage`); elsewhere the whole-body fold
 * ({@link EmptySectionsFold}) keeps its own rule. Edit mode and a print page
 * draw every section, for the reasons that fold gives.
 */
export const EmptySectionsLine: React.FC<EmptySectionsLineProps> = ({
  sections,
  data,
  isEditing,
  renderSection,
}) => {
  const { t } = useDetailTranslation();
  const isPrintPage = usePrintPage() !== null;
  const [revealed, setRevealed] = React.useState(false);
  const folded = isEditing || isPrintPage ? [] : sections.map((section) => isFoldableEmptySection(section, data));
  const foldedCount = folded.filter(Boolean).length;
  if (foldedCount === 0) return <>{sections.map(renderSection)}</>;

  const names = sections
    .filter((_section, index) => folded[index])
    .map((section) => (typeof section.title === 'string' ? section.title.trim() : ''))
    .filter((name) => name !== '');
  const line = (
    <div
      className="flex min-h-9 flex-wrap items-center gap-x-1.5 gap-y-1 border-b border-dashed border-border text-xs text-muted-foreground"
      data-empty-sections-line=""
      data-empty-sections-count={foldedCount}
    >
      {!revealed && names.length > 0 && <span className="min-w-0 truncate">{names.join(' · ')}</span>}
      {!revealed && names.length > 0 && <span aria-hidden>·</span>}
      <span>{t('detail.emptySections', { count: foldedCount, defaultValue: '{{count}} empty sections' })}</span>
      <span aria-hidden>·</span>
      <button
        type="button"
        aria-expanded={revealed}
        onClick={() => setRevealed((r) => !r)}
        className="rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {revealed
          ? t('detail.hideEmptySections', { defaultValue: 'Collapse' })
          : t('detail.showEmptySections', { defaultValue: 'Expand' })}
      </button>
    </div>
  );
  return (
    <>
      {sections.map((section, index) => (revealed || !folded[index] ? renderSection(section, index) : null))}
      {line}
    </>
  );
};

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The record header's stage tag as a menu (objectstack#35891).
 *
 * The default record page draws no stage bar (the maintainer, 2026-11-20:
 * 「把阶段条和关键字段条去掉」): the stage is the status tag beside the record's
 * name, and the tag is where it moves. A host hands this component to the
 * header as `RecordHeaderState.stage`; the header calls it with the tag it
 * would draw.
 *
 * - A reader who may move the stage sees the tag with a small arrow; it opens
 *   a menu listing every stage in order, the current one checked. A reader who
 *   may not (no edit right on the field, a read-only or computed field, an
 *   approval lock, an open draft) sees the tag alone: the same verdict
 *   `record:path`'s press asks (`useStageChange`).
 * - A stage the field's blocking `state_machine` cannot reach from the stored
 *   value is drawn disabled, with the reason under its name.
 * - Picking a stage opens the stage confirmation. A stage that needs other
 *   fields filled first asks for exactly those fields in the same dialog and
 *   writes them with the move; a refusal is shown in the dialog and the stage
 *   does not move (`collectFields`, see `recordPathStageChange.tsx`).
 * - The menu is Radix's: Enter or Space on the focused tag opens it, the arrow
 *   keys move, Enter picks, Esc closes without a change.
 *
 * The stages are the ones `record:path` offers: the field's options, less
 * those whose `visibleWhen` rules this record out (`stagesThisRecordWalks`).
 * A plain status field (no stage role) is read and moved the same way.
 */

import React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  cn,
  type RecordHeaderStageParts,
} from '@object-ui/components';
import { useRecordContext, useSafeFieldLabel } from '@object-ui/react';
import { pickLocalized, useObjectTranslation } from '@object-ui/i18n';
import { RecordFieldAccessForRecord } from './recordFieldAccess';
import { useStageChange } from './renderers/recordPathStageChange';
import { stagesThisRecordWalks, type PathStage } from './renderers/record-path';
import { deriveStages } from './synth/buildDefaultPageSchema';
import { useDetailTranslation } from './useDetailTranslation';

export type RecordStageMenuProps = RecordHeaderStageParts;

/**
 * The tag as a menu, inside the row-scoped field-access scope the record
 * page's other in-place editors mount, so the field's edit right is asked of
 * THIS stored row.
 */
export const RecordStageMenu: React.FC<RecordStageMenuProps> = (props) => {
  const ctx = useRecordContext();
  return (
    <RecordFieldAccessForRecord objectName={ctx?.objectName} recordId={ctx?.recordId} dataSource={ctx?.dataSource}>
      <RecordStageMenuBody {...props} />
    </RecordFieldAccessForRecord>
  );
};

const RecordStageMenuBody: React.FC<RecordStageMenuProps> = ({ field, label, tag }) => {
  const ctx = useRecordContext();
  const { t } = useDetailTranslation();
  const { language } = useObjectTranslation();
  const { fieldOptionLabel } = useSafeFieldLabel();
  const change = useStageChange(true, field, { collectFields: true });

  const record = ctx?.data as Record<string, unknown> | undefined;
  const current = record?.[field];
  const objectName = ctx?.objectName;
  const objectSchema = ctx?.objectSchema as { fields?: Record<string, { options?: unknown }> } | undefined;
  const stages: PathStage[] = React.useMemo(() => {
    const derived = (deriveStages(objectSchema as any, field) ?? []) as PathStage[];
    const walked = stagesThisRecordWalks(derived, objectSchema?.fields?.[field]?.options, record, current);
    return walked.map((stage) => {
      const authored = pickLocalized(stage.label as any, language) ?? String(stage.value);
      const text = objectName ? fieldOptionLabel(objectName, field, String(stage.value), String(authored)) : String(authored);
      return { ...stage, label: text };
    });
  }, [objectSchema, field, record, current, language, objectName, fieldOptionLabel]);

  if (!change.pressable || stages.length === 0) return <>{tag}</>;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          type="button"
          disabled={change.busy}
          aria-label={t('detail.stageMenuTrigger', { stage: label })}
          data-record-stage-tag={field}
          data-record-stage-menu=""
          className={cn(
            'inline-flex h-5 shrink-0 items-center gap-0.5 rounded-md border bg-muted pl-1.5 pr-1 text-xs font-medium text-foreground',
            'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:opacity-60 data-[state=open]:bg-accent',
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-70" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[12rem]" data-record-stage-menu-list="">
          {stages.map((stage) => {
            const isCurrent = current != null && String(stage.value) === String(current);
            const reachable = isCurrent || change.admits(stage.value);
            return (
              <DropdownMenuItem
                key={String(stage.value)}
                disabled={!reachable}
                data-stage-value={String(stage.value)}
                aria-current={isCurrent ? 'true' : undefined}
                onSelect={() => {
                  if (!isCurrent) change.request({ value: stage.value, label: stage.label });
                }}
                className="items-start gap-2"
              >
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
                  {isCurrent ? <Check className="h-4 w-4" /> : null}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span>
                    {stage.label}
                    {isCurrent ? <span className="sr-only">{`, ${t('detail.stageMenuCurrent')}`}</span> : null}
                  </span>
                  {!reachable ? (
                    <span className="text-xs text-muted-foreground" data-stage-blocked-reason="">
                      {t('detail.stageMenuNotReachable', { stage: label })}
                    </span>
                  ) : null}
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      {change.dialog}
    </>
  );
};

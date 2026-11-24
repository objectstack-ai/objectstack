/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35928 — the flows a stage change would start, named in the
 * change's confirm (ruling record 7073655354 on objectstack#35928).
 *
 * Two confirms ask before a stage moves: the list cell's state-machine confirm
 * (`@object-ui/plugin-grid`, objectstack#35685) and the record page's stage
 * confirm (`renderers/recordPathStageChange`). Both read this module, so they
 * cannot disagree about what a move starts or how it is named:
 *
 *  - {@link useRecordUpdateStarts} asks the server once per pending move
 *    (`POST /api/v1/automation/_record-starts`, the declared
 *    `listRecordUpdateStarts` contract of `@objectstack/spec/api`). Which flows
 *    start is the SERVER's call — the engine's own start-condition gate over
 *    the record as the caller reads it, with the proposed fields applied. ⛔ No
 *    condition is judged here.
 *  - {@link StageChangeStarts} draws the answer under the confirm's sentence:
 *    each flow by its label in the reader's language (the app's `flows`
 *    translations, read through `activeFlowsBundle` and the spec's
 *    `translateFlow`, as the flow runner names a flow), and a flow holding an
 *    approval node marked as starting one (ADR-0019). Nothing else about a flow
 *    is shown: no description, condition, nodes or link.
 *
 * The confirm's own sentence stays as it is and is never replaced: a hook the
 * object runs is not listed (ADR-0077 §2), so "may trigger related automation"
 * stays true beside any list. A read in flight, refused or failing, and an
 * empty answer, draw nothing — the confirm reads as it did before this card.
 */

import * as React from 'react';
import { SchemaRendererContext } from '@object-ui/react';
import { activeFlowsBundle, useObjectTranslation } from '@object-ui/i18n';
import { RecordUpdateStartsResponseSchema, type RecordUpdateStart } from '@objectstack/spec/api';
import { translateFlow } from '@objectstack/spec/system';
import { useDetailTranslation } from './useDetailTranslation';

/** The route of the declared `listRecordUpdateStarts` contract. */
export const RECORD_UPDATE_STARTS_PATH = '/api/v1/automation/_record-starts';

/** One pending move: the record, and the fields it would write. */
export interface RecordUpdateStartsAsk {
  object: string;
  recordId: string;
  changes: Record<string, unknown>;
}

/**
 * The flows the pending move `ask` would start, as the server answers them;
 * `[]` while no move is pending, while the read is in flight, and when it is
 * refused, fails or answers nothing. Asked again whenever the move changes.
 */
export function useRecordUpdateStarts(ask: RecordUpdateStartsAsk | null): RecordUpdateStart[] {
  const apiFetch = React.useContext(SchemaRendererContext)?.apiFetch;
  const key = ask ? JSON.stringify([ask.object, ask.recordId, ask.changes]) : null;
  const [answer, setAnswer] = React.useState<{ key: string; flows: RecordUpdateStart[] } | null>(null);

  React.useEffect(() => {
    if (key === null) return;
    const [object, recordId, changes] = JSON.parse(key) as [string, string, Record<string, unknown>];
    let cancelled = false;
    void (async () => {
      try {
        const doFetch = apiFetch ?? fetch;
        const res = await doFetch(RECORD_UPDATE_STARTS_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ object, recordId, changes }),
        });
        if (!res.ok) return;
        const parsed = RecordUpdateStartsResponseSchema.safeParse(await res.json());
        if (!cancelled && parsed.success) setAnswer({ key, flows: parsed.data.data.flows });
      } catch {
        // No answer names no flow: the confirm keeps its sentence alone.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, apiFetch]);

  // An answer is read only for the move it was asked for, so a confirm never
  // shows the flows of the move before it.
  return answer !== null && answer.key === key ? answer.flows : [];
}

/**
 * The list a confirm draws under its sentence, or nothing for no flows. Each
 * flow is named by its label in the reader's language, the authored label
 * where the app translates none.
 */
export function StageChangeStarts({ flows }: { flows: readonly RecordUpdateStart[] }): React.ReactElement | null {
  const { t } = useDetailTranslation();
  const { i18n, language } = useObjectTranslation();
  if (flows.length === 0) return null;
  const labelOf = (flow: RecordUpdateStart): string => {
    const bundle = activeFlowsBundle(i18n, language, flow.name);
    if (!bundle) return flow.label;
    const translated = translateFlow({ name: flow.name, label: flow.label }, bundle, { locale: language }).label;
    return typeof translated === 'string' && translated ? translated : flow.label;
  };
  return (
    <div className="flex flex-col gap-1 text-sm" data-testid="stage-change-starts">
      <p className="text-muted-foreground">{t('detail.stageChangeStartsHeading')}</p>
      <ul className="list-disc pl-5">
        {flows.map((flow) => (
          <li key={flow.name} className="break-words" data-stage-change-start={flow.name}>
            <span className="font-medium">{labelOf(flow)}</span>
            {flow.startsApproval && (
              <span className="text-muted-foreground" data-stage-change-start-approval="">
                {' · '}
                {t('detail.stageChangeStartsApproval')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

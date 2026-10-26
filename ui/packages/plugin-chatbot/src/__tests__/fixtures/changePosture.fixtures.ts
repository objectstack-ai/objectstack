/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#12894 — the two envelopes cloud#2924 sends for a copilot change to
 * a live app with records, as objectstack-ai/cloud writes them in
 * `packages/service-ai-studio` (read at cloud `main` `1e3e04f8`):
 *
 *  - the `changes_proposed` card: `changesProposedEnvelope` (with
 *    `postureEnvelope` and `describeEditOps`'s rows), `metadata-tools.ts` and
 *    `confirm-gate.ts`;
 *  - the applied (`drafted`) envelope of the confirm replay, stamped by
 *    `describeLandedChange` (`draftState` from `readDraftState` in
 *    `change-posture.ts`, `existingRows`, `appliedCard`).
 *
 * The sentences are `authoring-copy.ts`'s ZH and EN tables, byte for byte
 * (`confirmChangeAsDraft`, `savedAsDraft`, `existingRowsEmpty`,
 * `checkedStructure`, `changeParams`). The edit is the producer's own test
 * fixture (`RENEWAL_EDIT` in `copilot-change-posture.test.ts`: a number field
 * with default 0 on the borrowing table), plus one view row, which is the
 * StudioRailCopilot artboard's second row.
 *
 * No schema declares these envelopes (cloud declares `build-cards.schema.json`
 * for the build cards only), so the producer's source is the declaration.
 */

export type Lang = 'zh' | 'en';

export const PACKAGE_ID = 'app.hcpl';
export const BORROWING = 'lib_borrowing_record';

const COPY = {
  zh: {
    confirmChange: '应用前请确认这次改动。',
    confirmChangeAsDraft: (n: number) =>
      `这个应用已上线，有 ${n} 条记录在用。改动先存为草稿；画布和右侧属性里能看到效果，你在「变更」里核对后再发布。`,
    fieldParams: '续借次数 · 默认 0 · 不必填',
    label: '续借次数',
    savedAsDraft: (n: number) => `已存为草稿 · ${n} 项未发布`,
    existingRowsEmpty: (rows: number, label: string) => `已有 ${rows} 条记录的${label}为空`,
    checkedStructure: '核对：结构 ✓',
  },
  en: {
    confirmChange: 'Confirm this change before it is applied.',
    confirmChangeAsDraft: (n: number) =>
      `This app is live with ${n} record(s) in use. The change is saved as a draft first — you can see it on the ` +
      'canvas and in the properties panel; review it in Changes, then publish.',
    fieldParams: 'Renewals · default 0 · optional',
    label: 'Renewals',
    savedAsDraft: (n: number) => `Saved as a draft · ${n} unpublished change(s)`,
    existingRowsEmpty: (rows: number, label: string) => `${rows} existing record(s) have no ${label} yet`,
    checkedStructure: 'Checked: structure ✓',
  },
} as const;

/** `describeEditOps` rows for the renewal edit plus the board's card-field update. */
export function changeRows(lang: Lang) {
  return [
    { verb: 'add_field', object: BORROWING, field: 'renewal_count', type: 'number', details: COPY[lang].fieldParams },
    { verb: 'update_metadata', type: 'view', name: 'borrowing_board' },
  ];
}

/**
 * The `changes_proposed` card. `posture` absent is the envelope an older cloud
 * sends (and one where the environment does not publish AI changes in the turn).
 */
export function proposedEnvelope(
  lang: Lang,
  posture: 'draft' | 'publish' | 'absent',
  liveRecords = 12,
): Record<string, unknown> {
  const copy = COPY[lang];
  const asDraft = posture === 'draft';
  return {
    status: 'changes_proposed',
    applied: false,
    changes: changeRows(lang),
    summary: asDraft ? copy.confirmChangeAsDraft(liveRecords) : copy.confirmChange,
    ...(posture === 'absent'
      ? {}
      : {
          posture: { mode: posture, liveRecords: asDraft ? liveRecords : 0 },
          primaryAction: asDraft ? 'save_draft' : 'confirm',
        }),
    // The model's half of the envelope: no consumer renders it.
    note: 'NOTHING has changed yet (applied:false) — this is shown to the user as a confirm card.',
  };
}

/**
 * The applied envelope of the confirm replay. `others` is the pending drafts
 * this change did not stage; `withCard: false` is an older cloud's drafted
 * envelope (no `draftState`, `existingRows` or `appliedCard`).
 */
export function draftedEnvelope(
  lang: Lang,
  opts: { others?: number; withCard?: boolean; withDraftState?: boolean } = {},
): Record<string, unknown> {
  const copy = COPY[lang];
  const others = opts.others ?? 0;
  const withCard = opts.withCard ?? true;
  const withDraftState = opts.withDraftState ?? true;
  const ours = [{ type: 'object', name: BORROWING }];
  const theirs = Array.from({ length: others }, (_, i) => ({ type: 'view', name: `${BORROWING}.list_${i}` }));
  const pending = ours.length + theirs.length;
  return {
    status: 'drafted',
    kind: 'edit',
    drafted: ours,
    packageId: PACKAGE_ID,
    summary: lang === 'zh' ? '已起草 2 处改动' : 'Drafted 2 edit(s)',
    verification: { errors: 0, warnings: 0 },
    posture: { mode: 'draft', liveRecords: 12 },
    note: 'SAVED AS A STUDIO DRAFT — NOT LIVE.',
    ...(withCard && withDraftState
      ? { draftState: { pending, items: [...ours, ...theirs], others } }
      : {}),
    ...(withCard
      ? {
          existingRows: [{ object: BORROWING, field: 'renewal_count', label: copy.label, rows: 12 }],
          appliedCard: {
            title: copy.savedAsDraft(pending),
            lines: [copy.existingRowsEmpty(12, copy.label), copy.checkedStructure],
          },
        }
      : {}),
  };
}

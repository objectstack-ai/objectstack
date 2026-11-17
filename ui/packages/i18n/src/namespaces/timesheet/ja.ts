/**
 * 日本語 (ja) — the lazy `timesheet` namespace's catalogue.
 *
 * A PARTIAL pack: the same shape as `../../locales/ja.ts`, holding only
 * the `timesheet` group, which `./index.ts` deep-merges into an i18next
 * instance when a timesheet view mounts. `./index.ts` says what the namespace
 * is, why it is lazy, and which gates read this file.
 *
 * ⛔ Keep the declaration `const ja = { … }` and `export default ja`:
 * the i18n gates under `ui/scripts/` read this file by AST under that name.
 */
const ja = {
  timesheet: {
    missingBindingTitle: 'タイムシートの設定が必要です',
    missingBindingMessage: 'このビューに timesheet.rowFields、timesheet.dateField、timesheet.valueField を宣言してください。',
    previousWeek: '前の週',
    thisWeek: '今週',
    nextWeek: '次の週',
    total: '合計',
    addRow: '行を追加',
    addRowConfirm: '追加',
    cancel: 'キャンセル',
    noRows: '今週のエントリはありません。行を追加して開始してください。',
    multipleRecords: 'この日には複数のレコードがあります。一覧で編集してください。',
    invalidNumber: '数値を入力してください',
    saveFailed: '保存されていません: {{message}}',
    notAllowed: 'この変更を行う権限がありません。',
    loadFailed: '今週のデータを読み込めませんでした。',
    rowIncomplete: '先にすべての行フィールドを入力してください。',
    cellLabel: '{{row}}、{{day}}',
    rowTotalLabel: '{{row}} の合計',
    dayTotalLabel: '{{day}} の合計',
  },
};

export default ja;

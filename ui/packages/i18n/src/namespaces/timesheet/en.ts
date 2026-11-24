/**
 * English (en) — the lazy `timesheet` namespace's catalogue.
 *
 * A PARTIAL pack: the same shape as `../../locales/en.ts`, holding only
 * the `timesheet` group, which `./index.ts` deep-merges into an i18next
 * instance when a timesheet view mounts. `./index.ts` says what the namespace
 * is, why it is lazy, and which gates read this file.
 *
 * ⛔ Keep the declaration `const en = { … }` and `export default en`:
 * the i18n gates under `ui/scripts/` read this file by AST under that name.
 */
const en = {
  timesheet: {
    missingBindingTitle: 'Timesheet configuration required',
    missingBindingMessage: 'Declare timesheet.rowFields, timesheet.dateField and timesheet.valueField on this view.',
    previousWeek: 'Previous week',
    thisWeek: 'This week',
    nextWeek: 'Next week',
    total: 'Total',
    addRow: 'Add row',
    addRowConfirm: 'Add',
    cancel: 'Cancel',
    noRows: 'No entries this week. Add a row to start.',
    multipleRecords: 'This day holds more than one record. Edit them in the list.',
    invalidNumber: 'Enter a number',
    saveFailed: 'Not saved: {{message}}',
    notAllowed: "You don't have permission to make this change.",
    loadFailed: 'This week could not be loaded.',
    rowIncomplete: 'Fill in every row field first.',
    cellLabel: '{{row}}, {{day}}',
    rowTotalLabel: '{{row}} total',
    dayTotalLabel: '{{day}} total',
  },
};

export default en;

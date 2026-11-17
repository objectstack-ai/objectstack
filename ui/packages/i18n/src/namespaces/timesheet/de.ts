/**
 * Deutsch (de) — the lazy `timesheet` namespace's catalogue.
 *
 * A PARTIAL pack: the same shape as `../../locales/de.ts`, holding only
 * the `timesheet` group, which `./index.ts` deep-merges into an i18next
 * instance when a timesheet view mounts. `./index.ts` says what the namespace
 * is, why it is lazy, and which gates read this file.
 *
 * ⛔ Keep the declaration `const de = { … }` and `export default de`:
 * the i18n gates under `ui/scripts/` read this file by AST under that name.
 */
const de = {
  timesheet: {
    missingBindingTitle: 'Zeiterfassung muss konfiguriert werden',
    missingBindingMessage: 'Deklarieren Sie timesheet.rowFields, timesheet.dateField und timesheet.valueField in dieser Ansicht.',
    previousWeek: 'Vorherige Woche',
    thisWeek: 'Diese Woche',
    nextWeek: 'Nächste Woche',
    total: 'Summe',
    addRow: 'Zeile hinzufügen',
    addRowConfirm: 'Hinzufügen',
    cancel: 'Abbrechen',
    noRows: 'Keine Einträge in dieser Woche. Fügen Sie eine Zeile hinzu, um zu beginnen.',
    multipleRecords: 'Dieser Tag enthält mehr als einen Datensatz. Bearbeiten Sie sie in der Liste.',
    invalidNumber: 'Geben Sie eine Zahl ein',
    saveFailed: 'Nicht gespeichert: {{message}}',
    notAllowed: 'Sie haben keine Berechtigung für diese Änderung.',
    loadFailed: 'Diese Woche konnte nicht geladen werden.',
    rowIncomplete: 'Füllen Sie zuerst alle Zeilenfelder aus.',
    cellLabel: '{{row}}, {{day}}',
    rowTotalLabel: 'Summe {{row}}',
    dayTotalLabel: 'Summe {{day}}',
  },
};

export default de;

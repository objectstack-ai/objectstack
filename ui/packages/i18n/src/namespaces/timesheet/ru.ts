/**
 * Русский (ru) — the lazy `timesheet` namespace's catalogue.
 *
 * A PARTIAL pack: the same shape as `../../locales/ru.ts`, holding only
 * the `timesheet` group, which `./index.ts` deep-merges into an i18next
 * instance when a timesheet view mounts. `./index.ts` says what the namespace
 * is, why it is lazy, and which gates read this file.
 *
 * ⛔ Keep the declaration `const ru = { … }` and `export default ru`:
 * the i18n gates under `ui/scripts/` read this file by AST under that name.
 */
const ru = {
  timesheet: {
    missingBindingTitle: 'Требуется настройка табеля',
    missingBindingMessage: 'Объявите timesheet.rowFields, timesheet.dateField и timesheet.valueField в этом представлении.',
    previousWeek: 'Предыдущая неделя',
    thisWeek: 'Эта неделя',
    nextWeek: 'Следующая неделя',
    total: 'Итого',
    addRow: 'Добавить строку',
    addRowConfirm: 'Добавить',
    cancel: 'Отмена',
    noRows: 'На этой неделе нет записей. Добавьте строку, чтобы начать.',
    multipleRecords: 'В этот день несколько записей. Измените их в списке.',
    invalidNumber: 'Введите число',
    saveFailed: 'Не сохранено: {{message}}',
    notAllowed: 'У вас нет прав на это изменение.',
    loadFailed: 'Не удалось загрузить эту неделю.',
    rowIncomplete: 'Сначала заполните все поля строки.',
    cellLabel: '{{row}}, {{day}}',
    rowTotalLabel: 'Итого: {{row}}',
    dayTotalLabel: 'Итого: {{day}}',
  },
};

export default ru;

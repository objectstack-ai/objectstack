/**
 * Español (es) — the lazy `timesheet` namespace's catalogue.
 *
 * A PARTIAL pack: the same shape as `../../locales/es.ts`, holding only
 * the `timesheet` group, which `./index.ts` deep-merges into an i18next
 * instance when a timesheet view mounts. `./index.ts` says what the namespace
 * is, why it is lazy, and which gates read this file.
 *
 * ⛔ Keep the declaration `const es = { … }` and `export default es`:
 * the i18n gates under `ui/scripts/` read this file by AST under that name.
 */
const es = {
  timesheet: {
    missingBindingTitle: 'Se requiere configurar la hoja de horas',
    missingBindingMessage: 'Declara timesheet.rowFields, timesheet.dateField y timesheet.valueField en esta vista.',
    previousWeek: 'Semana anterior',
    thisWeek: 'Esta semana',
    nextWeek: 'Semana siguiente',
    total: 'Total',
    addRow: 'Añadir fila',
    addRowConfirm: 'Añadir',
    cancel: 'Cancelar',
    noRows: 'No hay entradas esta semana. Añade una fila para empezar.',
    multipleRecords: 'Este día tiene más de un registro. Edítalos en la lista.',
    invalidNumber: 'Introduce un número',
    saveFailed: 'No guardado: {{message}}',
    notAllowed: 'No tiene permiso para realizar este cambio.',
    loadFailed: 'No se pudo cargar esta semana.',
    rowIncomplete: 'Rellena primero todos los campos de la fila.',
    cellLabel: '{{row}}, {{day}}',
    rowTotalLabel: 'Total de {{row}}',
    dayTotalLabel: 'Total de {{day}}',
  },
};

export default es;

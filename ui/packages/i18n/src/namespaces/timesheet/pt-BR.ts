/**
 * Português (pt-BR) — the lazy `timesheet` namespace's catalogue.
 *
 * A PARTIAL pack: the same shape as `../../locales/pt-BR.ts`, holding only
 * the `timesheet` group, which `./index.ts` deep-merges into an i18next
 * instance when a timesheet view mounts. `./index.ts` says what the namespace
 * is, why it is lazy, and which gates read this file.
 *
 * ⛔ Keep the declaration `const pt = { … }` and `export default pt`:
 * the i18n gates under `ui/scripts/` read this file by AST under that name.
 */
const pt = {
  timesheet: {
    missingBindingTitle: 'Configuração da folha de horas necessária',
    missingBindingMessage: 'Declare timesheet.rowFields, timesheet.dateField e timesheet.valueField nesta visualização.',
    previousWeek: 'Semana anterior',
    thisWeek: 'Esta semana',
    nextWeek: 'Próxima semana',
    total: 'Total',
    addRow: 'Adicionar linha',
    addRowConfirm: 'Adicionar',
    cancel: 'Cancelar',
    noRows: 'Nenhum lançamento nesta semana. Adicione uma linha para começar.',
    multipleRecords: 'Este dia tem mais de um registro. Edite-os na lista.',
    invalidNumber: 'Digite um número',
    saveFailed: 'Não salvo: {{message}}',
    notAllowed: 'Você não tem permissão para fazer esta alteração.',
    loadFailed: 'Não foi possível carregar esta semana.',
    rowIncomplete: 'Preencha primeiro todos os campos da linha.',
    cellLabel: '{{row}}, {{day}}',
    rowTotalLabel: 'Total de {{row}}',
    dayTotalLabel: 'Total de {{day}}',
  },
};

export default pt;

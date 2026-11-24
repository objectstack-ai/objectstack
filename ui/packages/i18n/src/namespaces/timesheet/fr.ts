/**
 * Français (fr) — the lazy `timesheet` namespace's catalogue.
 *
 * A PARTIAL pack: the same shape as `../../locales/fr.ts`, holding only
 * the `timesheet` group, which `./index.ts` deep-merges into an i18next
 * instance when a timesheet view mounts. `./index.ts` says what the namespace
 * is, why it is lazy, and which gates read this file.
 *
 * ⛔ Keep the declaration `const fr = { … }` and `export default fr`:
 * the i18n gates under `ui/scripts/` read this file by AST under that name.
 */
const fr = {
  timesheet: {
    missingBindingTitle: 'Configuration de la feuille de temps requise',
    missingBindingMessage: 'Déclarez timesheet.rowFields, timesheet.dateField et timesheet.valueField sur cette vue.',
    previousWeek: 'Semaine précédente',
    thisWeek: 'Cette semaine',
    nextWeek: 'Semaine suivante',
    total: 'Total',
    addRow: 'Ajouter une ligne',
    addRowConfirm: 'Ajouter',
    cancel: 'Annuler',
    noRows: 'Aucune saisie cette semaine. Ajoutez une ligne pour commencer.',
    multipleRecords: 'Ce jour contient plus d’un enregistrement. Modifiez-les dans la liste.',
    invalidNumber: 'Saisissez un nombre',
    saveFailed: 'Non enregistré : {{message}}',
    notAllowed: "Vous n'avez pas l'autorisation d'effectuer cette modification.",
    loadFailed: 'Impossible de charger cette semaine.',
    rowIncomplete: 'Renseignez d\'abord tous les champs de la ligne.',
    cellLabel: '{{row}}, {{day}}',
    rowTotalLabel: 'Total {{row}}',
    dayTotalLabel: 'Total {{day}}',
  },
};

export default fr;

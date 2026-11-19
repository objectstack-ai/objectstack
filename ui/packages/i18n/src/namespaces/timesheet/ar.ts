/**
 * العربية (ar) — the lazy `timesheet` namespace's catalogue.
 *
 * A PARTIAL pack: the same shape as `../../locales/ar.ts`, holding only
 * the `timesheet` group, which `./index.ts` deep-merges into an i18next
 * instance when a timesheet view mounts. `./index.ts` says what the namespace
 * is, why it is lazy, and which gates read this file.
 *
 * ⛔ Keep the declaration `const ar = { … }` and `export default ar`:
 * the i18n gates under `ui/scripts/` read this file by AST under that name.
 */
const ar = {
  timesheet: {
    missingBindingTitle: 'يلزم إعداد جدول الساعات',
    missingBindingMessage: 'عرّف timesheet.rowFields وtimesheet.dateField وtimesheet.valueField في طريقة العرض هذه.',
    previousWeek: 'الأسبوع السابق',
    thisWeek: 'هذا الأسبوع',
    nextWeek: 'الأسبوع التالي',
    total: 'الإجمالي',
    addRow: 'إضافة صف',
    addRowConfirm: 'إضافة',
    cancel: 'إلغاء',
    noRows: 'لا توجد إدخالات هذا الأسبوع. أضف صفًا للبدء.',
    multipleRecords: 'يحتوي هذا اليوم على أكثر من سجل واحد. عدّلها في القائمة.',
    invalidNumber: 'أدخل رقمًا',
    saveFailed: 'لم يتم الحفظ: {{message}}',
    notAllowed: 'ليس لديك إذن لإجراء هذا التغيير.',
    loadFailed: 'تعذر تحميل هذا الأسبوع.',
    rowIncomplete: 'املأ جميع حقول الصف أولاً.',
    cellLabel: '{{row}}، {{day}}',
    rowTotalLabel: 'إجمالي {{row}}',
    dayTotalLabel: 'إجمالي {{day}}',
  },
};

export default ar;

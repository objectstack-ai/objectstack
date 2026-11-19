/**
 * 한국어 (ko) — the lazy `timesheet` namespace's catalogue.
 *
 * A PARTIAL pack: the same shape as `../../locales/ko.ts`, holding only
 * the `timesheet` group, which `./index.ts` deep-merges into an i18next
 * instance when a timesheet view mounts. `./index.ts` says what the namespace
 * is, why it is lazy, and which gates read this file.
 *
 * ⛔ Keep the declaration `const ko = { … }` and `export default ko`:
 * the i18n gates under `ui/scripts/` read this file by AST under that name.
 */
const ko = {
  timesheet: {
    missingBindingTitle: '타임시트 구성이 필요합니다',
    missingBindingMessage: '이 뷰에 timesheet.rowFields, timesheet.dateField, timesheet.valueField를 선언하세요.',
    previousWeek: '이전 주',
    thisWeek: '이번 주',
    nextWeek: '다음 주',
    total: '합계',
    addRow: '행 추가',
    addRowConfirm: '추가',
    cancel: '취소',
    noRows: '이번 주에는 항목이 없습니다. 행을 추가하여 시작하세요.',
    multipleRecords: '이 날에는 레코드가 여러 개 있습니다. 목록에서 편집하세요.',
    invalidNumber: '숫자를 입력하세요',
    saveFailed: '저장되지 않음: {{message}}',
    notAllowed: '이 변경을 할 권한이 없습니다.',
    loadFailed: '이번 주를 불러올 수 없습니다.',
    rowIncomplete: '먼저 모든 행 필드를 입력하세요.',
    cellLabel: '{{row}}, {{day}}',
    rowTotalLabel: '{{row}} 합계',
    dayTotalLabel: '{{day}} 합계',
  },
};

export default ko;

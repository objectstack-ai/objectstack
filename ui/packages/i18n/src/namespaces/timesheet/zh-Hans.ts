/**
 * 简体中文 (zh-Hans) — the lazy `timesheet` namespace's catalogue.
 *
 * A PARTIAL pack: the same shape as `../../locales/zh-Hans.ts`, holding only
 * the `timesheet` group, which `./index.ts` deep-merges into an i18next
 * instance when a timesheet view mounts. `./index.ts` says what the namespace
 * is, why it is lazy, and which gates read this file.
 *
 * ⛔ Keep the declaration `const zh = { … }` and `export default zh`:
 * the i18n gates under `ui/scripts/` read this file by AST under that name.
 */
const zh = {
  timesheet: {
    missingBindingTitle: '需要配置工时表',
    missingBindingMessage: '请在此视图上声明 timesheet.rowFields、timesheet.dateField 和 timesheet.valueField。',
    previousWeek: '上一周',
    thisWeek: '本周',
    nextWeek: '下一周',
    total: '合计',
    addRow: '添加行',
    addRowConfirm: '添加',
    cancel: '取消',
    noRows: '本周没有记录。添加一行即可开始。',
    multipleRecords: '这一天有多条记录，请在列表中编辑。',
    invalidNumber: '请输入数字',
    saveFailed: '未保存：{{message}}',
    notAllowed: '您没有进行此更改的权限。',
    loadFailed: '无法加载本周数据。',
    rowIncomplete: '请先填写每个行字段。',
    cellLabel: '{{row}}，{{day}}',
    rowTotalLabel: '{{row}} 合计',
    dayTotalLabel: '{{day}} 合计',
  },
};

export default zh;

/**
 * Manual-verification demo for @object-ui/plugin-gantt.
 *
 *   pnpm --dir packages/plugin-gantt exec vite demo --port 5199
 *
 * Default: a project fixture exercising hierarchy, milestones, all four link
 * types and custom markers. Add ?perf=5000 for the performance scenario
 * (N tasks in summary groups with dependency chains + render timing banner).
 * Add ?mode=week|month|quarter to start in another time scale (default: day).
 */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import '@object-ui/components/style.css';
import { I18nProvider } from '@object-ui/react';
import { GanttView, type GanttTask, type GanttMarker, type GanttViewMode } from '../src/GanttView';
import { ResourceWorkload } from '../src/ResourceWorkload';
import { ObjectGantt } from '../src/ObjectGantt';
import type { WorkingCalendar } from '../src/scheduling';
import { normalizeShiftSegments } from '../src/shifts';

/**
 * Simplified Chinese pack for the Gantt chrome. Nested to match i18next's
 * default '.' key separator (so `t('gantt.column.taskName')` resolves). The
 * plugin's own English defaults cover the `en` path, so we only ship `zh` here.
 * With ?lang=zh the WHOLE chart localizes — chrome via these keys, dates via
 * `dateLocale` (driven by the provider language, not the browser locale).
 */
const GANTT_ZH = {
  gantt: {
    column: { taskName: '任务名称', start: '开始', end: '结束' },
    toolbar: {
      prevPeriod: '上一时段', nextPeriod: '下一时段', zoomIn: '放大', zoomOut: '缩小',
      jumpToToday: '跳到今天', today: '今天', showTaskList: '显示任务列表', hideTaskList: '隐藏任务列表',
      viewMode: '时间粒度', enterFullscreen: '进入全屏', exitFullscreen: '退出全屏',
      criticalPath: '高亮关键路径', autoSchedule: '自动排程依赖', exportPng: '导出 PNG',
      exportPdf: '导出 PDF', saveLayout: '保存布局',
      thisWeek: '本周', thisMonth: '本月',
      undo: '撤销', redo: '重做',
    },
    viewMode: { day: '日', week: '周', month: '月', quarter: '季', year: '年' },
    row: { expand: '展开', collapse: '折叠' },
    aria: { taskList: '任务列表' },
    tooltip: { days: '天' },
    menu: {
      view: '查看详情', edit: '行内编辑', delete: '删除',
      addPredecessor: '添加紧前依赖…', addSuccessor: '添加紧后依赖…',
      removeDependency: '移除依赖', noCandidates: '没有可选任务',
    },
    linkType: {
      fs: '完成→开始 (FS)', ss: '开始→开始 (SS)',
      ff: '完成→完成 (FF)', sf: '开始→完成 (SF)',
    },
    conflict: {
      title: '排期冲突',
      body: '此次移动与依赖约束冲突，是否自动顺延受影响的 {count} 个任务？',
      confirm: '自动顺延',
      cancel: '取消保留',
    },
    resource: { header: '资源', peak: '峰值', over: '超载', empty: '没有可分配的任务。' },
    readOnly: '只读',
    readOnlyHint: '此视图已禁用编辑。',
  },
};

const d = (s: string) => new Date(`${s}T00:00:00`);
/** Datetime parse (local time, no trailing Z) — for shift-precise 排班 fixtures. */
const dt = (s: string) => new Date(s);

/** Build a URL preserving current params but overriding one key. */
function withParam(key: string, value: string): string {
  const p = new URLSearchParams(window.location.search);
  p.set(key, value);
  return `?${p.toString()}`;
}

function projectFixture(): GanttTask[] {
  return [
    { id: 'p1', title: 'Discovery', start: d('2026-06-01'), end: d('2026-06-12'), progress: 0, parent: null },
    { id: 't1', title: 'Requirements', start: d('2026-06-01'), end: d('2026-06-09'), progress: 100, parent: 'p1', color: '#0ea5e9', baselineStart: d('2026-06-01'), baselineEnd: d('2026-06-06') },
    { id: 't2', title: 'Stakeholder interviews', start: d('2026-06-04'), end: d('2026-06-11'), progress: 80, parent: 'p1', color: '#0ea5e9', dependencies: [{ id: 't1', type: 'ss' }] },
    { id: 'm1', title: 'Spec sign-off', start: d('2026-06-12'), end: d('2026-06-12'), progress: 0, parent: 'p1', type: 'milestone', dependencies: ['t2'] },

    { id: 'p2', title: 'Build', start: d('2026-06-12'), end: d('2026-07-22'), progress: 0, parent: null },
    { id: 't3', title: 'API design', start: d('2026-06-12'), end: d('2026-06-19'), progress: 60, parent: 'p2', color: '#8b5cf6', dependencies: ['m1'] },
    { id: 't4', title: 'Backend services', start: d('2026-06-18'), end: d('2026-07-08'), progress: 30, parent: 'p2', color: '#8b5cf6', dependencies: [{ id: 't3', type: 'fs' }], baselineStart: d('2026-06-16'), baselineEnd: d('2026-07-02'), fields: [{ label: 'Owner', value: 'Priya N.' }, { label: 'Status', value: 'In Progress' }, { label: 'Effort', value: '15 days' }] },
    { id: 't5', title: 'Frontend app', start: d('2026-06-22'), end: d('2026-07-15'), progress: 15, parent: 'p2', color: '#8b5cf6', dependencies: ['t3'], baselineStart: d('2026-06-22'), baselineEnd: d('2026-07-10') },
    { id: 't6', title: 'Integration', start: d('2026-07-10'), end: d('2026-07-22'), progress: 0, parent: 'p2', color: '#8b5cf6', dependencies: ['t4', 't5'] },

    { id: 'p3', title: 'Launch', start: d('2026-07-01'), end: d('2026-08-07'), progress: 0, parent: null },
    { id: 't7', title: 'QA & hardening', start: d('2026-07-20'), end: d('2026-08-05'), progress: 0, parent: 'p3', color: '#f59e0b', dependencies: ['t6'] },
    { id: 't8', title: 'Documentation', start: d('2026-07-01'), end: d('2026-08-01'), progress: 10, parent: 'p3', color: '#f59e0b', dependencies: [{ id: 't7', type: 'sf' }] },
    { id: 'm2', title: 'Release', start: d('2026-08-07'), end: d('2026-08-07'), progress: 0, parent: 'p3', type: 'milestone', dependencies: [{ id: 't7', type: 'ff' }] },
  ];
}

/**
 * Geometry edge cases (?edge=1): backward links of every type, links into
 * summary rows and milestones, and tight adjacent-row hops — the shapes most
 * likely to expose anchor/elbow misalignment.
 */
function edgeFixture(): GanttTask[] {
  return [
    { id: 's1', title: 'Group A', start: d('2026-06-01'), end: d('2026-06-20'), progress: 0, parent: null },
    { id: 'a1', title: 'Early', start: d('2026-06-01'), end: d('2026-06-06'), progress: 50, parent: 's1' },
    { id: 'a2', title: 'Late fs←back', start: d('2026-06-10'), end: d('2026-06-16'), progress: 0, parent: 's1', dependencies: [{ id: 'a3', type: 'fs' }] },
    { id: 'a3', title: 'Mid', start: d('2026-06-04'), end: d('2026-06-08'), progress: 20, parent: 's1', dependencies: [{ id: 'a1', type: 'ss' }] },
    { id: 'a4', title: 'Backward ss', start: d('2026-06-02'), end: d('2026-06-07'), progress: 0, parent: 's1', dependencies: [{ id: 'a2', type: 'ss' }] },

    { id: 's2', title: 'Group B', start: d('2026-06-05'), end: d('2026-06-25'), progress: 0, parent: null },
    { id: 'b1', title: 'Backward ff', start: d('2026-06-05'), end: d('2026-06-09'), progress: 0, parent: 's2', dependencies: [{ id: 'a2', type: 'ff' }] },
    { id: 'b2', title: 'Backward sf', start: d('2026-06-18'), end: d('2026-06-25'), progress: 0, parent: 's2', dependencies: [{ id: 'b1', type: 'sf' }] },
    { id: 'm3', title: 'Gate', start: d('2026-06-12'), end: d('2026-06-12'), progress: 0, parent: 's2', type: 'milestone', dependencies: ['b1'] },
    { id: 'm4', title: 'Ship', start: d('2026-06-20'), end: d('2026-06-20'), progress: 0, parent: 's2', type: 'milestone', dependencies: [{ id: 'm3', type: 'fs' }] },

    // Links touching summary rows (rollup brackets) — y anchor must hit the bracket.
    { id: 's3', title: 'Group C (after A)', start: d('2026-06-21'), end: d('2026-06-28'), progress: 0, parent: null, dependencies: [{ id: 's1', type: 'fs' }] },
    { id: 'c1', title: 'Adjacent hop', start: d('2026-06-21'), end: d('2026-06-24'), progress: 0, parent: 's3' },
    { id: 'c2', title: 'Next row', start: d('2026-06-24'), end: d('2026-06-28'), progress: 0, parent: 's3', dependencies: ['c1'] },
  ];
}

/**
 * 制造排班 4 层树 (?mfg=1) — mirrors 3.4 制造排班甘特图 as closely as the demo
 * fixture can express it.
 *
 * 3.4.1 树状结构 (左侧任务列表区):
 *   一级 项目      → type:'group'  无条 (pure header, expand/collapse)
 *   二级 产品      → type:'group'  无条
 *   三级 排产计划   → summary (has children) 有时间条 · 全部甘特图操作 · 默认折叠
 *   四级 派工单     → task leaf     子任务条 (仅查看/跳转, locked) · 不可展开
 *
 * 3.4.3 任务展示 — 按状态着色:
 *   排产计划: 00待开始=深灰 · 01已下推=蓝 · 02进行中=绿(带进度) · 03已完成=深绿
 *   里程碑 (是否里程碑=是): 仍是普通排产计划条, 仅在条上文字前加 ◆ 前缀, 不画菱形
 *   派工单:   00待开始=浅灰 · 01进行中=浅蓝 · 02已报工=浅橙 · 03已完成=浅绿
 *
 * 3.4.4 悬浮详情 — `fields` 驱动 tooltip:
 *   排产计划: 编号/作业对象/计划起止/定额工时/管理责任人/执行责任人/状态/进度
 *   派工单:   派工单编号/执行责任人/作业对象/计划起止/实际起止/状态
 *
 * 3.4.6 依赖校验 — FS 依赖连线仅在三级 (排产计划) 之间; 四级不参与。
 * 计划 vs 实际 — 派工单用 baseline 条展示 计划起止 (实际 = 主条)。
 */
// 三级 排产计划 状态色
const PLAN_COLOR = {
  todo: '#6b7280', // 00 待开始 深灰
  pushed: '#3b82f6', // 01 已下推 蓝
  doing: '#22c55e', // 02 进行中 绿
  done: '#15803d', // 03 已完成 深绿
} as const;
// 四级 派工单 状态色 (浅色系, 紧贴所属排产计划下方)
const WORK_COLOR = {
  todo: '#d1d5db', // 00 待开始 浅灰
  doing: '#93c5fd', // 01 进行中 浅蓝
  reported: '#fdba74', // 02 已报工 浅橙
  done: '#86efac', // 03 已完成 浅绿
} as const;

function manufacturingFixture(): GanttTask[] {
  // 三级 悬浮详情: 编号/作业对象/计划起止/定额工时/管理责任人/执行责任人/状态/进度
  const plan3 = (
    f: { code: string; obj: string; span: string; quota: string; mgr: string; doers: string; status: string; progress: string },
  ) => [
    { label: '编号', value: f.code },
    { label: '作业对象', value: f.obj },
    { label: '计划起止', value: f.span },
    { label: '定额工时', value: f.quota },
    { label: '管理责任人', value: f.mgr },
    { label: '执行责任人', value: f.doers },
    { label: '状态', value: f.status },
    { label: '进度', value: f.progress },
  ];
  // 四级 悬浮详情: 派工单编号/执行责任人/作业对象/计划起止/实际起止/状态
  const wo4 = (
    f: { code: string; doer: string; obj: string; plan: string; actual: string; status: string },
  ) => [
    { label: '派工单编号', value: f.code },
    { label: '执行责任人', value: f.doer },
    { label: '作业对象', value: f.obj },
    { label: '计划起止', value: f.plan },
    { label: '实际起止', value: f.actual },
    { label: '状态', value: f.status },
  ];
  // 排班分段 (白班 08:00–20:00 / 夜班 20:00–次日08:00): 三级排产计划按整排班日
  // (08:00→08:00) 排, 四级派工单落到具体白班 / 夜班 — 含一条跨午夜的夜班 (wo-002)。
  return [
    // ── 一级: 项目 (无条) ───────────────────────────────────────────────
    { id: 'prj-A', title: '项目A（导管架制造）', start: dt('2026-06-03T08:00'), end: dt('2026-06-08T08:00'), progress: 0, parent: null, type: 'group' },

    // ── 二级: 产品A-1 (无条) ────────────────────────────────────────────
    { id: 'prod-A1', title: '产品A-1（XX项目导管架）', start: dt('2026-06-03T08:00'), end: dt('2026-06-05T20:00'), progress: 0, parent: 'prj-A', type: 'group' },

    // 三级 plan-1 — 03 已完成 (深绿, 100%) · 整排班日 06-03 (白+夜)
    { id: 'plan-1', title: '将军柱组焊（排产计划）', start: dt('2026-06-03T08:00'), end: dt('2026-06-04T08:00'), progress: 100, parent: 'prod-A1', color: PLAN_COLOR.done,
      fields: plan3({ code: 'PP-2026-001', obj: '将军柱·KK节点', span: '06-03 08:00 ~ 06-04 08:00', quota: '24h', mgr: '李工', doers: '张三、李四', status: '已完成', progress: '100%' }) },
    { id: 'wo-001', title: 'WO001 张三（白班派工单）', start: dt('2026-06-03T08:00'), end: dt('2026-06-03T20:00'), progress: 100, parent: 'plan-1', color: WORK_COLOR.done, locked: true,
      baselineStart: dt('2026-06-03T08:00'), baselineEnd: dt('2026-06-03T20:00'),
      fields: wo4({ code: 'WO-2026-001', doer: '张三', obj: '将军柱·KK节点', plan: '06-03 白班 (08:00~20:00)', actual: '06-03 白班', status: '已完成' }) },
    { id: 'wo-002', title: 'WO002 李四（夜班·跨午夜派工单）', start: dt('2026-06-03T20:00'), end: dt('2026-06-04T08:00'), progress: 60, parent: 'plan-1', color: WORK_COLOR.reported, locked: true,
      baselineStart: dt('2026-06-03T20:00'), baselineEnd: dt('2026-06-04T08:00'),
      fields: wo4({ code: 'WO-2026-002', doer: '李四', obj: '将军柱·KK节点', plan: '06-03 夜班 (20:00~次日08:00)', actual: '06-03 夜班', status: '已报工' }) },

    // 三级 plan-2 — 02 进行中 (绿, 45%) · 整排班日 06-04 · 依赖 plan-1 (FS)
    { id: 'plan-2', title: '主腿管接长（排产计划）', start: dt('2026-06-04T08:00'), end: dt('2026-06-05T08:00'), progress: 45, parent: 'prod-A1', color: PLAN_COLOR.doing,
      dependencies: [{ id: 'plan-1', type: 'fs' }],
      fields: plan3({ code: 'PP-2026-002', obj: '主腿管·D1800', span: '06-04 08:00 ~ 06-05 08:00', quota: '24h', mgr: '李工', doers: '王五、赵六', status: '进行中', progress: '45%' }) },
    // 唯一未锁定的派工单 — 可拖动 / 拉伸, 松手吸附到 12h 班次边界 (白班↔夜班)。
    { id: 'wo-003', title: 'WO003 王五（白班派工单·可拖）', start: dt('2026-06-04T08:00'), end: dt('2026-06-04T20:00'), progress: 70, parent: 'plan-2', color: WORK_COLOR.doing,
      baselineStart: dt('2026-06-04T08:00'), baselineEnd: dt('2026-06-04T20:00'),
      fields: wo4({ code: 'WO-2026-003', doer: '王五', obj: '主腿管·D1800', plan: '06-04 白班 (08:00~20:00)', actual: '06-04 白班 (进行中)', status: '进行中' }) },
    { id: 'wo-004', title: 'WO004 赵六（夜班·跨午夜派工单）', start: dt('2026-06-04T20:00'), end: dt('2026-06-05T08:00'), progress: 0, parent: 'plan-2', color: WORK_COLOR.todo, locked: true,
      fields: wo4({ code: 'WO-2026-004', doer: '赵六', obj: '主腿管·D1800', plan: '06-04 夜班 (20:00~次日08:00)', actual: '— ~ —', status: '待开始' }) },

    // 三级 里程碑 — 仍是一条普通排产计划 (有计划起止/时间条), 只是 `是否里程碑=是`,
    // 显示时在条上文字最前面加 ◆ 前缀标记 (不画菱形)。06-05 白班 · 依赖 plan-2 (FS)。
    { id: 'ms-A1', title: '◆ 段建完成（排产计划·里程碑）', start: dt('2026-06-05T08:00'), end: dt('2026-06-05T20:00'), progress: 0, parent: 'prod-A1', color: PLAN_COLOR.todo,
      dependencies: [{ id: 'plan-2', type: 'fs' }],
      fields: plan3({ code: 'PP-2026-005', obj: '段建·阶段验收', span: '06-05 白班 (08:00~20:00)', quota: '8h', mgr: '李工', doers: '李工', status: '待开始', progress: '0%' }).concat({ label: '是否里程碑', value: '是' }) },

    // ── 二级: 产品A-2 (无条) ────────────────────────────────────────────
    { id: 'prod-A2', title: '产品A-2（YY项目导管架）', start: dt('2026-06-05T08:00'), end: dt('2026-06-08T08:00'), progress: 0, parent: 'prj-A', type: 'group' },

    // 三级 plan-3 — 01 已下推 (蓝, 0%) · 整排班日 06-05 · 依赖 plan-2 (FS)
    { id: 'plan-3', title: '分段预制（排产计划）', start: dt('2026-06-05T08:00'), end: dt('2026-06-06T08:00'), progress: 0, parent: 'prod-A2', color: PLAN_COLOR.pushed,
      dependencies: [{ id: 'plan-2', type: 'fs' }],
      fields: plan3({ code: 'PP-2026-003', obj: '分段·S2', span: '06-05 08:00 ~ 06-06 08:00', quota: '24h', mgr: '陈工', doers: '钱七', status: '已下推', progress: '0%' }) },
    { id: 'wo-005', title: 'WO005 钱七（整排班日派工单）', start: dt('2026-06-05T08:00'), end: dt('2026-06-06T08:00'), progress: 0, parent: 'plan-3', color: WORK_COLOR.todo, locked: true,
      fields: wo4({ code: 'WO-2026-005', doer: '钱七', obj: '分段·S2', plan: '06-05 08:00 ~ 06-06 08:00 (白+夜)', actual: '— ~ —', status: '待开始' }) },

    // 三级 plan-4 — 00 待开始 (深灰) · 跨两个排班日 06-06→06-08 · 依赖 plan-3 (FS)
    { id: 'plan-4', title: '总装合拢（排产计划）', start: dt('2026-06-06T08:00'), end: dt('2026-06-08T08:00'), progress: 0, parent: 'prod-A2', color: PLAN_COLOR.todo,
      dependencies: [{ id: 'plan-3', type: 'fs' }],
      fields: plan3({ code: 'PP-2026-004', obj: '导管架·总装', span: '06-06 08:00 ~ 06-08 08:00', quota: '48h', mgr: '陈工', doers: '孙八', status: '待开始', progress: '0%' }) },
    { id: 'wo-006', title: 'WO006 孙八（连两个排班日派工单）', start: dt('2026-06-06T08:00'), end: dt('2026-06-08T08:00'), progress: 0, parent: 'plan-4', color: WORK_COLOR.todo, locked: true,
      fields: wo4({ code: 'WO-2026-006', doer: '孙八', obj: '导管架·总装', plan: '06-06 08:00 ~ 06-08 08:00', actual: '— ~ —', status: '待开始' }) },
  ];
}

function perfFixture(n: number): GanttTask[] {
  const tasks: GanttTask[] = [];
  const groupSize = 10;
  const base = d('2026-01-05').getTime();
  const DAY = 86_400_000;
  for (let i = 0; i < n; i++) {
    const group = Math.floor(i / groupSize);
    const inGroup = i % groupSize;
    if (inGroup === 0) {
      tasks.push({
        id: `g${group}`,
        title: `Workstream ${group + 1}`,
        start: new Date(base),
        end: new Date(base),
        progress: 0,
        parent: null,
      });
      continue;
    }
    const start = base + (group % 40) * 7 * DAY + inGroup * 2 * DAY;
    tasks.push({
      id: `task${i}`,
      title: `Task ${i}`,
      start: new Date(start),
      end: new Date(start + (3 + (i % 5)) * DAY),
      progress: (i * 13) % 101,
      parent: `g${group}`,
      color: ['#0ea5e9', '#8b5cf6', '#f59e0b', '#10b981'][group % 4],
      dependencies: inGroup > 1 ? [`task${i - 1}`] : undefined,
    });
  }
  return tasks;
}

const markers: GanttMarker[] = [
  { date: d('2026-06-22'), label: 'Sprint 2' },
  { date: d('2026-07-25'), label: 'Code freeze', color: '#ef4444' },
];

// Round-robin owner/status so ?group=owner|status has something to bucket by.
const OWNERS = ['Priya N.', 'Sam K.', 'Lee W.'];
const STATUSES = ['Todo', 'In Progress', 'Done'];

/** Attach owner/status to leaf tasks so the Group-by demo has fields to group. */
function decorateForGrouping(tasks: GanttTask[]): GanttTask[] {
  let i = 0;
  return tasks.map((t) => ({
    ...t,
    data: { ...(t.data ?? {}), owner: OWNERS[i % OWNERS.length], status: STATUSES[i++ % STATUSES.length] },
  }));
}

/**
 * Quick-filter (快速筛选) demo (?quickfilter=1). Drives the real ObjectGantt with
 * an in-memory mock data source modeled on the 排产计划 (production-scheduling)
 * list: select dimensions (状态 / 派工类别) resolve options from the schema, and
 * lookup dimensions (项目 / 产品) pull their full option domain from referenced
 * objects. Selecting a filter narrows the bars AND the timeline auto-zooms to
 * the remaining interval (auto-zoom is free — GanttView re-derives the range).
 */
const PLAN_RECORDS = [
  { id: 'r1', name: '下料-01', start: '2026-06-01', end: '2026-06-04', status: 'todo', dispatch_type: '生产派工单', project: { id: 'pA', name: '项目A' }, product: { id: 'gX', name: '产品X' }, owner: '张三' },
  { id: 'r2', name: '焊接-02', start: '2026-06-05', end: '2026-06-10', status: 'doing', dispatch_type: '生产派工单', project: { id: 'pA', name: '项目A' }, product: { id: 'gX', name: '产品X' }, owner: '张三' },
  { id: 'r3', name: '质检-03', start: '2026-06-11', end: '2026-06-13', status: 'todo', dispatch_type: '质检派工单', project: { id: 'pA', name: '项目A' }, product: { id: 'gY', name: '产品Y' }, owner: '李四' },
  { id: 'r4', name: '装配-04', start: '2026-06-20', end: '2026-06-28', status: 'pushed', dispatch_type: '生产派工单', project: { id: 'pB', name: '项目B' }, product: { id: 'gY', name: '产品Y' }, owner: '王五' },
  { id: 'r5', name: '设备点检-05', start: '2026-07-01', end: '2026-07-03', status: 'doing', dispatch_type: '设备设施派工单', project: { id: 'pB', name: '项目B' }, product: { id: 'gX', name: '产品X' }, owner: '王五' },
  { id: 'r6', name: '返修-06', start: '2026-07-08', end: '2026-07-12', status: 'done', dispatch_type: '零星派工单', project: { id: 'pB', name: '项目B' }, product: { id: 'gY', name: '产品Y' }, owner: '李四' },
  { id: 'r7', name: '总装-07', start: '2026-07-15', end: '2026-07-25', status: 'todo', dispatch_type: '生产派工单', project: { id: 'pA', name: '项目A' }, product: { id: 'gX', name: '产品X' }, owner: '张三' },
  { id: 'r8', name: '终检-08', start: '2026-07-28', end: '2026-07-31', status: 'todo', dispatch_type: '质检派工单', project: { id: 'pB', name: '项目B' }, product: { id: 'gX', name: '产品X' }, owner: '李四' },
];

const PLAN_SCHEMA_FIELDS = {
  name: { type: 'text', label: '名称' },
  start: { type: 'date', label: '开始' },
  end: { type: 'date', label: '结束' },
  status: {
    type: 'select',
    label: '状态',
    options: [
      { value: 'todo', label: '待开始' },
      { value: 'pushed', label: '已下推' },
      { value: 'doing', label: '进行中' },
      { value: 'done', label: '已完成' },
    ],
  },
  dispatch_type: {
    type: 'select',
    label: '派工类别',
    options: [
      { value: '生产派工单', label: '生产派工单' },
      { value: '质检派工单', label: '质检派工单' },
      { value: '设备设施派工单', label: '设备设施派工单' },
      { value: '零星派工单', label: '零星派工单' },
    ],
  },
  // objectui#6837 half 2: `reference` is the only target spelling
  // `@objectstack/spec`'s `FieldSchema` declares — it refuses `reference_to` by
  // name. This demo's `getObjectSchema` does NOT pass the ingestion choke
  // point, so it was the one in-repo producer measurably on the break surface;
  // fixed AT THE PRODUCER, which is what the ruling asks for.
  project: { type: 'lookup', label: '项目', reference: 'project' },
  product: { type: 'lookup', label: '产品', reference: 'product' },
  owner: { type: 'text', label: '管理责任人' },
};

const REFERENCE_RECORDS: Record<string, Array<{ id: string; name: string }>> = {
  project: [
    { id: 'pA', name: '项目A' },
    { id: 'pB', name: '项目B' },
    { id: 'pC', name: '项目C（暂无任务）' },
  ],
  product: [
    { id: 'gX', name: '产品X' },
    { id: 'gY', name: '产品Y' },
    { id: 'gZ', name: '产品Z（暂无任务）' },
  ],
};

const planDataSource = {
  find: (resource: string) =>
    Promise.resolve({ data: REFERENCE_RECORDS[resource] ?? PLAN_RECORDS }),
  findOne: () => Promise.resolve(null),
  create: () => Promise.resolve({}),
  update: () => Promise.resolve({}),
  delete: () => Promise.resolve(undefined),
  getObjectSchema: () => Promise.resolve({ fields: PLAN_SCHEMA_FIELDS }),
} as any;

const planSchema = {
  type: 'gantt',
  objectName: 'production_plan',
  startDateField: 'start',
  endDateField: 'end',
  titleField: 'name',
  progressField: undefined,
  quickFilters: [
    { field: 'project', label: '项目' },
    { field: 'product', label: '产品' },
    { field: 'status', label: '状态' },
    { field: 'dispatch_type', label: '派工类别' },
    { field: 'owner', label: '管理责任人' },
  ],
  // autoZoomToFilter defaults to true → timeline rescales to the filtered span.
} as any;

function QuickFilterDemo() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        data-testid="demo-banner"
        style={{ padding: '6px 12px', fontSize: 12, borderBottom: '1px solid hsl(var(--border))', display: 'flex', gap: 16 }}
      >
        <strong>Gantt demo · 快速筛选</strong>
        <a href="?">project fixture</a>
        <a href="?quickfilter=1">quick filter</a>
      </div>
      <div style={{ flex: 1, minHeight: 0 }} data-testid="quickfilter-host">
        <ObjectGantt schema={planSchema} dataSource={planDataSource} />
      </div>
    </div>
  );
}

/** One color swatch in the manufacturing legend. Hoisted to module scope so it
 *  is a stable component reference (react-hooks/static-components); purely
 *  props-driven, so nothing from the legend's render scope is captured. */
function Swatch({ color, label, hollow }: { color: string; label: string; hollow?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 12, height: 12, borderRadius: 3, background: hollow ? 'transparent' : color, border: hollow ? `1px solid ${color}` : 'none', display: 'inline-block' }} />
      {label}
    </span>
  );
}

/** 状态色图例 (3.4.3) — decodes the 排产计划 / 派工单 bar colors for the mfg demo. */
function ManufacturingLegend() {
  return (
    <div
      data-testid="mfg-legend"
      style={{ padding: '4px 12px', fontSize: 11, borderBottom: '1px solid hsl(var(--border))', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', color: 'hsl(var(--muted-foreground))' }}
    >
      <strong style={{ color: 'hsl(var(--foreground))' }}>排产计划</strong>
      <Swatch color={PLAN_COLOR.todo} label="待开始" />
      <Swatch color={PLAN_COLOR.pushed} label="已下推" />
      <Swatch color={PLAN_COLOR.doing} label="进行中" />
      <Swatch color={PLAN_COLOR.done} label="已完成" />
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontWeight: 700 }}>◆</span>前缀 = 里程碑标记
      </span>
      <span style={{ opacity: 0.4 }}>|</span>
      <strong style={{ color: 'hsl(var(--foreground))' }}>派工单</strong>
      <Swatch color={WORK_COLOR.todo} label="待开始" />
      <Swatch color={WORK_COLOR.doing} label="进行中" />
      <Swatch color={WORK_COLOR.reported} label="已报工" />
      <Swatch color={WORK_COLOR.done} label="已完成" />
      <span style={{ opacity: 0.4 }}>|</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <span style={{ width: 14, height: 4, borderRadius: 1, background: 'rgba(100,116,139,0.35)', border: '1px solid rgba(100,116,139,0.6)', display: 'inline-block' }} />
        细灰条 = 计划基线
      </span>
      <span style={{ opacity: 0.4 }}>|</span>
      <span>依赖连线仅在三级之间 (FS) · 派工单 locked 仅查看 · 悬浮看详情</span>
    </div>
  );
}

/**
 * 班次/排班分段 config — wired into the 制造排班 (4层树) demo (?mfg=1). Splits
 * each 排班日 into 白班 (08:00–20:00) and 夜班 (20:00–次日08:00), 12h each. The
 * "day" column starts at dayStart (08:00) and runs a full 24h so a cross-midnight
 * 夜班 sits wholly inside one column. Two-tier header: top = 排班日 date, bottom =
 * 白班 | 夜班. Drag a bar and it snaps to the 12h band boundary instead of whole
 * days. Off by default — a pure config feature gated like working-calendar folding
 * (zero regression when unset). No `color` on the bands → 白班/夜班 render with no
 * background tint.
 */
const shiftConfig = (showMidnight: boolean) => ({
  dayStart: '08:00',
  showMidnight,
  bands: [
    { key: 'day', label: '白班', start: '08:00', end: '20:00' },
    { key: 'night', label: '夜班', start: '20:00', end: '08:00' },
  ],
});

function App() {
  const params = new URLSearchParams(window.location.search);
  const perf = Number(params.get('perf') || 0);
  const edge = params.has('edge');
  const mfg = params.has('mfg');
  // 制造排班示例: 日历午夜虚线开关 (默认显示)。
  const [showMidnight, setShowMidnight] = React.useState(true);
  const shifts = React.useMemo(
    () => normalizeShiftSegments(shiftConfig(showMidnight)),
    [showMidnight],
  );
  const workingCalendar: WorkingCalendar | undefined =
    params.get('cal') === '1' ? { skipWeekends: true } : undefined;
  const showBaselines = params.get('baselines') !== '0';
  const readOnly = params.get('readonly') === '1';
  // ?mobilereadonly=1 — force read-only on narrow viewports (移动端只读缩略).
  const mobileReadOnly = params.get('mobilereadonly') === '1';
  // ?group=owner|status — dynamic Group by (动态 Group by). Buckets leaf tasks
  // under one synthesized summary row per distinct value.
  const groupField = params.get('group');
  const groupBy = React.useMemo(() => {
    if (groupField !== 'owner' && groupField !== 'status') return undefined;
    return (task: GanttTask) => {
      const v = (task.data ?? {})[groupField];
      if (v == null || v === '') return null;
      return { key: String(v), label: String(v) };
    };
  }, [groupField]);
  // ?resource=owner|status — Resource / Workload view (资源/工作负载视图). Swaps
  // the Gantt grid for a per-resource load histogram bucketed by the field.
  const resourceField = params.get('resource');
  const resourceMode = resourceField === 'owner' || resourceField === 'status';
  const assignee = React.useMemo(() => {
    const field = resourceMode ? (resourceField as string) : 'owner';
    return (task: GanttTask) => {
      const v = (task.data ?? {})[field];
      if (v == null || v === '') return null;
      return { key: String(v), label: String(v) };
    };
  }, [resourceMode, resourceField]);
  // Demo-only render timer: capturing the render-start timestamp necessarily
  // reads performance.now() during render (paired with the effect below that
  // measures elapsed ms). Intentional and demo-only.
  // eslint-disable-next-line react-hooks/purity
  const t0 = React.useMemo(() => performance.now(), []);
  const [tasks, setTasks] = React.useState<GanttTask[]>(() => {
    const base = perf > 0 ? perfFixture(perf) : edge ? edgeFixture() : mfg ? manufacturingFixture() : projectFixture();
    return groupField || resourceMode ? decorateForGrouping(base) : base;
  });
  const [renderMs, setRenderMs] = React.useState<number | null>(null);
  React.useEffect(() => {
    const ms = performance.now() - t0;
    setRenderMs(ms);
    // eslint-disable-next-line no-console
    console.log(`[gantt-demo] initial render of ${tasks.length} tasks: ${ms.toFixed(1)}ms`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = (id: GanttTask['id'], changes: Partial<GanttTask>) =>
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...changes } : t)));

  // Expose the live task array for browser verification scripts (working-day
  // boundary checks need the actual Date objects, not just bar geometry).
  React.useEffect(() => {
    (window as unknown as { __ganttTasks?: GanttTask[] }).__ganttTasks = tasks;
  }, [tasks]);

  // Route to the quick-filter demo AFTER all hooks above run, so the hook order
  // stays stable across renders (React requires the same hooks every render).
  if (params.get('quickfilter') === '1') return <QuickFilterDemo />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        data-testid="demo-banner"
        style={{ padding: '6px 12px', fontSize: 12, borderBottom: '1px solid hsl(var(--border))', display: 'flex', gap: 16 }}
      >
        <strong>Gantt demo</strong>
        <span>{tasks.length} tasks</span>
        {renderMs != null && <span data-testid="demo-render-ms">initial render: {renderMs.toFixed(1)}ms</span>}
        <a href="?">project fixture</a>
        <a href="?mfg=1&lang=zh&mode=day">制造排班 (4层树)</a>
        <a href="?cal=1">working calendar</a>
        <a href="?baselines=0">no baselines</a>
        <a href="?readonly=1">read-only</a>
        <a href="?perf=5000&mode=week">perf: 5000 tasks</a>
        <a href="?group=owner">group: owner</a>
        <a href="?group=status">group: status</a>
        <a href="?resource=owner">resource: owner</a>
        <a href="?resource=status">resource: status</a>
        <a href="?quickfilter=1">quick filter</a>
        {mfg && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="checkbox"
              data-testid="toggle-midnight"
              checked={showMidnight}
              onChange={(e) => setShowMidnight(e.target.checked)}
            />
            午夜虚线
          </label>
        )}
        <span style={{ marginLeft: 'auto' }}>
          {/* Language toggle: chrome + dates localize together. */}
          <a href={withParam('lang', 'en')}>English</a>
          {' · '}
          <a href={withParam('lang', 'zh')}>中文</a>
        </span>
      </div>
      {mfg && <ManufacturingLegend />}
      <div style={{ flex: 1, minHeight: 0 }}>
        {resourceMode ? (
          <ResourceWorkload
            tasks={tasks}
            assignee={assignee}
            viewMode={(params.get('mode') as GanttViewMode) || 'day'}
            unassignedLabel="未分配"
          />
        ) : (
        <GanttView
          tasks={tasks}
          // Only force the granularity when ?mode= is given; otherwise let a
          // persisted layout (保存布局) restore it on reload.
          viewMode={params.get('mode') ? (params.get('mode') as GanttViewMode) : undefined}
          markers={markers}
          autoSchedule
          rescheduleOnConflict
          criticalPathDefault={params.get('critical') === '1'}
          workingCalendar={workingCalendar}
          showBaselines={showBaselines}
          readOnly={readOnly}
          mobileReadOnly={mobileReadOnly}
          groupBy={groupBy}
          ungroupedLabel="未分组"
          // 制造排班示例: 三级排产计划 (depth 2) 默认折叠。
          defaultCollapsedDepth={mfg ? 2 : undefined}
          // 制造排班示例: 启用班次分段 (白班/夜班), 排班日 08:00 起算。
          shiftSegments={mfg ? shifts : undefined}
          persistLayoutKey={mfg ? undefined : "demo-project"}
          onLayoutChange={() => {}}
          inlineEdit
          onTaskClick={() => {}}
          onTaskUpdate={(t, changes) => patch(t.id, changes)}
          onTaskDelete={(t) => setTasks((prev) => prev.filter((x) => x.id !== t.id))}
          onDependencyCreate={(source, target, type) =>
            patch(target.id, {
              dependencies: [
                ...(target.dependencies ?? []).filter(
                  (d) => String(typeof d === 'object' ? d.id : d) !== String(source.id),
                ),
                { id: source.id, type },
              ],
            })
          }
          onDependencyDelete={(source, target) =>
            patch(target.id, {
              dependencies: (target.dependencies ?? []).filter(
                (d) => String(typeof d === 'object' ? d.id : d) !== String(source.id),
              ),
            })
          }
          onTaskReorder={(task, before) =>
            setTasks((prev) => {
              const next = prev.filter((t) => t.id !== task.id);
              next.splice(next.findIndex((t) => t.id === before.id), 0, task);
              return next;
            })
          }
        />
        )}
      </div>
    </div>
  );
}

// Drive the whole chart's language from ?lang (default English). The provider
// supplies the zh chrome bundle; GanttView's `dateLocale` then localizes the
// calendar/tooltips to the SAME language, so the demo is never half-translated.
const lang = new URLSearchParams(window.location.search).get('lang') === 'zh' ? 'zh' : 'en';
createRoot(document.getElementById('root')!).render(
  <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false, resources: { zh: GANTT_ZH } }}>
    <App />
  </I18nProvider>
);

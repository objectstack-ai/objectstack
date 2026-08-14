// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A FROZEN SNAPSHOT of the `examples/app-showcase` metadata shape, for the three
 * `translation-section-name-missing` tests that used to import that app live
 * (#8515).
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * `validate-translatable-sections` reports a form section that declares a
 * `label` and no `name`. Until #8515 its strongest tests imported
 * `examples/app-showcase` DIRECTLY and pinned three of its sections in exactly
 * that state — so the shipped app had to STAY defective for the rule's
 * regression coverage to keep proving anything. #8231's sweep took the family
 * from 24 warnings to 3, and those last 3 were the fixtures. The rule's
 * evidence and the app's defect were the same three objects.
 *
 * Maintainer ruling (2026-08-13, recorded on #8515): move the pinned tests onto
 * synthetic fixtures DERIVED FROM A SNAPSHOT of the shipped shape. Realistic
 * structure is kept — this is a copy of real, shipped, spec-parsed metadata, not
 * a minimal object hand-built to trip the rule — but the fixtures no longer come
 * from `examples/**`, so an example-app sweep can no longer pull them out from
 * under the rule. Three routes were considered and REJECTED by that ruling, and
 * none is available as a fallback here: a dedicated always-nameless fixture app
 * under `examples/` (a trap a future sweep eventually "fixes"), a count-only
 * assertion (vacuous the moment the count reaches zero), and simply accepting a
 * permanent 3-warning floor on the showcase build.
 *
 * ── The snapshot, and what "frozen" means ────────────────────────────────
 *
 * Taken at `694c350a636f1414c255b6d9f61998c93d38212c` from, and byte-comparable
 * against, these blobs:
 *
 *   examples/app-showcase/src/ui/views/task.view.ts        69290c1cd4495c532cc1e55bc5774a6859fa7a4d
 *   examples/app-showcase/src/ui/views/contact.view.ts     04ba8b5983353bae26f825320a755295656a2c79
 *   examples/app-showcase/src/data/objects/contact.object.ts  729aac0da295bf89d2b91acc232c5d42cd452f56
 *   examples/app-showcase/src/system/translations/index.ts  bc0d377b8eb7f58e187db18005e4e837aa03f778
 *
 * ⛔ This snapshot is NOT a mirror of the live app and must not be "re-synced"
 * with it. #8231's remainder will give the three sections below their names, at
 * which point the shipped app and this file DIVERGE ON PURPOSE: the shipped app
 * becomes clean, and this file keeps the pre-fix shape that the rule is tested
 * against. Naming the sections here instead would delete the coverage, which is
 * the whole thing #8515 was filed to prevent.
 *
 * ⛔ Equally: do not "fix" the three nameless sections in this file. They are
 * the specimen. (They are also structurally protected — every test that consumes
 * them asserts the finding it produces by identity, so naming one turns its test
 * red rather than silently green.)
 *
 * ── Fidelity: what was lifted, and what was left behind ──────────────────
 *
 * The containers and the object go through the SAME builders the shipped files
 * use — `defineView` / `ObjectSchema.create` parse their input through the spec's
 * Zod schemas, so what the rule walks here is the parsed shape, normalisations
 * and defaults included, exactly as it is for the real app. Their DATA is
 * verbatim; only the shipped files' explanatory prose was dropped (it explains
 * the showcase, not this rule), and the identifiers are prefixed `Snapshot…` so
 * a reader at the call site cannot mistake one for a live import.
 *
 * Two honest reductions, both in the translation bundle:
 *
 *   1. Only the `showcase_task` and `showcase_contact` object nodes are carried
 *      (verbatim, both locales). The bundle's other nodes — project, account,
 *      invoice, the semantic zoo, `globalActions`, `_tabs`-only blocks — name
 *      objects no container here declares, and the rule's opt-in gate is
 *      per-object (`objects.<name>` present in some bundle), so they cannot
 *      change any verdict about these two. Nothing else was reduced.
 *   2. The nodes' `_actions` / `_tabs` groups are kept verbatim although this
 *      fixture stack declares no actions or pages for them to resolve against.
 *      They are inert for `validateTranslatableSections`, which reads only which
 *      OBJECTS the bundle mentions. ⚠️ Feeding this bundle to
 *      `validateTranslationReferences` would therefore report them as unknown
 *      targets — true of the shipped bundle against a partial stack too, and the
 *      reason no test here does that.
 *
 * Nothing else failed to survive the lift. `Field.lookup('showcase_account')` on
 * the contact object still points at an object this stack does not declare —
 * that is unchanged from the live-import tests, which composed the same partial
 * stack (`objects: [Contact]`), and no assertion here reads it.
 */

import { defineView, P } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

const taskData = { provider: 'object' as const, object: 'showcase_task' };

/**
 * Snapshot of `examples/app-showcase/src/ui/views/task.view.ts`.
 *
 * The container names itself nowhere — it binds through `list.data.object`, which
 * is the rung that attaches every finding below to `showcase_task` and the reason
 * their `where` lines carry no `view "…"` part. Its five form views are the
 * specimen: `tabbed` / `wizard` / `split` name every section they declare, while
 * `edit` ("Task") and `quick` ("Quick Edit") name none. The thirteen `listViews`
 * are carried in full precisely because they declare NO sections — an exhaustive
 * assertion over this container's findings is only exhaustive if the list layer
 * that must stay silent is really present.
 */
export const SnapshotTaskViews = defineView({
  list: {
    label: 'All Tasks',
    type: 'grid',
    data: taskData,
    columns: [
      { field: 'title' },
      { field: 'project' },
      { field: 'assignee' },
      { field: 'status' },
      { field: 'priority' },
      { field: 'due_date' },
      { field: 'progress' },
    ],
    appearance: {
      allowedVisualizations: ['grid', 'kanban', 'gallery', 'calendar', 'timeline', 'gantt'],
    },
    kanban: { groupByField: 'status', summarizeField: 'estimate_hours', columns: ['title', 'assignee', 'priority'] },
    gallery: { coverField: 'cover', titleField: 'title', visibleFields: ['assignee', 'status', 'priority'] },
    calendar: { startDateField: 'due_date', titleField: 'title', colorField: 'status' },
    timeline: { startDateField: 'created_at', titleField: 'title', colorField: 'priority', scale: 'week' },
    gantt: { startDateField: 'start_date', endDateField: 'end_date', titleField: 'title', progressField: 'progress' },
  },

  listViews: {
    in_progress: {
      label: 'In Progress',
      type: 'grid',
      data: taskData,
      columns: [{ field: 'title' }, { field: 'project' }, { field: 'assignee' }, { field: 'status' }, { field: 'priority' }, { field: 'due_date' }],
      filter: [{ field: 'status', operator: 'equals', value: 'in_progress' }],
      exportOptions: { formats: ['csv', 'xlsx', 'json'] },
    },
    urgent: {
      label: 'Urgent',
      type: 'grid',
      data: taskData,
      columns: [{ field: 'title' }, { field: 'project' }, { field: 'assignee' }, { field: 'status' }, { field: 'priority' }, { field: 'due_date' }],
      filter: [{ field: 'priority', operator: 'equals', value: 'urgent' }],
      emptyState: {
        title: 'No urgent tasks',
        message: 'Nothing needs immediate attention right now. A task appears here as soon as its priority is raised to Urgent.',
      },
    },
    done: {
      label: 'Done',
      type: 'grid',
      data: taskData,
      columns: [{ field: 'title' }, { field: 'project' }, { field: 'assignee' }, { field: 'status' }, { field: 'due_date' }],
      filter: [{ field: 'status', operator: 'equals', value: 'done' }],
    },
    legacy_row_actions: {
      label: 'Legacy Row Actions',
      type: 'grid',
      data: taskData,
      columns: [{ field: 'title' }, { field: 'project' }, { field: 'assignee' }, { field: 'status' }],
      rowActions: ['showcase_recalc_estimate', 'showcase_quick_view'],
    },
    bulk_actions: {
      label: 'Bulk Actions',
      type: 'grid',
      data: taskData,
      columns: [
        { field: 'title' },
        { field: 'assignee' },
        { field: 'estimate_hours' },
        { field: 'progress' },
        { field: 'done' },
      ],
      bulkActions: ['showcase_mark_done', 'showcase_recalc_estimate'],
      bulkActionDefs: [
        { name: 'showcase_recalc_selection', operation: 'custom', execution: 'aggregate' },
      ],
    },
    tabular: {
      label: 'Task List',
      type: 'grid',
      data: taskData,
      columns: [
        { field: 'title' },
        { field: 'project' },
        { field: 'assignee' },
        { field: 'status' },
        { field: 'estimate_hours' },
      ],
      // The bare-string `sort` spelling (objectui#2601), kept as authored.
      sort: 'estimate_hours desc',
    },
    grid: {
      label: 'Grid',
      type: 'grid',
      data: taskData,
      columns: [
        { field: 'title' },
        { field: 'assignee' },
        { field: 'status' },
        { field: 'priority' },
        { field: 'estimate_hours' },
        { field: 'due_date' },
      ],
      rowColor: { field: 'priority' },
      inlineEdit: true,
    },
    board: {
      label: 'Board (Kanban)',
      type: 'kanban',
      data: taskData,
      columns: ['title', 'assignee', 'priority'],
      kanban: {
        groupByField: 'status',
        summarizeField: 'estimate_hours',
        columns: ['title', 'assignee', 'priority'],
      },
    },
    cards: {
      label: 'Cards (Gallery)',
      type: 'gallery',
      data: taskData,
      columns: ['title', 'assignee', 'status'],
      gallery: {
        coverField: 'cover',
        coverFit: 'cover',
        cardSize: 'medium',
        titleField: 'title',
        visibleFields: ['assignee', 'status', 'priority'],
      },
    },
    calendar: {
      label: 'Calendar',
      type: 'calendar',
      data: taskData,
      columns: ['title', 'assignee'],
      calendar: {
        startDateField: 'due_date',
        titleField: 'title',
        colorField: 'status',
      },
    },
    timeline: {
      label: 'Activity Timeline',
      type: 'timeline',
      data: taskData,
      columns: ['title'],
      timeline: {
        startDateField: 'created_at',
        titleField: 'title',
        colorField: 'priority',
        scale: 'week',
      },
    },
    gantt: {
      label: 'Schedule (Gantt)',
      type: 'gantt',
      data: taskData,
      columns: ['title', 'assignee'],
      gantt: {
        startDateField: 'start_date',
        endDateField: 'end_date',
        titleField: 'title',
        progressField: 'progress',
      },
    },
    map: {
      label: 'Work Locations (Map)',
      type: 'map',
      data: taskData,
      columns: ['title', 'location', 'assignee'],
    },
    chart: {
      label: 'Hours by Status (Chart)',
      type: 'chart',
      data: taskData,
      columns: ['status', 'estimate_hours'],
      chart: {
        chartType: 'bar',
        dataset: 'showcase_task_metrics',
        dimensions: ['status', 'priority'],
        values: ['est_hours'],
      },
    },
  },

  formViews: {
    // ⛔ SPECIMEN — `edit`'s single section declares a label and NO `name`.
    edit: {
      type: 'simple',
      data: taskData,
      sections: [
        {
          label: 'Task',
          columns: 2,
          fields: [
            { field: 'title', required: true },
            { field: 'project', required: true },
            { field: 'assignee' },
            { field: 'status', required: true },
            { field: 'priority' },
            { field: 'due_date' },
            { field: 'notes', visibleWhen: P`record.priority == 'urgent'`, span: 'full' },
          ],
        },
      ],
    },

    // The named siblings — the contrast that makes the two specimens legible:
    // one container, the same author, some sections addressable and some not.
    tabbed: {
      type: 'tabbed',
      data: taskData,
      sections: [
        { name: 'overview', label: 'Overview', columns: 2, fields: ['title', 'project', 'assignee', 'status'] },
        { name: 'schedule', label: 'Schedule', columns: 2, fields: ['start_date', 'end_date', 'due_date', 'progress'] },
        { name: 'details', label: 'Details', columns: 1, fields: ['estimate_hours', 'labels', 'location', 'notes'] },
      ],
    },

    wizard: {
      type: 'wizard',
      data: taskData,
      sections: [
        { name: 'step_basics', label: 'Basics', columns: 1, fields: ['title', 'project'] },
        { name: 'step_assign', label: 'Assignment', columns: 1, fields: ['assignee', 'priority'] },
        { name: 'step_schedule', label: 'Schedule', columns: 2, fields: ['start_date', 'end_date', 'due_date'] },
      ],
    },

    split: {
      type: 'split',
      data: taskData,
      sections: [
        { name: 'split_task', label: 'Task', pane: 'primary', columns: 1, fields: ['title', 'status', 'assignee'] },
        { name: 'split_schedule', label: 'Schedule', pane: 'secondary', columns: 1, fields: ['start_date', 'due_date', 'progress'] },
      ],
    },

    // ⛔ SPECIMEN — `quick`'s single section declares a label and NO `name`.
    quick: {
      type: 'drawer',
      data: taskData,
      sections: [{ label: 'Quick Edit', columns: 1, fields: ['status', 'priority', 'progress'] }],
    },
  },
});

const contactData = { provider: 'object' as const, object: 'showcase_contact' };

/** Snapshot of `examples/app-showcase/src/data/objects/contact.object.ts`. */
export const SnapshotContact = ObjectSchema.create({
  name: 'showcase_contact',
  label: 'Contact',
  pluralLabel: 'Contacts',
  icon: 'user',
  description:
    'Demonstrates derive-default + sparse-override forms: one flat, grouped, intent-tagged field set projects into both a full edit form and a slim create form (ADR-0047).',
  sharingModel: 'private',

  fields: {
    name: Field.text({ label: 'Full name', required: true, searchable: true, maxLength: 120, group: 'contact' }),
    email: Field.email({ label: 'Email', required: true, searchable: true, group: 'contact' }),
    phone: Field.text({ label: 'Phone', maxLength: 40, group: 'contact' }),

    company: Field.text({ label: 'Company', maxLength: 120, searchable: true, group: 'work' }),
    title: Field.text({ label: 'Job title', maxLength: 120, group: 'work' }),
    account: Field.lookup('showcase_account', { label: 'Account', group: 'work' }),

    stage: Field.select({
      label: 'Stage',
      group: 'status',
      options: [
        { label: 'New', value: 'new', default: true, color: '#3B82F6' },
        { label: 'Working', value: 'working', color: '#F59E0B' },
        { label: 'Qualified', value: 'qualified', color: '#10B981' },
        { label: 'Closed', value: 'closed', color: '#6B7280' },
      ],
    }),
    lead_score: Field.number({ label: 'Lead score', readonly: true, group: 'status', inlineHelpText: 'Computed by scoring rules — not user-editable.' }),

    notes: Field.text({ label: 'Notes', maxLength: 4000, group: 'notes' }),
  },

  // [ADR-0085 §5] The declaration side of the grouping edge — carried because it
  // is what authorises the derived layout the default form below writes by hand.
  fieldGroups: [
    { key: 'contact', label: 'Contact' },
    { key: 'work', label: 'Work' },
    { key: 'status', label: 'Status' },
    { key: 'notes', label: 'Notes' },
  ],
});

/**
 * Snapshot of `examples/app-showcase/src/ui/views/contact.view.ts`.
 *
 * The contrast this container carries in ONE file is the reason it was pinned:
 * the default `form` names all four of its sections (addressable, translatable,
 * and accepted by `validateTranslationReferences`), while the sparse
 * `formViews.create` override names none. One rule has to be silent about the
 * first and loud about the second.
 */
export const SnapshotContactViews = defineView({
  list: {
    label: 'Contacts',
    type: 'grid',
    data: contactData,
    columns: [
      { field: 'name' },
      { field: 'email' },
      { field: 'company' },
      { field: 'stage' },
    ],
    addRecord: { enabled: true, mode: 'form', formView: 'create' },
  },

  form: {
    type: 'simple',
    data: contactData,
    sections: [
      { name: 'contact', label: 'Contact', columns: 2, fields: ['name', 'email', 'phone'] },
      { name: 'work', label: 'Work', columns: 2, fields: ['company', 'title', 'account'] },
      { name: 'status', label: 'Status', columns: 2, fields: ['stage', 'lead_score'] },
      { name: 'notes', label: 'Notes', columns: 1, fields: ['notes'] },
    ],
  },

  formViews: {
    // ⛔ SPECIMEN — `create`'s single section declares a label and NO `name`.
    create: {
      type: 'simple',
      data: contactData,
      title: 'New contact',
      sections: [
        {
          label: 'Who is this?',
          columns: 1,
          fields: ['name', 'email', 'phone', 'company'],
        },
      ],
      submitBehavior: { kind: 'thank-you', title: 'Contact created', message: 'You can fill in the rest on the record.' },
    },
  },
});

/**
 * Snapshot of the `showcase_task` and `showcase_contact` nodes of
 * `examples/app-showcase/src/system/translations/index.ts`, both locales,
 * verbatim.
 *
 * This is the opt-in signal the rule gates on — and it is what makes the
 * specimens above worth reporting at all: every neighbouring label here
 * resolves in zh-CN, `_sections` carries the NAMED headings of the tabbed /
 * wizard / split forms and of the contact default form, and the three nameless
 * headings have no key they could ever appear under. That asymmetry is the
 * defect, and it is preserved rather than described.
 */
export const SnapshotTranslationBundle = {
  en: {
    objects: {
      showcase_task: {
        label: 'Task',
        pluralLabel: 'Tasks',
        fields: {
          title: { label: 'Title' },
          project: { label: 'Project' },
          assignee: { label: 'Assignee' },
          status: {
            label: 'Status',
            options: { backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress', in_review: 'In Review', done: 'Done' },
          },
          priority: {
            label: 'Priority',
            options: { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' },
          },
          due_date: { label: 'Due Date' },
          progress: { label: 'Progress' },
          estimate_hours: { label: 'Estimate (h)' },
          done: { label: 'Done' },
          start_date: { label: 'Start Date' },
          end_date: { label: 'End Date' },
          created_at: { label: 'Created' },
          location: { label: 'Work Location' },
          cover: { label: 'Cover' },
          labels: { label: 'Labels' },
          notes: { label: 'Notes' },
          sync_status: {
            label: 'Sync Status',
            options: { synced: 'Synced', failed: 'Failed' },
          },
          sync_error: { label: 'Sync Error' },
        },
        _views: {
          urgent: {
            emptyState: {
              title: 'No urgent tasks',
              message: 'Nothing needs immediate attention right now. A task appears here as soon as its priority is raised to Urgent.',
            },
          },
        },
      },
      showcase_contact: {
        label: 'Contact',
        pluralLabel: 'Contacts',
        fields: {
          name: { label: 'Full name' },
          email: { label: 'Email' },
          phone: { label: 'Phone' },
          company: { label: 'Company' },
          title: { label: 'Job title' },
          account: { label: 'Account' },
          stage: { label: 'Stage' },
          lead_score: { label: 'Lead score' },
          notes: { label: 'Notes' },
        },
      },
    },
  },
  'zh-CN': {
    objects: {
      showcase_task: {
        label: '任务',
        pluralLabel: '任务',
        fields: {
          title: { label: '标题' },
          project: { label: '项目' },
          assignee: { label: '负责人' },
          status: {
            label: '状态',
            options: { backlog: '待规划', todo: '待办', in_progress: '进行中', in_review: '评审中', done: '已完成' },
          },
          priority: {
            label: '优先级',
            options: { low: '低', medium: '中', high: '高', urgent: '紧急' },
          },
          due_date: { label: '截止日期' },
          progress: { label: '进度' },
          estimate_hours: { label: '预计工时' },
          done: { label: '已完成' },
          start_date: { label: '开始日期' },
          end_date: { label: '结束日期' },
          created_at: { label: '创建时间' },
          location: { label: '工作地点' },
          cover: { label: '封面' },
          labels: { label: '标签' },
          notes: { label: '备注' },
          sync_status: {
            label: '同步状态',
            options: { synced: '已同步', failed: '同步失败' },
          },
          sync_error: { label: '同步错误' },
        },
        _views: {
          default: { label: '全部任务' },
          in_progress: { label: '进行中' },
          urgent: {
            label: '紧急',
            emptyState: {
              title: '暂无紧急任务',
              message: '当前没有需要立即处理的事项。任务优先级调整为「紧急」后会出现在这里。',
            },
          },
          done: { label: '已完成' },
          tabular: { label: '任务清单' },
          grid: { label: '表格' },
          board: { label: '看板' },
          cards: { label: '卡片' },
          calendar: { label: '日历' },
          timeline: { label: '活动时间线' },
          gantt: { label: '甘特图' },
          map: { label: '工作地点地图' },
          chart: { label: '工时按状态分布' },
          legacy_row_actions: { label: '旧式行操作' },
          bulk_actions: { label: '批量操作' },
        },
        _actions: {
          showcase_recalc_estimate: {
            label: '重算工时',
            successMessage: '工时已重算。',
          },
          showcase_recalc_selection: {
            label: '重算所选',
            successMessage: '已为整个选中集重算工时。',
          },
        },
        // The NAMED headings of the tabbed / wizard / split forms — and nothing
        // for `edit` or `quick`, because a nameless section has no key.
        _sections: {
          overview: { label: '概览' },
          schedule: { label: '排期' },
          details: { label: '详细信息' },
          step_basics: { label: '基本信息' },
          step_assign: { label: '指派' },
          step_schedule: { label: '排期' },
          split_task: { label: '任务' },
          split_schedule: { label: '排期' },
        },
        _tabs: {
          in_progress: { label: '进行中' },
          urgent: { label: '紧急' },
          in_review: { label: '评审中' },
          done: { label: '已完成' },
        },
      },
      showcase_contact: {
        label: '联系人',
        pluralLabel: '联系人',
        fields: {
          name: { label: '姓名' },
          email: { label: '邮箱' },
          phone: { label: '电话' },
          company: { label: '公司' },
          title: { label: '职务' },
          account: { label: '客户' },
          stage: { label: '阶段' },
          lead_score: { label: '线索评分' },
          notes: { label: '备注' },
        },
        _views: {
          default: { label: '联系人' },
        },
        // The four NAMED headings of the default form — and nothing for
        // `formViews.create`'s "Who is this?", which has no name to key on.
        _sections: {
          contact: { label: '联系方式' },
          work: { label: '工作信息' },
          status: { label: '状态' },
          notes: { label: '备注' },
        },
      },
    },
  },
};

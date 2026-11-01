// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * English + Simplified Chinese labels for the core showcase objects — and for
 * the app shell those objects are read in.
 *
 * Covers EVERY field surfaced as a column on the showcase pages so a list never
 * mixes locales (the prior bundle translated only a handful, leaving columns
 * like Project / Assignee / Progress falling back to their English field label
 * next to translated 状态 / 优先级 — an obvious inconsistency on a zh-CN session).
 *
 * The `apps.showcase_app` block carries the sidebar — navigation items and
 * group headers — for that same reason one level up: the columns were
 * translated under an English menu, and the sentence above, scoped to columns,
 * is exactly why nothing caught it. This is a description of what this file
 * CONTAINS, not a wider guarantee: it does not claim every declared surface of
 * the showcase is translated. `scripts/i18n-coverage-baseline.json` is the
 * measure of what still is not.
 */
export const ShowcaseTranslationBundle = {
  en: {
    objects: {
      showcase_project: {
        label: 'Project',
        pluralLabel: 'Projects',
        fields: {
          name: { label: 'Project Name' },
          account: { label: 'Account' },
          owner: { label: 'Owner Email' },
          status: { label: 'Status' },
          health: { label: 'Health' },
          budget: { label: 'Budget' },
          spent: { label: 'Spent' },
          start_date: { label: 'Start Date' },
          end_date: { label: 'End Date' },
        },
        // An author-written `validations[].message` is emitted VERBATIM unless
        // the bundle carries it here (#14253) — the built-in field catalog's
        // own sentences have shipped zh-CN since #3957, so a rule that declares
        // its own message is the one way a refusal escapes the caller's
        // language. `project_status_flow` is the showcase's state machine and
        // the only refusal a visitor reliably triggers (the New Project wizard
        // used to offer four statuses the machine will not accept on create),
        // so it read as the single English sentence on a zh-CN form.
        // All FOUR of the object's rules, not just the state machines: the New
        // Project wizard can trip `end_after_start` and `spent_within_budget`
        // from its budget/schedule step, so translating only the status rule
        // would move the single English sentence one step later rather than
        // remove it.
        _validations: {
          project_status_flow: {
            message: 'Projects start as Planned, and then move only along the declared status flow.',
          },
          project_health_progression: {
            message: 'Health changed by more than one step — confirm this is intentional.',
          },
          end_after_start: {
            message: 'Target End Date must be on or after the Start Date.',
          },
          spent_within_budget: {
            message: 'Spend exceeds 120% of budget — escalate before continuing.',
          },
        },
      },
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
        // The object's ONE authored rule message, on the #14253 channel for the
        // same reason `showcase_project`'s four are (see the note there). The
        // `en` entry is the authored sentence VERBATIM: the bundle WINS over
        // `rule.message` in every locale, so a bundle entry that has drifted
        // from the object turns the object's own sentence into dead text no
        // reader ever sees. The pin asserts that equality rather than trusting it.
        _validations: {
          task_status_flow: {
            message: 'Invalid task status transition.',
          },
        },
        // The FIRST `_views` block on the `en` side of this bundle, and
        // deliberately not a mirror of the zh-CN one below: view LABELS are
        // already English in `ui/views/task.view.ts`, so restating all fifteen
        // here would be fifteen fake translations of the kind this bundle's
        // header warns about. What earns an entry is the `emptyState` fixture
        // (#7714): the surface-matrix check wants the SAME key resolving to
        // different copy per locale, and a key present only in zh-CN cannot
        // show that — an en session would be reading the view's inline source
        // string through the fallback path, which is a different code path and
        // proves nothing about the resolver. So this pins the en arm of that
        // one key group, and nothing else.
        _views: {
          urgent: {
            emptyState: {
              title: 'No urgent tasks',
              message: 'Nothing needs immediate attention right now. A task appears here as soon as its priority is raised to Urgent.',
            },
          },
        },
      },
      showcase_account: {
        label: 'Account',
        pluralLabel: 'Accounts',
        fields: {
          name: { label: 'Account Name' },
          industry: { label: 'Industry' },
          annual_revenue: { label: 'Annual Revenue' },
          website: { label: 'Website' },
          hq: { label: 'Headquarters' },
          status: { label: 'Lifecycle' },
          tax_id: { label: 'Tax ID' },
          billing_email: { label: 'Billing Email' },
          support_config: { label: 'Support Config' },
          churn_reason: { label: 'Churn Reason' },
        },
        // An author-written `validations[].message` is emitted VERBATIM unless
        // the bundle carries it here (#14253) — see the note on
        // `showcase_project` above. All SEVEN names this object declares, and
        // the two NESTED ones are the point: `checkConditional` dispatches to
        // the matching branch and renders that BRANCH's message, addressed by
        // the branch's own `name`, so `churn_reason_consistency`'s own sentence
        // is structurally unreachable and translating only it would leave both
        // refusals a caller can actually see in English. Its entry is here
        // anyway so the bundle mirrors the DECLARED rule set 1:1 — the pin in
        // `test/new-project-wizard-initial-status.test.ts` asks for every
        // declared name rather than re-deriving objectql's dispatch.
        _validations: {
          account_lifecycle: {
            message: 'Invalid account lifecycle transition.',
          },
          tax_id_format: {
            message: 'Tax ID must look like 12-3456789.',
          },
          billing_email_format: {
            message: 'Billing Email must be a valid email address.',
          },
          support_config_shape: {
            message: 'Support Config must be { tier: standard|premium|enterprise, seats?: >=1 }.',
          },
          churn_reason_consistency: {
            message: 'Churn reason consistency.',
          },
          churn_reason_present: {
            message: 'A churn reason is required when an account is marked churned.',
          },
          churn_reason_absent: {
            message: 'A churn reason should only be set when the account is churned.',
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
      // [#9308 fixture 2] The share-link object. Translated on BOTH sides at
      // once, key for key: `check-i18n-coverage` is a two-sided ratchet, so an
      // `en` entry landing without its zh-CN mirror is what WIDENS the gap
      // rather than closing it. Every string the object declares is here —
      // label, pluralLabel, description, all seven field labels and both
      // `status` options — which is what returns the count to its baseline
      // instead of merely stopping its growth.
      showcase_client_brief: {
        label: 'Client Brief',
        pluralLabel: 'Client Briefs',
        // Byte-for-byte the string the object DECLARES. A bundle entry
        // overrides the schema label for its locale, so a "tidied" English
        // description here would silently rewrite the product copy under the
        // guise of translating it — the en side's job is to mirror, not edit.
        description:
          'A client-facing project brief published by opaque share link — the showcase\'s `publicSharing` demonstration (ADR-0047).',
        fields: {
          title: { label: 'Title' },
          summary: { label: 'Client Summary' },
          project: { label: 'Project' },
          status: {
            label: 'Status',
            options: { draft: 'Draft', published: 'Published' },
          },
          internal_notes: { label: 'Internal Notes' },
          deal_value: { label: 'Deal Value' },
          owner_id: { label: 'Owner' },
        },
      },
      showcase_invoice: {
        label: 'Invoice',
        pluralLabel: 'Invoices',
        fields: {
          name: { label: 'Invoice Number' },
          account: { label: 'Account' },
          contact: { label: 'Contact' },
          owner: { label: 'Owner Email' },
          status: { label: 'Status' },
          issued_on: { label: 'Issued On' },
          tax_rate: { label: 'Tax Rate (%)' },
          paid_on: { label: 'Paid On' },
          total: { label: 'Total' },
        },
        // `ui/pages/invoice-document.page.ts` `record:details` sections — the
        // invoice print page's headings.
        _sections: {
          invoice: { label: 'Invoice' },
          amounts: { label: 'Amounts' },
        },
        // The object's ONE authored rule message, on the #14253 channel. The
        // `en` entry is the authored sentence VERBATIM — the bundle WINS over
        // `rule.message` in every locale, so a drifted entry would turn the
        // object's own sentence into dead text no reader ever sees.
        _validations: {
          no_invoice_for_churned_account: {
            message: 'This account has churned — reactivate it before invoicing.',
          },
        },
      },
      // Translated at birth, like `globalActions` below and for the same
      // reason: `incurred_at` is a NEW declared label (objectui#3569's inline-
      // grid datetime fixture), and check-i18n-coverage freezes this example at
      // its current untranslated count — a new label that skips zh-CN widens
      // the debt and fails the ratchet.
      //
      // DELIBERATELY only this one field. The rest of the expense family
      // (object labels, `incurred_on`, `merchant`, …) predates the ratchet and
      // is part of the frozen baseline; translating it here too would push the
      // count BELOW the baseline, which the same gate rejects as an
      // un-ratcheted improvement. Paying that debt down is its own change.
      showcase_expense_line: {
        fields: {
          incurred_at: { label: 'Incurred At' },
        },
      },
      // Same rule, same reason as `showcase_expense_line` above: `service_start`
      // is a NEW declared label (objectui#3569's inline-grid TIME fixture), so
      // it must be translated at birth or check-i18n-coverage sees the example's
      // untranslated count grow and fails. And DELIBERATELY only this one field
      // — `product`, `description`, `quantity`, `unit_price`, `receipt` and
      // `amount` predate the ratchet and are part of the frozen baseline;
      // translating them here would push the count BELOW the baseline, which the
      // same gate rejects as an un-ratcheted improvement.
      showcase_invoice_line: {
        fields: {
          service_start: { label: 'Service Start' },
        },
      },
      showcase_preference: {
        label: 'Setting',
        pluralLabel: 'Settings',
        fields: {
          name: { label: 'Name' },
          theme: { label: 'Theme' },
          default_landing: { label: 'Default Landing Page' },
          email_digest: { label: 'Email Digest' },
          items_per_page: { label: 'Rows per Page' },
          notifications_enabled: { label: 'Enable Notifications' },
          compact_density: { label: 'Compact Density' },
        },
      },
      showcase_product: {
        label: 'Product', pluralLabel: 'Products',
        fields: { name: { label: 'Name' }, sku: { label: 'SKU' }, description: { label: 'Description' }, unit_price: { label: 'Unit Price' }, active: { label: 'Active' } },
      },
      showcase_team: {
        label: 'Team', pluralLabel: 'Teams',
        fields: { name: { label: 'Team Name' }, lead: { label: 'Lead' }, capacity_hours: { label: 'Capacity (h)' } },
      },
      showcase_project_membership: {
        label: 'Membership', pluralLabel: 'Memberships',
        fields: { team: { label: 'Team' }, project: { label: 'Project' }, engagement: { label: 'Engagement' }, allocation_percent: { label: 'Allocation %' } },
      },
      showcase_category: {
        label: 'Category', pluralLabel: 'Categories',
        fields: { name: { label: 'Name' }, parent: { label: 'Parent' }, color: { label: 'Color' }, sort_order: { label: 'Sort Order' } },
      },
      showcase_field_zoo: {
        label: 'Field Zoo', pluralLabel: 'Field Zoo',
      },
    },
    // The OBJECT-LESS action slot (framework#3913). `globalActions` is the only
    // place the resolver looks for an action that declares no `objectName` —
    // keys for such an action under `objects.*._actions` are never read. Before
    // `showcase_portfolio_snapshot` the showcase had no object-less action, so
    // this slot had no specimen anywhere in the repo.
    globalActions: {
      showcase_portfolio_snapshot: {
        label: 'Portfolio Snapshot',
        successMessage: 'Portfolio snapshot taken.',
      },
    },
    // Translated at birth for the same reason as `globalActions` above: this
    // example is ratcheted at its current untranslated count, so a declared
    // label that skips zh-CN widens the debt and fails check-i18n-coverage.
    // The gallery's other widget titles predate that ratchet and remain part of
    // the frozen baseline. objectui#2945.
    dashboards: {
      showcase_chart_gallery: {
        widgets: {
          combo_count_vs_progress: { title: 'Task Count vs Avg Progress' },
        },
      },
      showcase_revenue_pulse: {
        widgets: {
          kpi_paid_rate: { title: 'Paid Rate' },
          table_rate_by_status: { title: 'Paid Rate by Status' },
        },
        // The filter bar drawn above the widgets — declared surface since
        // `dashboards.<name>.globalFilters` (#16772), keyed by the filter's
        // `name`; static options keyed by their `value`.
        globalFilters: {
          region: { label: 'Region', options: { amer: 'AMER', emea: 'EMEA', apac: 'APAC' } },
        },
      },
      showcase_ops_dashboard: {
        globalFilters: {
          task_status: {
            label: 'Task Status',
            options: { backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress', in_review: 'In Review', done: 'Done' },
          },
        },
      },
    },
    // Translated at birth, same rule as the widgets above: the done rate moved
    // here from the delivery cube (#20943) as two new dataset measures, born
    // under the ratchet. The task dataset's older labels predate it and stay in
    // the frozen baseline.
    datasets: {
      showcase_task_metrics: {
        measures: {
          done_count: { label: 'Done Tasks' },
          done_rate: { label: 'Done Rate' },
        },
      },
    },
  },
  'zh-CN': {
    objects: {
      showcase_project: {
        label: '项目',
        pluralLabel: '项目',
        description: '为某个客户交付的项目。',
        // Every field the project grid and record surface as a column, and
        // every option a status / health / labels cell renders — the grid
        // that shows 进行中 for a task must not show "Active" for a project.
        // `planned` reads 计划中 because `_validations.project_status_flow`
        // below already says so; `active` reads 进行中 for the same reason
        // `apps…nav_active_projects` does. `task_count` is a count column,
        // hence 任务数; `total_estimate` reuses showcase_task's 预计工时.
        fields: {
          name: { label: '项目名称' },
          account: { label: '客户' },
          owner: { label: '负责人邮箱' },
          status: {
            label: '状态',
            options: { planned: '计划中', active: '进行中', on_hold: '已暂停', completed: '已完成', cancelled: '已取消' },
          },
          health: {
            label: '健康度',
            options: { green: '绿色', yellow: '黄色', red: '红色' },
          },
          budget: { label: '预算' },
          spent: { label: '已花费' },
          budget_remaining: { label: '剩余预算' },
          start_date: { label: '开始日期' },
          end_date: { label: '结束日期' },
          labels: {
            label: '标签',
            options: { frontend: '前端', backend: '后端', design: '设计', qa: '测试', devops: '运维' },
          },
          team_members: { label: '团队成员' },
          task_count: { label: '任务数' },
          total_estimate: { label: '总预计工时' },
        },
        // The zh-CN mirror of the `en` `_validations` block — see the note
        // there. Without these two keys the write path's own refusals arrive in
        // Chinese (built-in catalog, #3957) while these author-written ones
        // arrive in English, inside one error envelope.
        _validations: {
          project_status_flow: { message: '项目的初始状态为“计划中”,此后只能按既定的状态流转变更。' },
          project_health_progression: { message: '健康度一次变更超过一级,请确认这是有意为之。' },
          end_after_start: { message: '结束日期不能早于开始日期。' },
          spent_within_budget: { message: '已花费超过预算的 120%,请先上报后再继续。' },
        },
        // `default` — the container's DEFAULT list. `defineView({ list })`
        // declares it without a `name`, and the composer therefore registers it
        // as `<object>.default`; `_views` keys are that bare runtime key
        // (#5164, ruled 2026-08-06). It read `list` until then, which no
        // lookup could ever reach.
        _views: {
          default: { label: '全部项目' },
          by_status: { label: '按状态' },
          budget_chart: { label: '按客户预算' },
        },
        // Section headings from two surfaces: `ui/views/project.view.ts`'s
        // `edit` form (`project` / `budget_schedule`) and
        // `ui/pages/project-detail.page.ts`'s `record:details` tab
        // (`overview` / `financials` / `timeline`). Each declares a stable
        // `name`, the only thing that makes the heading translatable
        // (#8231). Wording reuses vocabulary this bundle already established
        // elsewhere: `预算` (fields.budget above), `排期` (showcase_task
        // `_sections.schedule` below), `概览` (showcase_task
        // `_sections.overview`), `财务信息` (showcase_semantic_zoo
        // `_sections.money`), `时间线` (showcase_task `_views.timeline`,
        // "活动时间线").
        _sections: {
          project: { label: '项目' },
          budget_schedule: { label: '预算与排期' },
          overview: { label: '概览' },
          financials: { label: '财务信息' },
          timeline: { label: '时间线' },
        },
      },
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
        // 状态 is the field label above and 状态流转 the same idea
        // `showcase_project`'s entry uses — one word per idea across the bundle.
        _validations: {
          task_status_flow: { message: '任务状态流转无效。' },
        },
        _views: {
          // The default list — keyed `default`, see showcase_project above.
          default: { label: '全部任务' },
          in_progress: { label: '进行中' },
          urgent: {
            label: '紧急',
            // The showcase's only `emptyState` specimen (#7714) — the view is
            // authored with one in `ui/views/task.view.ts`, so this is the
            // locale half of that fixture. Two new source labels enter the
            // extractor's expected set here; both are translated in the same
            // change, which is what keeps check:i18n-coverage's frozen
            // untranslated count for this example unmoved in either direction.
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
          // The two recalc surfaces of the same endpoint: one dispatch per
          // record vs ONE dispatch for the whole selection (objectui#3139).
          //
          // Each success message names the task it changed, as its English
          // source does (`src/ui/actions/index.ts`): this entry REPLACES the
          // source copy for a zh-CN viewer, and the runner fills its
          // `{{ record.title }}` hole the same way. An unbound path prints
          // empty, so `default` restores the object wording for a list row
          // whose view does not project `title`.
          showcase_recalc_estimate: {
            label: '重算工时',
            successMessage: "已重算{{ record.title | default:'该任务' }}的工时。",
          },
          showcase_recalc_selection: {
            label: '重算所选',
            successMessage: "已为{{ record.title | default:'整个选中集' }}重算工时。",
          },
          // The hook-refusal specimen: every click is refused by
          // showcase_guard_task_reopen, so it carries no successMessage.
          showcase_reopen_task: { label: '重新打开' },
          // The rest of the task's row / toolbar / bulk actions, so a row menu
          // never lists 重算工时 beside an English "Mark Done". 工时 is the
          // word the recalc entries above use; 重新分配 is the reassign
          // wizard's own flow label (`flows.showcase_reassign_wizard`); 新建…
          // is the shape a create entry takes in this bundle.
          showcase_mark_done: { label: '标记为完成', successMessage: "{{ record.title | default:'任务' }}已标记为完成。" },
          showcase_open_docs: { label: '打开文档' },
          showcase_bulk_reassign: { label: '重新分配…' },
          showcase_quick_view: { label: '快速查看' },
          showcase_log_time: { label: '记录工时' },
          showcase_new_task: { label: '新建任务' },
          showcase_archive_task: {
            label: '归档',
            successMessage: "{{ record.title | default:'任务' }}已归档（演示——未修改任何数据）。",
            disabledReason: '请先将任务标记为完成。',
          },
        },
        // Section headings of the six form-view projections in
        // `ui/views/task.view.ts` (edit / tabbed / wizard / split / quick).
        // Each section there declares a stable `name`, which is the only
        // thing that makes the heading translatable — `ObjectForm` looks it
        // up as `objects.showcase_task._sections.<name>.label` and otherwise
        // renders the English `label` verbatim. Wording follows the
        // vocabulary the rest of this bundle already uses (任务 / 负责人 /
        // 进度), rather than introducing a second word per idea.
        _sections: {
          // edit (#8231 remainder)
          task: { label: '任务信息' },
          // tabbed
          overview: { label: '概览' },
          schedule: { label: '排期' },
          details: { label: '详细信息' },
          // wizard steps
          step_basics: { label: '基本信息' },
          step_assign: { label: '指派' },
          step_schedule: { label: '排期' },
          // the `split` form view (tabbed since ADR-0050 made `type` a layout)
          split_task: { label: '任务' },
          split_schedule: { label: '排期' },
          // quick (#8231 remainder)
          quick_edit: { label: '快速编辑' },
        },
        // The filter-preset tab bar of `ui/pages/task-triage.page.ts` — four
        // tabs carrying a `filter` and no `view`, which is the shape that had
        // no translation slot at all until `_tabs` landed (#5377). Born
        // translated rather than ratcheted into the baseline as new debt.
        //
        // Wording is the vocabulary this bundle already uses for the same
        // ideas: each tab filters on a `status` / `priority` value whose option
        // label is right above, so the tab reads the same word as the cell it
        // filters by.
        _tabs: {
          in_progress: { label: '进行中' },
          urgent: { label: '紧急' },
          in_review: { label: '评审中' },
          done: { label: '已完成' },
        },
      },
      showcase_account: {
        label: '客户',
        pluralLabel: '客户',
        fields: {
          name: { label: '客户名称' },
          industry: { label: '行业' },
          annual_revenue: { label: '年收入' },
          website: { label: '网站' },
          hq: { label: '总部' },
          status: { label: '生命周期' },
          tax_id: { label: '税号' },
          billing_email: { label: '账单邮箱' },
          support_config: { label: '支持配置' },
          churn_reason: { label: '流失原因' },
        },
        // The zh-CN mirror of the `en` `_validations` block — see the note
        // there. Vocabulary is the one this bundle already established:
        // 生命周期 / 税号 / 账单邮箱 / 支持配置 / 流失原因 are the field labels
        // right above, so a refusal names the field with the same word the form
        // does. The `support_config_shape` shape stays in its source spelling —
        // it is a machine contract the author must type back, not prose.
        _validations: {
          account_lifecycle: { message: '客户生命周期的状态流转无效。' },
          tax_id_format: { message: '税号格式应为 12-3456789。' },
          billing_email_format: { message: '账单邮箱必须是有效的邮箱地址。' },
          support_config_shape: { message: '支持配置必须为 { tier: standard|premium|enterprise, seats?: >=1 }。' },
          churn_reason_consistency: { message: '流失原因一致性。' },
          churn_reason_present: { message: '客户标记为流失时必须填写流失原因。' },
          churn_reason_absent: { message: '只有客户已流失时才能填写流失原因。' },
        },
      },
      showcase_contact: {
        label: '联系人',
        pluralLabel: '联系人',
        // The list header renders the object's description, so leaving it out
        // put one English sentence above an otherwise translated grid. The
        // ADR reference is kept, as `showcase_client_brief.description` keeps
        // its own.
        description:
          '演示「默认推导 + 稀疏覆盖」表单：一套扁平、分组、带意图标记的字段集，同时投影为完整的编辑表单和精简的新建表单（ADR-0047）。',
        fields: {
          name: { label: '姓名' },
          email: { label: '邮箱' },
          phone: { label: '电话' },
          company: { label: '公司' },
          title: { label: '职务' },
          account: { label: '客户' },
          stage: {
            label: '阶段',
            options: { new: '新建', working: '跟进中', qualified: '合格', closed: '已关闭' },
          },
          lead_score: { label: '线索评分', help: '由评分规则计算,不可手动编辑。' },
          notes: { label: '备注' },
        },
        // #5420 — `ContactViews` had never been listed in the config's `views:`
        // array, so nothing (runtime or gate) could reach these two surfaces.
        // Registering the container is what makes them translatable at all.
        //
        // `_views.default` — the container's DEFAULT list. It is declared
        // without a `name`, so the composer registers it as
        // `showcase_contact.default` and the bundle key is that bare runtime
        // key (#5164, ruled 2026-08-06); it read `list` until then, a spelling
        // no lookup could reach. Its source label is the bare plural
        // "Contacts", so the object's own `pluralLabel` above is the right
        // word; the `全部…` spelling the task/project lists use belongs to
        // labels that actually say "All …".
        //
        // `_views.create.title` — the sparse `formViews.create` form's own
        // heading (`title: 'New contact'`), which `translateView` overlays
        // onto the served form's `config.title`. 新建联系人 follows the
        // 新建… shape a create heading takes. Its `submitBehavior` is the
        // thank-you panel the same form shows after a save, overlaid onto the
        // served form's `config.submitBehavior`.
        _views: {
          default: { label: '联系人' },
          create: {
            title: '新建联系人',
            submitBehavior: { title: '联系人已创建', message: '其余信息可在记录中补充。' },
          },
        },
        // `_sections` — the four groups of the default edit form in
        // `ui/views/contact.view.ts`, plus the sparse `formViews.create`
        // override's single section (#8231 remainder). Each declares a
        // stable `name`, which is the only reason the heading is
        // translatable (`ObjectForm` looks it up as
        // `objects.showcase_contact._sections.<name>.label` and otherwise
        // renders the English `label` verbatim). Wording reuses the vocabulary
        // this bundle already established — 状态 and 备注 are exactly the words
        // its `stage`-family and `notes` entries use — rather than minting a
        // second term per idea. `contact` reads 联系方式 (contact DETAILS, its
        // fields being 姓名/邮箱/电话) instead of a circular 联系人 heading
        // inside a contact record; `work` follows the `…信息` shape the
        // showcase_semantic_zoo headings set. `who_is_this` is the create
        // form's own heading — a plain rendering of the English question,
        // matching the no-punctuation style every other heading in this file
        // uses.
        _sections: {
          contact: { label: '联系方式' },
          work: { label: '工作信息' },
          status: { label: '状态' },
          notes: { label: '备注' },
          who_is_this: { label: '这是谁' },
        },
      },
      // [#9308 fixture 2] The zh-CN mirror of the `en` block above, key for
      // key. Renderings follow the ones this bundle already established rather
      // than being coined fresh: 标题 / 项目 / 状态 / 备注 / 负责人 are the words
      // showcase_task and showcase_invoice already use for the same concepts,
      // which is the whole point of the file — a list must not mix a translated
      // 状态 with an English Owner next to it.
      showcase_client_brief: {
        label: '客户简报',
        // Chinese does not inflect for number, so the plural is the same word —
        // the same shape 客户 / 客户 and 联系人 / 联系人 already take here.
        pluralLabel: '客户简报',
        // A faithful rendering of the SAME sentence the en side carries,
        // including the ADR reference — dropping half of it in translation is
        // the locale degradation this bundle exists to prevent.
        description:
          '面向客户的项目简报，通过不透明的分享链接对外发布——本示例应用对 `publicSharing` 的演示（ADR-0047）。',
        fields: {
          title: { label: '标题' },
          summary: { label: '客户摘要' },
          project: { label: '项目' },
          status: {
            label: '状态',
            // 已发布 follows the 已完成 pattern this bundle uses for a state
            // that has been reached, rather than the bare verb 发布.
            options: { draft: '草稿', published: '已发布' },
          },
          internal_notes: { label: '内部备注' },
          deal_value: { label: '交易金额' },
          owner_id: { label: '负责人' },
        },
      },
      showcase_invoice: {
        label: '发票',
        pluralLabel: '发票',
        fields: {
          name: { label: '发票号' },
          account: { label: '客户' },
          contact: { label: '联系人' },
          owner: { label: '负责人邮箱' },
          status: { label: '状态' },
          issued_on: { label: '开具日期' },
          tax_rate: { label: '税率 (%)' },
          paid_on: { label: '付款日期' },
          total: { label: '合计' },
        },
        _sections: {
          invoice: { label: '发票' },
          amounts: { label: '金额' },
        },
        // The zh-CN mirror of the `en` `_validations` block above.
        _validations: {
          no_invoice_for_churned_account: {
            message: '该客户已流失 —— 请先将其恢复为活跃状态,然后再开具发票。',
          },
        },
        // Translated at birth: this example is ratcheted at its untranslated
        // count, so a declared action label that skips zh-CN fails
        // check-i18n-coverage.
        _actions: {
          showcase_generate_invoice_pdf: {
            label: '生成 PDF',
            successMessage: 'PDF 已附加到发票。',
          },
        },
      },
      // The expense report list is a sidebar entry (`nav_expense_reports`,
      // 报销单), so its object label, description, every column and every
      // status option are translated here — the sidebar's word and the list's
      // header now agree. 草稿 / 已提交 / 已批准 follow the 已… shape this
      // bundle uses for a reached state; 合计 is showcase_invoice's `total`.
      showcase_expense_report: {
        label: '报销单',
        pluralLabel: '报销单',
        description: '报销单的汇总金额由其明细行按条件汇总而来。',
        fields: {
          name: { label: '报销单标题' },
          employee: { label: '员工' },
          status: {
            label: '状态',
            options: { draft: '草稿', submitted: '已提交', approved: '已批准', reimbursed: '已报销' },
          },
          submitted_on: { label: '提交日期' },
          total_amount: { label: '合计' },
          approved_amount: { label: '已批准金额' },
          reimbursable_amount: { label: '可报销金额' },
          line_count: { label: '明细行数' },
          rejected_count: { label: '已驳回行数' },
          over_limit_count: { label: '超过 $500' },
        },
      },
      // See the `en` side for why this entry translates exactly ONE field and
      // no more (check-i18n-coverage is a two-sided ratchet). The line's other
      // labels are still in the baseline: only the report list is a first
      // screen.
      showcase_expense_line: {
        fields: {
          incurred_at: { label: '发生时间' },
          // The inline grid heading on the expense report's form — a key born
          // with its slot, so it is translated at birth like the label above.
          expense_report: { inlineTitle: '费用明细' },
        },
      },
      // See the `en` side for why this entry translates exactly ONE field and
      // no more (check-i18n-coverage is a two-sided ratchet).
      showcase_invoice_line: {
        fields: {
          service_start: { label: '服务开始时间' },
          // The inline grid heading on the invoice form, translated at birth.
          invoice: { inlineTitle: '发票明细' },
        },
      },
      showcase_preference: {
        label: '设置',
        pluralLabel: '设置',
        fields: {
          name: { label: '名称' },
          theme: { label: '主题' },
          default_landing: { label: '默认着陆页' },
          email_digest: { label: '邮件摘要' },
          items_per_page: { label: '每页行数' },
          notifications_enabled: { label: '启用通知' },
          compact_density: { label: '紧凑密度' },
        },
        // `ui/pages/settings.page.ts` `record:details` sections. Each
        // declares a stable `name`, the only thing that makes the heading
        // translatable (#8231). `通知` reuses `fields.notifications_enabled`
        // ("启用通知") above.
        _sections: {
          appearance: { label: '外观' },
          notifications: { label: '通知' },
        },
      },
      showcase_product: {
        label: '产品', pluralLabel: '产品',
        fields: { name: { label: '名称' }, sku: { label: 'SKU' }, description: { label: '描述' }, unit_price: { label: '单价' }, active: { label: '启用' } },
      },
      showcase_team: {
        label: '团队', pluralLabel: '团队',
        fields: { name: { label: '团队名称' }, lead: { label: '负责人' }, capacity_hours: { label: '产能(小时)' } },
      },
      showcase_project_membership: {
        label: '成员', pluralLabel: '成员',
        fields: { team: { label: '团队' }, project: { label: '项目' }, engagement: { label: '协作职能' }, allocation_percent: { label: '分配比例' } },
      },
      showcase_category: {
        label: '分类', pluralLabel: '分类',
        fields: { name: { label: '名称' }, parent: { label: '上级' }, color: { label: '颜色' }, sort_order: { label: '排序' } },
      },
      // `_views` only: this object has no zh-CN block of its own, and its
      // object/field debt is inside the ratchet's baseline. Translating the
      // VIEW labels the coverage fix newly surfaces is what kept the gate from
      // widening; the rest is left exactly as it was. (showcase_business_unit
      // below started the same way and now carries its object block too.)
      // (`default` = the container's DEFAULT list — see showcase_project.)
      showcase_inquiry: {
        _views: {
          default: { label: '客户询问' },
          triage: { label: '询问分流' },
          // The public web-to-lead form's thank-you panel — the confirmation
          // an anonymous visitor reads after submitting `/forms/contact-us`.
          contact: {
            submitBehavior: { title: '感谢您！', message: '我们已收到您的留言，专员会尽快与您联系。' },
          },
        },
        // The public web-to-lead form's single section
        // (`ui/views/inquiry.view.ts` `formViews.contact`). Declares a stable
        // `name`, the only thing that makes the heading translatable
        // (#8231).
        _sections: {
          tell_us_about_yourself: { label: '介绍一下您自己' },
        },
      },
      // Object, fields and `kind` options as well as the views below: the
      // sidebar entry (`nav_business_units`, 业务单元 — the platform bundle's
      // word for `sys_business_unit`) opens this list. 上级单元 follows
      // showcase_category's 上级.
      showcase_business_unit: {
        label: '业务单元',
        pluralLabel: '业务单元',
        description: '组织架构层级——在自引用对象上演示树形 / 树形表格视图。',
        fields: {
          name: { label: '名称' },
          parent: { label: '上级单元' },
          kind: {
            label: '类型',
            options: { company: '公司', division: '事业部', department: '部门', team: '团队' },
          },
          manager: { label: '经理' },
          headcount: { label: '人数' },
        },
        _views: {
          default: { label: '全部单元' },
          org_chart: { label: '组织架构图' },
        },
        // `ui/views/business-unit.view.ts` `edit` form's single section.
        // Declares a stable `name`, the only thing that makes the heading
        // translatable (#8231). Bare object word, matching `全部单元` above.
        _sections: {
          unit: { label: '单元' },
        },
      },
      // The B3 dynamic-options fixture, opened from `nav_cascade` (级联选择).
      // Its description is a technical statement about the fixture, so the
      // zh-CN copy states the same thing and keeps the metadata keys
      // (`visibleWhen`, `dependsOn`) in their source spelling.
      showcase_cascade: {
        label: '级联选择',
        pluralLabel: '级联选择',
        description:
          'B3 动态选项夹具：国家 → 省份级联（逐选项 visibleWhen + dependsOn），外加按角色门控的等级；在客户端（可选集合）和服务端（objectql 拒绝集合外的提交）同时强制执行。',
        fields: {
          name: { label: '名称' },
          country: {
            label: '国家',
            options: { cn: '中国', us: '美国' },
          },
          province: {
            label: '省 / 州',
            options: { zj: '浙江', gd: '广东', ca: '加利福尼亚', tx: '得克萨斯' },
          },
          tier: {
            label: '等级',
            options: { standard: '标准', restricted: '受限（仅管理员）' },
          },
        },
      },
      // `_sections` only, on the same footing as the two `_views`-only blocks
      // above: this ADR-0085 fixture has no zh-CN block of its own and its
      // object/field debt sits inside the ratchet's baseline. Its two
      // `fieldGroups` headings are what the coverage walker newly surfaces
      // (#5405), and translating exactly those is what keeps the gate from
      // widening; the rest is left exactly as it was. `财务信息` follows the
      // group's own description ("Financial fields"), not the bare word Money.
      showcase_semantic_zoo: {
        _sections: {
          basics: { label: '基本信息' },
          money: { label: '财务信息' },
        },
      },
      showcase_field_zoo: {
        label: '字段动物园', pluralLabel: '字段动物园',
        fields: { f_lookups: { label: '查找 → 客户（多值）' } },
        // 三个视图共用一套门控动作，差别只在「被门控的字段是否也作为列显示」——
        // 即客户端是否展开它、投影是否本来就会带上它。见 ui/views/field-zoo.view.ts。
        // `_views.default` —— 容器的默认列表：它声明时不带 `name`，composer 把它
        // 注册为 `showcase_field_zoo.default`，bundle 的键就是这个裸运行时键
        // （#5164，2026-08-06 定案）。写成 `list` 是没有任何查找能到达的拼法 ——
        // 本条正是这么错过一次的：分支落后 main 时本地绿、合进 main 后 CI 红。
        _views: {
          default: { label: '字段动物园' },
          gated_columns: { label: '被门控字段作为列' },
          inline_bulk_defs: { label: '内联批量定义' },
        },
        // #3405 — the inline system-object picker specimen. Translated at birth
        // because `check-i18n-coverage` ratchets this example at its current
        // untranslated count: a newly declared label that skips zh-CN pushes the
        // count up and fails the gate. (The gallery's older params sit inside
        // that baseline; this one is not allowed to widen it.) `负责人` matches
        // what the bundle already renders for `showcase_task.assignee`, rather
        // than introducing a second word for the same idea.
        // 动作显隐矩阵（objectui#3492 / #3501）。同上：本示例被
        // `check-i18n-coverage` 按当前未翻译计数上了棘轮，新声明的标签必须当场
        // 翻译，否则计数上涨、门变红。标签本身是覆盖夹具的说明文字，中文照写同
        // 一句技术陈述，不做意译。
        _actions: {
          showcase_action_param_gallery: {
            params: {
              p_assignee: {
                label: '负责人',
                helpText: '指向系统对象的内联查找 —— 可按姓名或邮箱搜索,无需填写 UUID。',
              },
            },
          },
          showcase_zoo_relation_gate: { label: '查找 == 多值第一项', successMessage: '两个关系都解析到同一个 id。' },
          showcase_zoo_user_gate: { label: '指派给我（user 字段）', successMessage: '你是这条标本的指派用户。' },
          showcase_zoo_owner_gate: { label: '归我所有（owner_id）', successMessage: '这条标本归你所有。' },
          showcase_zoo_dialect_split: { label: '仅 CEL：contains()' },
          showcase_zoo_toolbar_gate: { label: '仅登录可见（工具栏）', successMessage: '工具栏门通过。' },
          showcase_zoo_visible_string: { label: 'visible：字符串' },
          showcase_zoo_visible_tagged: { label: 'visible：P`…` 标签模板' },
          showcase_zoo_visible_envelope: { label: 'visible：{ dialect, source } 信封' },
          showcase_zoo_disabled_gate: { label: '未评分则禁用' },
          showcase_zoo_perm_held: { label: '需要导出能力' },
          showcase_zoo_perm_missing: { label: '需要受限能力' },
          showcase_zoo_perm_and: { label: '需要同时具备两项能力' },
          showcase_zoo_perm_empty: { label: 'requiredPermissions：[]' },
          // 字段类型谓词园 —— 每种字段类型一条 `visible`。
          showcase_zoo_t_lookup: { label: 'lookup —— 已设置' },
          showcase_zoo_t_lookup_multi: { label: 'lookup 多值 —— 多于 1 项' },
          showcase_zoo_t_master_detail: { label: 'master_detail —— 已设置' },
          showcase_zoo_t_tree: { label: 'tree —— 未设置' },
          showcase_zoo_t_user: { label: 'user —— 未设置' },
          showcase_zoo_t_user_identity: { label: 'user —— 是我' },
          showcase_zoo_t_owner: { label: 'owner_id（注入列）—— 属于我' },
          showcase_zoo_t_text: { label: 'text —— name 非空' },
          showcase_zoo_t_textarea: { label: 'textarea —— contains' },
          showcase_zoo_t_email: { label: 'email —— matches' },
          showcase_zoo_t_url: { label: 'url —— contains' },
          showcase_zoo_t_phone: { label: 'phone —— contains' },
          showcase_zoo_t_markdown: { label: 'markdown —— contains' },
          showcase_zoo_t_html: { label: 'html —— contains' },
          showcase_zoo_t_code: { label: 'code —— contains' },
          showcase_zoo_t_number: { label: 'number —— > 100' },
          showcase_zoo_t_currency: { label: 'currency —— > 1000' },
          showcase_zoo_t_percent: { label: 'percent —— >= 75' },
          showcase_zoo_t_rating: { label: 'rating —— >= 4' },
          showcase_zoo_t_slider: { label: 'slider —— > 50' },
          showcase_zoo_t_progress: { label: 'progress —— >= 80' },
          showcase_zoo_t_formula: { label: 'formula —— > 100' },
          showcase_zoo_t_autonumber: { label: 'autonumber —— 等于 0001' },
          showcase_zoo_t_date: { label: 'date —— 早于今天' },
          showcase_zoo_t_datetime: { label: 'datetime —— 已设置' },
          showcase_zoo_t_time: { label: 'time —— 等于 14:30' },
          showcase_zoo_t_boolean: { label: 'boolean —— 真' },
          showcase_zoo_t_toggle: { label: 'toggle —— 真' },
          showcase_zoo_t_select: { label: 'select —— high' },
          showcase_zoo_t_radio: { label: 'radio —— yes' },
          showcase_zoo_t_multiselect: { label: 'multiselect —— 含 red' },
          showcase_zoo_t_checkboxes: { label: 'checkboxes —— 含 email' },
          showcase_zoo_t_tags: { label: 'tags —— 非空' },
          showcase_zoo_t_json: { label: 'json —— 嵌套键' },
          showcase_zoo_t_location: { label: 'location —— 纬度 > 40' },
          showcase_zoo_t_address: { label: 'address —— 美国' },
          showcase_zoo_t_color: { label: 'color —— 等于 #2563EB' },
          showcase_zoo_t_composite: { label: 'composite —— width 为 10' },
          showcase_zoo_t_repeater: { label: 'repeater —— 2 行' },
          showcase_zoo_t_record: { label: 'record 套 record —— score 为 9' },
          showcase_zoo_t_vector: { label: 'vector —— 4 维' },
          showcase_zoo_t_and: { label: 'AND —— boolean && number' },
          showcase_zoo_t_or: { label: 'OR —— select || rating' },
          showcase_zoo_t_not: { label: 'NOT —— !boolean' },
          showcase_zoo_t_ternary: { label: '三元 —— rating ? :' },
        },
      },
    },
    // ── The app shell: sidebar navigation ────────────────────────────────
    // A THIRD key space, addressed by the navigation node's stable `id`
    // regardless of tree depth: `apps.<app>.navigation.<id>.label`, applied by
    // `translateApp` (`@objectstack/spec/system/i18n-resolver`) at the `/meta`
    // boundary in `@objectstack/rest`. Nothing under `objects.*` answers for
    // it — a nav entry whose label was authored ('Projects', not the bare
    // `showcase_project`) keeps that authored label, so the object's translated
    // `pluralLabel` never reaches the sidebar. Which is why a zh-CN session
    // showed translated view tabs, columns, field labels and option values
    // under an English sidebar: the bundle carried no app keys at all.
    //
    // Every labelled node of `ui/apps/index.ts` is here — 49 items and the 8
    // `grp_*` group headers, the exact set `os lint` reports for this app.
    // `nav_sep_reports` is a separator: it declares no label, so there is
    // nothing to translate and no key for it.
    //
    // Wording reuses the vocabulary this bundle already established rather than
    // minting a second word per idea: 项目 / 任务 / 客户 / 联系人 / 发票 / 设置
    // from the object blocks, 任务清单 · 工时按状态分布 · 活动时间线 ·
    // 工作地点地图 · 看板 · 日历 from `showcase_task._views`, 排期 from its
    // `_sections`, 分流 from `showcase_inquiry._views.triage`, 业务单元 from
    // the platform bundle's `sys_business_unit`.
    apps: {
      showcase_app: {
        // The app's own name, rendered at the top of the same sidebar
        // (`apps.<name>.label`, objectui's `useObjectLabel().appLabel`). Left
        // untranslated it reproduces the mixed shell one line above the tree
        // this block fixes. Setup and Account translate theirs; Studio keeps
        // its product name. This app is named for what it does, not branded,
        // so it translates.
        label: '功能展示',
        navigation: {
          // Landing + the page-authoring teaching index — the two ungrouped
          // entries above every group.
          nav_capability_map: { label: '能力地图' },
          nav_start_here: { label: '页面搭建' },

          // Workspace — the app working like a real product.
          grp_workspace: { label: '工作区' },
          nav_my_work: { label: '我的工作' },
          // 审批 matches the platform bundle's `group_approvals`; the page is
          // the reviewer's queue, not the request list.
          nav_review_queue: { label: '审批' },
          nav_new_project_wizard: { label: '新建项目（向导）' },
          // The object's own `pluralLabel` above (showcase_preference).
          nav_settings: { label: '设置' },

          // Data Model — one entry per object list. Each reads the word this
          // bundle already gives that object.
          grp_data: { label: '数据模型' },
          nav_projects: { label: '项目' },
          nav_tasks: { label: '任务' },
          nav_accounts: { label: '客户' },
          nav_contacts: { label: '联系人' },
          nav_invoices: { label: '发票' },
          // 报销单 is the standard word for the document, and the word
          // `objects.showcase_expense_report` above gives the object, so the
          // sidebar entry and the list it opens read the same.
          nav_expense_reports: { label: '报销单' },
          nav_products: { label: '产品' },
          nav_teams: { label: '团队' },
          nav_categories: { label: '分类' },
          nav_business_units: { label: '业务单元' },
          nav_field_zoo: { label: '字段动物园' },
          nav_cascade: { label: '级联选择' },

          // Data slices — the same object under a pre-applied filter. Each
          // reads the option label of the value it filters on, so the entry
          // says the same word as the cells it lists (进行中 / 紧急 / 评审中,
          // from `showcase_task.fields.status|priority.options`).
          grp_slices: { label: '数据切片（筛选）' },
          nav_slice_in_progress: { label: '进行中的任务' },
          nav_slice_urgent: { label: '紧急任务' },
          nav_slice_review: { label: '评审中的任务' },

          // Analytics.
          grp_analytics: { label: '数据分析' },
          nav_command_center: { label: '指挥中心（大屏）' },
          nav_ops: { label: '交付运营' },
          nav_revenue_pulse: { label: '营收概览（带筛选）' },
          nav_charts: { label: '图表画廊' },
          // View-scoped and report entries whose surface this bundle already
          // names: 任务清单 is `showcase_task._views.tabular`, 工时按状态分布
          // is `_views.chart` — the same list under the same word.
          nav_report_tabular: { label: '任务清单' },
          nav_report_summary: { label: '工时按状态分布' },
          nav_report_chart: { label: '工时按状态分布（图表）' },
          nav_report_matrix: { label: '状态 × 优先级' },
          nav_report_joined: { label: '任务总览' },

          // The page-authoring gallery, split by authoring KIND. All four
          // headers share one word with `nav_start_here` above, exactly as the
          // English shares "Authoring" with "Page Authoring".
          grp_auth_structured: { label: '页面搭建 · 结构化' },
          nav_gallery: { label: '组件画廊' },
          nav_styling_gallery: { label: '样式（ADR-0065）' },
          nav_page_variables: { label: '页面变量' },
          nav_contact_form: { label: '联系表单' },
          nav_project_workspace: { label: '新建项目 + 任务' },
          nav_task_workbench: { label: '任务工作台' },
          nav_task_triage: { label: '任务分流（标签页）' },
          // The page's base filter hides completed projects rather than
          // matching `status = active`, so this says 进行中 rather than 活跃.
          nav_active_projects: { label: '进行中的项目' },

          grp_auth_viz: { label: '页面搭建 · 可视化' },
          nav_task_all_views: { label: '全部视图' },
          nav_task_board: { label: '任务看板' },
          nav_task_calendar: { label: '任务日历' },
          // 画廊 is objectui's own word for the gallery view type, shared here
          // with 组件画廊 / 图表画廊 above.
          nav_task_gallery: { label: '任务画廊' },
          nav_task_schedule: { label: '团队排期' },
          nav_task_timeline: { label: '活动时间线' },
          nav_task_map: { label: '工作地点地图' },

          grp_auth_html: { label: '页面搭建 · HTML' },
          nav_command_center_jsx: { label: '指挥中心' },

          grp_auth_react: { label: '页面搭建 · React' },
          nav_crm_workbench: { label: 'CRM 工作台 · 主从视图' },
          nav_task_desk: { label: '任务处理台 · 抽屉与弹窗' },
          nav_renewals_pipeline: { label: '续约管道 · 汇总与区块' },
        },
      },
    },
    // See the `en` block: object-less actions resolve ONLY through
    // `globalActions`. Translated at birth for the same reason as
    // `showcase_action_param_gallery.params.p_assignee` above — this example is
    // ratcheted at its current untranslated count, so a new declared label that
    // skips zh-CN widens the debt and fails `check-i18n-coverage`.
    globalActions: {
      showcase_portfolio_snapshot: {
        label: '业务概览',
        successMessage: '已生成业务概览。',
      },
    },
    dashboards: {
      showcase_chart_gallery: {
        widgets: {
          combo_count_vs_progress: { title: '任务数与平均进度' },
        },
      },
      // Same rule as the gallery above: these two widgets are born with the
      // percent-scale fix, so they are translated at birth. Revenue Pulse's
      // other widget titles predate the ratchet and stay in the frozen
      // baseline. objectui#3136.
      showcase_revenue_pulse: {
        widgets: {
          kpi_paid_rate: { title: '已付比例' },
          table_rate_by_status: { title: '各状态已付比例' },
        },
        // Born under the ratchet with `dashboards.<name>.globalFilters`
        // (#16772): the filter label and its static option labels are
        // declared surface now, so they are translated at birth.
        globalFilters: {
          region: { label: '区域', options: { amer: '美洲', emea: '欧洲、中东和非洲', apac: '亚太' } },
        },
      },
      showcase_ops_dashboard: {
        // The first dashboard a visitor opens (`nav_ops`, 交付运营 — the same
        // word here). Every widget title, so the KPI row never reads English
        // under a translated header. Each title says the word of the value it
        // filters on: 进行中的项目 is `fields.status.options.active` on
        // showcase_project, 红色 its health option, 待评审 the task's
        // 评审中, 总预算 the command center's `cc_k6`.
        label: '交付运营',
        description: '运营首页——核心 KPI、项目健康度与任务吞吐量。',
        widgets: {
          kpi_active_projects: { title: '进行中的项目' },
          kpi_at_risk: { title: '风险项目（红色）' },
          kpi_awaiting_review: { title: '待评审' },
          kpi_total_budget: { title: '总预算' },
          col_health: { title: '项目健康度分布' },
          bar_status: { title: '任务状态分布' },
          donut_priority: { title: '优先级构成' },
          line_created: { title: '任务吞吐量（按月）' },
          table_spend: { title: '各客户预算与已花费' },
        },
        globalFilters: {
          task_status: {
            label: '任务状态',
            options: { backlog: '待办池', todo: '待处理', in_progress: '进行中', in_review: '审核中', done: '已完成' },
          },
        },
      },
    },
    // The done rate's two measures, translated at birth (#20943) — see the `en`
    // block. The other task-dataset labels stay in the frozen baseline.
    datasets: {
      showcase_task_metrics: {
        measures: {
          done_count: { label: '已完成任务' },
          done_rate: { label: '完成率' },
        },
      },
    },
    // Page component copy became declared surface with `pages.<name>.components`
    // (#6080), so these keys are born under the ratchet: leaving any of them
    // untranslated widens the frozen baseline and fails `check-i18n-coverage`.
    // Most pages' own label/title/subtitle predate the ratchet and stay in the
    // frozen baseline, same as Revenue Pulse's older widget titles above. The
    // exceptions are the pages a visitor lands on first, whose `label` is the
    // page heading: each reads the word its sidebar entry already uses
    // (`apps.showcase_app.navigation`), so the heading matches the link that
    // opened it.
    pages: {
      showcase_capability_map: { label: '能力地图' },
      showcase_my_work: { label: '我的工作', subtitle: '你的待办队列、团队产出，以及需要关注的事项。' },
      showcase_review_queue: { label: '审批' },
      showcase_task_board: { label: '任务看板' },
      showcase_active_projects: { label: '进行中的项目' },
      // `ui/pages/invoice-document.page.ts` — the invoice print page.
      showcase_invoice_document: { label: '发票' },
      showcase_contact_form: {
        components: {
          field_name: { label: '姓名', placeholder: '艾达·洛夫莱斯' },
          field_email: { label: '邮箱', placeholder: 'ada@example.com' },
          field_company: { label: '公司', placeholder: '分析机有限公司' },
          field_message: { label: '留言', placeholder: '我们能帮您什么?' },
          submit_inquiry: { label: '提交咨询' },
        },
      },
      showcase_page_variables: {
        components: {
          project_picker: { label: '项目', placeholder: '选择项目…' },
        },
      },
      // `ui/pages/new-project-wizard.page.ts` — the create wizard's form, its
      // heading and the thank-you panel it swaps in after the create.
      showcase_new_project_wizard: {
        components: {
          new_project_form: {
            title: '创建项目',
            description: '三步向导：先填基本信息，再看健康状况，最后是预算与排期。',
            submitBehavior: {
              title: '项目已创建',
              message: '新项目已就绪——可在「项目」中找到它，或重新打开此向导再创建一个。',
            },
          },
        },
      },
      // Nested per-component copy. These ids sit inside a container's
      // `properties.children`, which `translatePage` resolves (#12961) but
      // `os i18n extract` could not see until #13109 matched the extractor's
      // walk to the resolver's — so they were declared surface that the
      // ratchet had never counted. Nothing about the AUTHORED metadata changed;
      // the extractor stopped omitting it.
      showcase_command_center: {
        components: {
          cc_k1: { label: '活跃项目' },
          cc_k2: { label: '待办任务' },
          cc_k3: { label: '待复审' },
          cc_k4: { label: '风险项目' },
          cc_k5: { label: '客户' },
          cc_k6: { label: '总预算' },
        },
      },
      showcase_styling_gallery: {
        components: {
          cta_Free: { label: '开始使用' },
          cta_Solo: { label: '升级到 Solo' },
          cta_Team: { label: '升级到 Team' },
          cta_Business: { label: '升级到 Business' },
        },
      },
    },
    // The reassign wizard: the flow's name in the runner header and
    // completion toast, its one screen's heading and its field label.
    flows: {
      showcase_reassign_wizard: {
        label: '重新分配任务',
        screens: {
          collect: {
            title: '新负责人',
            fields: { new_assignee: { label: '新负责人' } },
          },
        },
      },
      // The approval flows: the flow's name and each approval step's name, as
      // the approvals inbox, the record's approval panel and the request page
      // show them in the reader's locale.
      showcase_budget_approval: {
        label: '项目预算审批',
        approvals: { manager_review: { label: '经理审核' }, exec_review: { label: '高管审核' } },
      },
      showcase_closure_signoff: {
        label: '结项签批（审批子流程）',
        approvals: { ask_signoff: { label: '经理签批' } },
      },
      showcase_invoice_signoff: {
        label: '发票双重签批（并行审批）',
        approvals: { dual_signoff: { label: '财务 + 法务签批' } },
      },
      showcase_one_task_signoff: {
        label: '单个任务签批（逐项子流程）',
        approvals: { review: { label: '任务签批' } },
      },
      showcase_expense_signoff: {
        label: '费用报告签批',
        approvals: { dual_signoff: { label: '经理 + 财务签批' } },
      },
      showcase_committee_quorum: {
        label: '大额费用 — 委员会多数签批',
        approvals: { committee: { label: '委员会签批（三分之二）' } },
      },
      showcase_dynamic_approval: {
        label: '公告动态审批',
        approvals: { lead_review: { label: '负责人审核' }, co_sign: { label: '会签' } },
      },
      showcase_approver_bindings: {
        label: '审批人绑定示例（#3508）',
        approvals: {
          by_user: { label: '指定用户' },
          by_team: { label: '团队成员' },
          by_department: { label: '部门成员' },
          by_position: { label: '岗位任职者' },
          by_manager: { label: '提交人的经理' },
          by_field: { label: '触发字段中的用户' },
        },
      },
    },
    // The security catalog — positions and permission sets. Counted by
    // `check-i18n-coverage` like every other declared label: a new position or
    // set that skips zh-CN widens the debt.
    positions: {
      contributor: { label: '贡献者', description: '处理自己项目中的任务。' },
      manager: { label: '项目经理', description: '管理项目及其中的贡献者。' },
      exec: { label: '高管', description: '用于报表的全量只读可见性。' },
      auditor: { label: '审计员', description: '跨私有记录的合规只读视图（viewAllRecords）。' },
      ops: { label: '运营', description: '后台运营 — Setup 访问、公告修复、运营应用。' },
      field_ops_delegate: { label: '现场运营委派管理员', description: '对现场运营业务单元子树的范围化管理。' },
      client_liaison: { label: '客户联络人', description: '准备并发布面向客户的项目简报；看不到内部预算数据。' },
      client_portal_user: { label: '客户门户用户', description: '获准进入客户门户的外部客户。' },
      finance: { label: '财务', description: '发票和大额费用的财务签批权（仅用于审批路由）。' },
      legal: { label: '法务', description: '发票和大额费用的法务签批权（仅用于审批路由）。' },
    },
    permissions: {
      showcase_contributor: { label: '示例贡献者' },
      showcase_manager: { label: '示例经理' },
      showcase_executive: { label: '示例高管' },
      showcase_auditor: { label: '示例审计员' },
      showcase_ops: { label: '示例运营' },
      showcase_member_default: { label: '示例成员（默认）' },
      showcase_guest_portal: { label: '示例访客门户' },
      showcase_field_ops_delegate: { label: '现场运营委派管理员' },
      showcase_client_liaison: { label: '示例客户联络人' },
    },
    // The reports, as the report index lists them and each report page is
    // headed. Counted by `check-i18n-coverage` like the groups above.
    reports: {
      showcase_hours_by_status: { label: '按状态统计工时（汇总）', description: '按任务状态分组的预计工时。' },
      showcase_status_priority_matrix: { label: '状态 × 优先级（矩阵）', description: '按状态和优先级交叉统计的预计工时。' },
      showcase_task_overview: {
        label: '任务概览（联合）',
        description: '将多个任务子报表堆叠在一个联合视图中。',
        // The joined report's block headings, keyed by block `name`.
        blocks: {
          open_block: { label: '未完成任务' },
          done_block: { label: '已完成任务' },
        },
      },
      showcase_hours_by_status_chart: { label: '按状态统计工时（图表）', description: '以柱状图展示按状态统计的预计工时。' },
    },
    // The docs book: its title and the docs sidebar's section titles, keyed by
    // the book's `name` and each group's `key`. The docs themselves localize
    // through `doc.translations` and `<name>.zh-CN.md` variants.
    books: {
      showcase_manual: {
        label: '示例手册',
        description: '这个综合示例工作区里的一切。',
        groups: {
          start: { label: '入门' },
          tour: { label: '导览' },
          guides: { label: '指南' },
        },
      },
    },
  },
};

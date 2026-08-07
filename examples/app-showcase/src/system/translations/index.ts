// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * English + Simplified Chinese labels for the core showcase objects.
 *
 * Covers EVERY field surfaced as a column on the showcase pages so a list never
 * mixes locales (the prior bundle translated only a handful, leaving columns
 * like Project / Assignee / Progress falling back to their English field label
 * next to translated 状态 / 优先级 — an obvious inconsistency on a zh-CN session).
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
          owner: { label: 'Owner' },
          status: { label: 'Status' },
          health: { label: 'Health' },
          budget: { label: 'Budget' },
          spent: { label: 'Spent' },
          start_date: { label: 'Start Date' },
          end_date: { label: 'End Date' },
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
      showcase_invoice: {
        label: 'Invoice',
        pluralLabel: 'Invoices',
        fields: {
          name: { label: 'Invoice Number' },
          account: { label: 'Account' },
          contact: { label: 'Contact' },
          owner: { label: 'Owner' },
          status: { label: 'Status' },
          issued_on: { label: 'Issued On' },
          tax_rate: { label: 'Tax Rate (%)' },
          paid_on: { label: 'Paid On' },
          total: { label: 'Total' },
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
      },
    },
  },
  'zh-CN': {
    objects: {
      showcase_project: {
        label: '项目',
        pluralLabel: '项目',
        fields: {
          name: { label: '项目名称' },
          account: { label: '客户' },
          owner: { label: '负责人' },
          status: { label: '状态' },
          health: { label: '健康度' },
          budget: { label: '预算' },
          spent: { label: '已花费' },
          start_date: { label: '开始日期' },
          end_date: { label: '结束日期' },
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
        _views: {
          // The default list — keyed `default`, see showcase_project above.
          default: { label: '全部任务' },
          in_progress: { label: '进行中' },
          urgent: { label: '紧急' },
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
          showcase_recalc_estimate: {
            label: '重算工时',
            successMessage: '工时已重算。',
          },
          showcase_recalc_selection: {
            label: '重算所选',
            successMessage: '已为整个选中集重算工时。',
          },
        },
        // Section headings of the four form-view projections in
        // `ui/views/task.view.ts` (tabbed / wizard / split). Each section
        // there declares a stable `name`, which is the only thing that makes
        // the heading translatable — `ObjectForm` looks it up as
        // `objects.showcase_task._sections.<name>.label` and otherwise renders
        // the English `label` verbatim. Wording follows the vocabulary the
        // rest of this bundle already uses (任务 / 负责人 / 进度), rather than
        // introducing a second word per idea.
        _sections: {
          // tabbed
          overview: { label: '概览' },
          schedule: { label: '排期' },
          details: { label: '详细信息' },
          // wizard steps
          step_basics: { label: '基本信息' },
          step_assign: { label: '指派' },
          step_schedule: { label: '排期' },
          // split panes
          split_task: { label: '任务' },
          split_schedule: { label: '排期' },
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
        _views: {
          default: { label: '联系人' },
        },
        // `_sections` — the four groups of the default edit form in
        // `ui/views/contact.view.ts`. Each declares a stable `name`, which is
        // the only reason the heading is translatable (`ObjectForm` looks it up
        // as `objects.showcase_contact._sections.<name>.label` and otherwise
        // renders the English `label` verbatim). Wording reuses the vocabulary
        // this bundle already established — 状态 and 备注 are exactly the words
        // its `stage`-family and `notes` entries use — rather than minting a
        // second term per idea. `contact` reads 联系方式 (contact DETAILS, its
        // fields being 姓名/邮箱/电话) instead of a circular 联系人 heading
        // inside a contact record; `work` follows the `…信息` shape the
        // showcase_semantic_zoo headings set.
        _sections: {
          contact: { label: '联系方式' },
          work: { label: '工作信息' },
          status: { label: '状态' },
          notes: { label: '备注' },
        },
      },
      showcase_invoice: {
        label: '发票',
        pluralLabel: '发票',
        fields: {
          name: { label: '发票号' },
          account: { label: '客户' },
          contact: { label: '联系人' },
          owner: { label: '负责人' },
          status: { label: '状态' },
          issued_on: { label: '开具日期' },
          tax_rate: { label: '税率 (%)' },
          paid_on: { label: '付款日期' },
          total: { label: '合计' },
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
      // `_views` only: these two objects have no zh-CN block of their own, and
      // their object/field debt is inside the ratchet's baseline. Translating
      // the VIEW labels the coverage fix newly surfaces is what keeps the gate
      // from widening; the rest is left exactly as it was.
      // (`default` = the container's DEFAULT list — see showcase_project.)
      showcase_inquiry: {
        _views: {
          default: { label: '客户询问' },
          triage: { label: '询问分流' },
        },
      },
      showcase_business_unit: {
        _views: {
          default: { label: '全部单元' },
          org_chart: { label: '组织架构图' },
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
        // #3405 — the inline system-object picker specimen. Translated at birth
        // because `check-i18n-coverage` ratchets this example at its current
        // untranslated count: a newly declared label that skips zh-CN pushes the
        // count up and fails the gate. (The gallery's older params sit inside
        // that baseline; this one is not allowed to widen it.) `负责人` matches
        // what the bundle already renders for `showcase_task.assignee`, rather
        // than introducing a second word for the same idea.
        _actions: {
          showcase_action_param_gallery: {
            params: {
              p_assignee: {
                label: '负责人',
                helpText: '指向系统对象的内联查找 —— 可按姓名或邮箱搜索,无需填写 UUID。',
              },
            },
          },
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
      },
    },
  },
};

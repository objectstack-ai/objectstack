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
      // See the `en` side for why this entry translates exactly ONE field and
      // no more (check-i18n-coverage is a two-sided ratchet).
      showcase_expense_line: {
        fields: {
          incurred_at: { label: '发生时间' },
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
        // The public web-to-lead form's single section
        // (`ui/views/inquiry.view.ts` `formViews.contact`). Declares a stable
        // `name`, the only thing that makes the heading translatable
        // (#8231).
        _sections: {
          tell_us_about_yourself: { label: '介绍一下您自己' },
        },
      },
      showcase_business_unit: {
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
    // Page component copy became declared surface with `pages.<name>.components`
    // (#6080), so these keys are born under the ratchet: leaving any of them
    // untranslated widens the frozen baseline and fails `check-i18n-coverage`.
    // The pages' own label/title/subtitle predate the ratchet and stay in the
    // frozen baseline, same as Revenue Pulse's older widget titles above.
    pages: {
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
    },
  },
};

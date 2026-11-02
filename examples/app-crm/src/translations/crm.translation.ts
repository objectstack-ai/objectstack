// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineTranslationBundle } from '@objectstack/spec/system';

/**
 * CRM translation bundle — English + Simplified Chinese.
 *
 * Provides display labels for all CRM objects, apps, and common UI messages
 * so the Studio i18n pipeline has real data to render.
 */
export const CrmTranslationBundle = defineTranslationBundle({
  en: {
    objects: {
      crm_account: {
        label: 'Account',
        pluralLabel: 'Accounts',
        fields: {
          name: { label: 'Account Name' },
          industry: { label: 'Industry' },
          annual_revenue: { label: 'Annual Revenue' },
          website: { label: 'Website' },
          owner_id: { label: 'Account Owner' },
        },
      },
      crm_contact: {
        label: 'Contact',
        pluralLabel: 'Contacts',
        fields: {
          first_name: { label: 'First Name' },
          last_name: { label: 'Last Name' },
          full_name: { label: 'Full Name' },
          email: { label: 'Email' },
          account: { label: 'Account' },
        },
      },
      crm_opportunity: {
        label: 'Opportunity',
        pluralLabel: 'Opportunities',
        fields: {
          name: { label: 'Opportunity Name' },
          stage: { label: 'Stage' },
          amount: { label: 'Deal Value' },
          close_date: { label: 'Expected Close' },
          probability: { label: 'Win Probability (%)' },
          discount_percent: { label: 'Discount (%)' },
          owner_id: { label: 'Owner' },
        },
      },
      crm_lead: {
        label: 'Lead',
        pluralLabel: 'Leads',
        fields: {
          name: { label: 'Lead Name' },
          email: { label: 'Email' },
          company: { label: 'Company' },
          status: { label: 'Status' },
          lead_score: { label: 'Lead Score' },
          source: { label: 'Lead Source' },
        },
      },
      crm_activity: {
        label: 'Activity',
        pluralLabel: 'Activities',
        fields: {
          subject: { label: 'Subject' },
          type: { label: 'Activity Type' },
          status: { label: 'Status' },
          due_date: { label: 'Due Date' },
          contact: { label: 'Contact' },
          opportunity: { label: 'Opportunity' },
        },
      },
    },
    apps: {
      crm_app: {
        label: 'CRM',
        description: 'Customer Relationship Management',
        navigation: {
          group_sales: { label: 'Sales' },
          group_analytics: { label: 'Analytics' },
        },
      },
    },
    messages: {
      'crm.lead.convert.success': 'Lead converted to opportunity successfully.',
      'crm.lead.convert.error': 'Failed to convert lead. Please try again.',
      'crm.opportunity.won': 'Congratulations! Deal marked as won.',
      'crm.discount.pending_approval': 'Discount requires manager approval.',
      'crm.activity.due_today': 'You have {count} activities due today.',
    },
  },

  'zh-CN': {
    objects: {
      // The inline product grid's heading on the opportunity form. The field
      // lives on the line item, so the key is the line item's.
      crm_opportunity_line_item: {
        label: '产品明细',
        pluralLabel: '产品明细',
        description: '商机报价中的一行产品。',
        fields: {
          opportunity: { label: '商机', inlineTitle: '产品明细' },
          product: { label: '产品' },
          quantity: { label: '数量' },
          unit_price: { label: '单价' },
          amount: { label: '金额' },
        },
      },
      // A plural label is the plain noun: it names tabs and related panels
      // ("商机 4"), so a 「列表」 suffix would read 「商机列表 4」.
      crm_account: {
        label: '客户',
        pluralLabel: '客户',
        description: '向其销售产品或提供服务的企业。',
        fields: {
          name: { label: '客户名称' },
          industry: {
            label: '行业',
            options: {
              technology: '科技',
              finance: '金融',
              healthcare: '医疗',
              retail: '零售',
              other: '其他',
            },
          },
          annual_revenue: { label: '年营收' },
          website: { label: '官网' },
          owner_id: { label: '负责人' },
        },
      },
      crm_contact: {
        label: '联系人',
        pluralLabel: '联系人',
        description: '与客户相关的联系人。',
        fields: {
          first_name: { label: '名' },
          last_name: { label: '姓' },
          full_name: { label: '姓名' },
          email: { label: '邮箱' },
          account: { label: '所属客户' },
        },
      },
      crm_opportunity: {
        label: '商机',
        pluralLabel: '商机',
        description: '与客户关联的潜在销售机会。',
        fields: {
          name: { label: '商机名称' },
          account: { label: '客户' },
          stage: {
            label: '阶段',
            options: {
              prospecting: '初步接洽',
              qualification: '需求确认',
              proposal: '方案报价',
              closed_won: '赢单',
              closed_lost: '输单',
            },
          },
          amount: { label: '金额' },
          close_date: { label: '预计成交日期' },
          probability: { label: '赢单概率 (%)' },
          expected_revenue: { label: '预期收入' },
          days_to_close: { label: '距成交天数' },
          discount_percent: { label: '折扣 (%)' },
          approval_status: {
            label: '审批状态',
            options: {
              pending: '待审批',
              approved: '已批准',
              rejected: '已驳回',
              recalled: '已撤回',
            },
          },
          renewal_of: { label: '续约自' },
          line_total: { label: '产品合计' },
          owner_id: { label: '负责人' },
        },
        // No `default` key here, deliberately (#5164). This container's default
        // `list` is structurally identical to `listViews.all`, so the composer
        // COLLAPSES the two and the only registry entry is
        // `crm_opportunity.all` — `all` below already carries its label. The
        // `list` key that used to sit here was dead weight that looked correct:
        // it matched no runtime view under either spelling.
        _views: {
          all: { label: '全部商机' },
          pipeline: { label: '商机看板' },
        },
        // Form section heading of `ui/views/opportunity.view.ts` `form`.
        // Declares a stable `name`, which is the only thing that makes the
        // heading translatable — otherwise it renders the English `label` in
        // every locale (#8231). Bare object word, matching this bundle's own
        // `label` above.
        _sections: {
          opportunity: { label: '商机' },
        },
        // The words a rejected save shows.
        _validations: {
          discount_cap: { message: '未经特批，折扣不能超过 40%。' },
          opp_close_date_not_past: { message: '预计成交日期不能早于今天。' },
          opp_stage_transitions: { message: '商机不能变更到这个阶段。' },
        },
      },
      crm_lead: {
        label: '线索',
        pluralLabel: '线索',
        description: '尚未确认为商机的潜在客户。',
        fields: {
          name: { label: '线索名称' },
          email: { label: '邮箱' },
          phone: { label: '电话' },
          company: { label: '公司' },
          title: { label: '职位' },
          status: {
            label: '状态',
            options: {
              new: '新线索',
              contacted: '已联系',
              qualifying: '资格审查中',
              qualified: '合格',
              disqualified: '不合格',
              converted: '已转化',
            },
          },
          source: {
            label: '来源',
            options: {
              web: '官网',
              referral: '客户推荐',
              event: '市场活动',
              social: '社交媒体',
              cold_outreach: '主动开发',
              partner: '合作伙伴',
            },
          },
          lead_score: { label: '线索评分' },
          assigned_to: { label: '分配给' },
          account: { label: '所属客户' },
          converted_opportunity: { label: '转化商机' },
          notes: { label: '备注' },
          is_closed: { label: '已关闭' },
        },
        _actions: {
          crm_convert_lead: { label: '转化线索' },
        },
        // `list` removed — collapsed into `all`, see crm_opportunity (#5164).
        _views: {
          all: { label: '全部线索' },
          pipeline: { label: '线索看板' },
        },
        // Form section headings of `ui/views/lead.view.ts` (public web-to-lead
        // `contact_us`, plus the four `form` groups). Each section declares
        // a stable `name`, the only thing that makes the heading translatable
        // (#8231). `conversion` reuses this bundle's own `messages` vocabulary
        // for "convert" (`crm.lead.convert.success` already reads 转化).
        _sections: {
          contact_us: { label: '联系我们' },
          lead_information: { label: '线索信息' },
          qualification: { label: '资格审查' },
          conversion: { label: '转化' },
          notes: { label: '备注' },
        },
        // The words a rejected save shows.
        _validations: {
          lead_status_transitions: { message: '线索不能变更到这个状态。' },
          lead_score_range: { message: '线索评分必须在 0 到 100 之间。' },
        },
      },
      crm_activity: {
        label: '活动',
        pluralLabel: '活动',
        description: '与客户关系记录相关的一次互动（电话、邮件、会议或任务）。',
        fields: {
          subject: { label: '主题' },
          type: {
            label: '活动类型',
            options: {
              call: '电话',
              email: '邮件',
              meeting: '会议',
              task: '任务',
            },
          },
          status: {
            label: '状态',
            options: {
              planned: '计划中',
              in_progress: '进行中',
              completed: '已完成',
              cancelled: '已取消',
            },
          },
          due_date: { label: '截止日期' },
          contact: { label: '联系人' },
          account: { label: '客户' },
          opportunity: { label: '商机' },
          description: { label: '描述' },
          outcome: { label: '结果与备注' },
          duration_minutes: { label: '时长（分钟）' },
        },
        // `list` removed — collapsed into `all`, see crm_opportunity (#5164).
        _views: {
          all: { label: '全部活动' },
          calendar: { label: '活动日历' },
        },
        // Form section headings of `ui/views/activity.view.ts` `form`. Each
        // declares a stable `name`, the only thing that makes the heading
        // translatable (#8231).
        _sections: {
          activity_details: { label: '活动详情' },
          related_records: { label: '相关记录' },
          notes: { label: '备注' },
        },
      },
    },
    apps: {
      crm_app: {
        label: '客户管理',
        description: '客户关系管理系统',
        // Keyed by navigation id, at any depth: the groups and every entry
        // under them.
        navigation: {
          group_sales: { label: '销售管理' },
          nav_leads: { label: '线索' },
          nav_accounts: { label: '客户' },
          nav_contacts: { label: '联系人' },
          nav_opportunities: { label: '商机' },
          nav_activities: { label: '活动' },
          group_analytics: { label: '数据分析' },
          nav_pipeline_dashboard: { label: '销售漏斗' },
        },
      },
    },
    dashboards: {
      pipeline_dashboard: {
        label: '销售漏斗',
        description: '销售漏斗一览，并与之前的周期对比。',
        widgets: {
          total_pipeline: {
            title: '在途商机总额',
            description: '所有未结束商机的金额合计。',
          },
          won_this_quarter: {
            title: '本季度赢单',
            description: '本季度赢单的金额，与上季度对比。',
          },
          avg_deal_size_yoy: {
            title: '平均成交额（同比）',
            description: '今年赢单的平均金额，与去年同期对比。',
          },
          pipeline_trend_90d: {
            title: '商机趋势（近 12 个月）',
            description: '近 12 个月按预计成交月份统计的商机数，与上一年对比。',
          },
          opportunities_by_stage: {
            title: '各阶段商机',
            description: '本季度预计成交的商机按阶段统计，与上季度对比。',
          },
          pipeline_by_industry: {
            title: '在途商机阶段分布',
            description: '未结束商机的金额按阶段分布。',
          },
        },
      },
    },
    // The names a dashboard draws under its tiles and on its chart axes.
    datasets: {
      opportunity_metrics: {
        label: '商机指标',
        description: '销售漏斗的商机数与金额。',
        dimensions: {
          stage: { label: '阶段' },
          account: { label: '客户' },
          close_date: { label: '成交日期' },
        },
        measures: {
          opp_count: { label: '商机数' },
          total_amount: { label: '总金额' },
          avg_amount: { label: '平均成交额' },
        },
      },
    },
    pages: {
      crm_welcome: {
        label: '欢迎页',
        title: '欢迎使用客户管理',
        subtitle: '管理客户、联系人和商机。',
      },
    },
    // The lead-conversion wizard: the flow's name in the runner header and
    // completion toast, and each screen's heading.
    flows: {
      crm_convert_lead_wizard: {
        label: '将线索转化为客户和商机',
        successMessage: '🎉 线索已转化 — 已创建客户和商机。',
        errorMessage: '线索转化未完成 — 请检查线索后重试。',
        screens: {
          screen_already_converted: { title: '已转化', description: '该线索已转化为商机。' },
          screen_account: {
            title: '第 1 步，共 2 步 · 客户',
            description: '核对并补全从线索带过来的客户记录。',
          },
          screen_opportunity: {
            title: '第 2 步，共 2 步 · 商机',
            description: '添加商机及其产品明细，二者在同一个事务中一起保存。',
          },
        },
      },
    },
    // The security catalog: what an admin assigns a person to, and what
    // Setup lists under it.
    positions: {
      sales_rep: { label: '销售代表', description: '一线销售代表。' },
      sales_manager: { label: '销售经理', description: '管理一支销售代表团队。' },
      finance_approver: { label: '财务审批人', description: '有权审批 30% 以上折扣的财务团队成员。' },
    },
    permissions: {
      crm_sales_user: { label: 'CRM 销售用户' },
      guest_portal: { label: '访客（公开表单）' },
    },
    messages: {
      'crm.lead.convert.success': '线索已成功转化为商机。',
      'crm.lead.convert.error': '线索转化失败，请重试。',
      'crm.opportunity.won': '恭喜！商机已标记为赢单。',
      'crm.discount.pending_approval': '折扣需要经理审批。',
      'crm.activity.due_today': '您今天有 {count} 个活动待处理。',
    },
  },
});

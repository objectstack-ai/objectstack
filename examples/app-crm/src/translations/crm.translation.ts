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
      crm_account: {
        label: '客户',
        pluralLabel: '客户列表',
        fields: {
          name: { label: '客户名称' },
          industry: { label: '行业' },
          annual_revenue: { label: '年营收' },
          website: { label: '官网' },
          owner_id: { label: '负责人' },
        },
      },
      crm_contact: {
        label: '联系人',
        pluralLabel: '联系人列表',
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
        pluralLabel: '商机列表',
        fields: {
          name: { label: '商机名称' },
          stage: { label: '阶段' },
          amount: { label: '金额' },
          close_date: { label: '预计成交日期' },
          probability: { label: '赢单概率 (%)' },
          discount_percent: { label: '折扣 (%)' },
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
        // Form section heading of `ui/views/opportunity.view.ts` `default`.
        // Declares a stable `name`, which is the only thing that makes the
        // heading translatable — otherwise it renders the English `label` in
        // every locale (#8231). Bare object word, matching this bundle's own
        // `label` above.
        _sections: {
          opportunity: { label: '商机' },
        },
      },
      crm_lead: {
        label: '线索',
        pluralLabel: '线索列表',
        fields: {
          name: { label: '线索名称' },
          email: { label: '邮箱' },
          company: { label: '公司' },
          status: { label: '状态' },
          lead_score: { label: '线索评分' },
          source: { label: '来源' },
        },
        // `list` removed — collapsed into `all`, see crm_opportunity (#5164).
        _views: {
          all: { label: '全部线索' },
          pipeline: { label: '线索看板' },
        },
        // Form section headings of `ui/views/lead.view.ts` (public web-to-lead
        // `contact_us`, plus the four `default` groups). Each section declares
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
      },
      crm_activity: {
        label: '活动',
        pluralLabel: '活动列表',
        fields: {
          subject: { label: '主题' },
          type: { label: '活动类型' },
          status: { label: '状态' },
          due_date: { label: '截止日期' },
          contact: { label: '联系人' },
          opportunity: { label: '商机' },
        },
        // `list` removed — collapsed into `all`, see crm_opportunity (#5164).
        _views: {
          all: { label: '全部活动' },
          calendar: { label: '活动日历' },
        },
        // Form section headings of `ui/views/activity.view.ts` `default`. Each
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
        navigation: {
          group_sales: { label: '销售管理' },
          group_analytics: { label: '数据分析' },
        },
      },
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

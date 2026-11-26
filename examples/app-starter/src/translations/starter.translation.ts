// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineTranslationBundle } from '@objectstack/spec/system';

/**
 * Starter translation bundle — English and Simplified Chinese.
 *
 * The tasks and notes entries of the menu carry no label of their own, so
 * they show the platform's translations of `sys_task` and `sys_note`.
 */
export const StarterTranslationBundle = defineTranslationBundle({
  en: {
    objects: {
      starter_company: {
        label: 'Company',
        pluralLabel: 'Companies',
        fields: {
          name: { label: 'Company Name' },
          type: { label: 'Type' },
          industry: { label: 'Industry' },
          website: { label: 'Website' },
          phone: { label: 'Phone' },
          address: { label: 'Address' },
          description: { label: 'Description' },
          owner_id: { label: 'Owner' },
        },
      },
      starter_contact: {
        label: 'Contact',
        pluralLabel: 'Contacts',
        fields: {
          name: { label: 'Name' },
          company: { label: 'Company' },
          title: { label: 'Job Title' },
          influence: { label: 'Influence' },
          email: { label: 'Email' },
          phone: { label: 'Phone' },
          notes: { label: 'Notes' },
          owner_id: { label: 'Owner' },
        },
      },
    },
    apps: {
      starter_app: {
        label: 'Starter',
        description: 'Companies and contacts, with tasks and notes',
      },
    },
  },

  'zh-CN': {
    objects: {
      starter_company: {
        label: '公司',
        pluralLabel: '公司',
        description: '与本组织往来的公司。',
        fields: {
          name: { label: '公司名称' },
          type: {
            label: '类型',
            options: {
              prospect: '潜在客户',
              customer: '客户',
              partner: '合作伙伴',
              supplier: '供应商',
              other: '其他',
            },
          },
          industry: {
            label: '行业',
            options: {
              technology: '科技',
              manufacturing: '制造',
              retail: '零售',
              finance: '金融',
              healthcare: '医疗',
              education: '教育',
              other: '其他',
            },
          },
          website: { label: '网站' },
          phone: { label: '电话' },
          address: { label: '地址' },
          description: { label: '描述' },
          owner_id: { label: '负责人' },
        },
        _views: {
          all: { label: '全部公司' },
          by_type: { label: '按类型看板' },
        },
        _sections: {
          basic: { label: '基本信息' },
          contact_info: { label: '联系方式' },
          more: { label: '更多' },
        },
      },
      starter_contact: {
        label: '联系人',
        pluralLabel: '联系人',
        description: '往来公司里的人，不是本组织的员工。',
        fields: {
          name: { label: '姓名' },
          company: { label: '所属公司' },
          title: { label: '职位' },
          influence: {
            label: '影响力',
            options: {
              decision_maker: '决策人',
              influencer: '影响者',
              user: '使用者',
              other: '其他',
            },
          },
          email: { label: '邮箱' },
          phone: { label: '电话' },
          notes: { label: '备注' },
          owner_id: { label: '负责人' },
        },
        _views: {
          all: { label: '全部联系人' },
          by_influence: { label: '按影响力看板' },
        },
        _sections: {
          basic: { label: '基本信息' },
          contact_info: { label: '联系方式' },
          more: { label: '更多' },
        },
      },
    },
    apps: {
      starter_app: {
        label: '起步应用',
        description: '公司和联系人，以及任务和备忘',
      },
    },
    datasets: {
      starter_company_metrics: {
        label: '公司统计',
        description: '公司有多少家，按类型和行业分',
        dimensions: {
          type: { label: '类型', description: '公司与本组织的关系：潜在客户、客户、合作伙伴、供应商或其他。' },
          industry: {
            label: '行业',
            description: '公司所在的行业：科技、制造、零售、金融、医疗、教育或其他。未填行业的公司归入“无行业”。',
          },
        },
        measures: {
          company_count: { label: '公司数', description: '公司有多少家，不论类型。' },
        },
      },
      starter_contact_metrics: {
        label: '联系人统计',
        description: '联系人有多少位，按公司和影响力分',
        dimensions: {
          company: { label: '公司', description: '联系人所在的公司，结果显示公司名称。没有公司的联系人归入“无公司”。' },
          influence: { label: '影响力', description: '联系人在公司决策中的分量：决策人、影响者、使用者或其他。' },
        },
        measures: {
          contact_count: { label: '联系人数', description: '联系人有多少位。' },
        },
      },
    },
    dashboards: {
      starter_overview_dashboard: {
        label: '概览',
        description: '公司和联系人一览。',
        widgets: {
          total_companies: { title: '公司', description: '全部公司，不论类型。' },
          customers: { title: '客户', description: '类型为“客户”的公司。' },
          total_contacts: { title: '联系人', description: '全部联系人。' },
          companies_by_type: { title: '公司类型分布', description: '每种类型各有多少家公司。' },
          companies_by_industry: { title: '公司行业分布', description: '公司在各行业的分布。' },
          contacts_by_company: { title: '各公司联系人', description: '每家公司有多少位联系人。' },
        },
      },
    },
  },
});

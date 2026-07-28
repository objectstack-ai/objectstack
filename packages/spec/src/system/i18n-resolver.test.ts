// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ObjectTranslationDataSchema, TranslationDataSchema, type TranslationBundle } from './translation.zod';
import {
  resolveViewLabel,
  resolveViewDescription,
  resolveActionLabel,
  resolveActionConfirm,
  resolveActionSuccess,
  resolveActionResultDialog,
  translateAction,
  translateMetadataDocument,
  resolveObjectFieldLabels,
} from './i18n-resolver';

describe('ObjectTranslationDataSchema (_views/_actions extensions)', () => {
  it('accepts _views entries', () => {
    const data = ObjectTranslationDataSchema.parse({
      label: '客户',
      _views: {
        all_accounts: { label: '全部客户', description: '所有客户列表' },
        my_accounts: { label: '我的客户' },
      },
    });
    expect(data._views?.all_accounts.label).toBe('全部客户');
    expect(data._views?.all_accounts.description).toBe('所有客户列表');
    expect(data._views?.my_accounts.label).toBe('我的客户');
  });

  it('accepts _actions entries with confirm + success', () => {
    const data = ObjectTranslationDataSchema.parse({
      label: '线索',
      _actions: {
        convert_lead: {
          label: '转化线索',
          confirmText: '确定要转化此线索吗？',
          successMessage: '线索转化成功！',
        },
      },
    });
    expect(data._actions?.convert_lead.label).toBe('转化线索');
    expect(data._actions?.convert_lead.confirmText).toBe('确定要转化此线索吗？');
    expect(data._actions?.convert_lead.successMessage).toBe('线索转化成功！');
  });

  it('accepts _actions entries with a resultDialog node (dotted field paths stay literal keys)', () => {
    const data = ObjectTranslationDataSchema.parse({
      label: '用户',
      _actions: {
        create_user: {
          label: '创建用户',
          resultDialog: {
            title: '用户已创建',
            description: '请立即复制临时密码——它只显示一次，不会被存储。',
            acknowledge: '我已保存该密码',
            fields: {
              'user.email': '邮箱',
              temporaryPassword: '临时密码',
            },
          },
        },
      },
    });
    expect(data._actions?.create_user.resultDialog?.title).toBe('用户已创建');
    expect(data._actions?.create_user.resultDialog?.fields?.['user.email']).toBe('邮箱');
    expect(data._actions?.create_user.resultDialog?.fields?.temporaryPassword).toBe('临时密码');
  });
});

describe('TranslationDataSchema globalActions', () => {
  it('accepts globalActions', () => {
    const data = TranslationDataSchema.parse({
      globalActions: {
        log_call: { label: '记录通话', successMessage: '通话已记录！' },
        export_csv: { label: '导出 CSV' },
      },
    });
    expect(data.globalActions?.log_call.label).toBe('记录通话');
    expect(data.globalActions?.export_csv.label).toBe('导出 CSV');
  });
});

const bundle: TranslationBundle = {
  en: {
    objects: {
      account: {
        label: 'Account',
        _views: {
          all_accounts: { label: 'All Accounts', description: 'Every account' },
        },
        _actions: {
          merge_accounts: {
            label: 'Merge Accounts',
            confirmText: 'Merge selected accounts?',
            successMessage: 'Accounts merged.',
          },
        },
      },
    },
    globalActions: {
      export_csv: { label: 'Export CSV', successMessage: 'Export ready.' },
    },
  },
  'zh-CN': {
    objects: {
      account: {
        label: '客户',
        _views: { all_accounts: { label: '全部客户', description: '所有客户' } },
        _actions: {
          merge_accounts: {
            label: '合并客户',
            confirmText: '确认合并选中的客户？',
            successMessage: '客户已合并。',
          },
        },
      },
    },
    globalActions: {
      export_csv: { label: '导出 CSV', successMessage: '导出完成。' },
    },
  },
};

describe('resolveViewLabel', () => {
  it('returns translated label for the active locale', () => {
    expect(
      resolveViewLabel(
        bundle,
        { name: 'all_accounts', label: 'All Accounts', objectName: 'account' },
        { locale: 'zh-CN' },
      ),
    ).toBe('全部客户');
  });

  it('falls back through fallbackChain to en', () => {
    expect(
      resolveViewLabel(
        bundle,
        { name: 'all_accounts', label: 'All Accounts', objectName: 'account' },
        { locale: 'fr-FR', fallbackChain: ['en'] },
      ),
    ).toBe('All Accounts');
  });

  it('falls back to literal label when no bundle entry exists', () => {
    expect(
      resolveViewLabel(
        bundle,
        { name: 'unknown_view', label: 'Unknown View', objectName: 'account' },
        { locale: 'zh-CN' },
      ),
    ).toBe('Unknown View');
  });

  it('uses data.object when objectName is missing', () => {
    expect(
      resolveViewLabel(
        bundle,
        { name: 'all_accounts', label: 'All Accounts', data: { object: 'account' } },
        { locale: 'zh-CN' },
      ),
    ).toBe('全部客户');
  });

  it('returns label when bundle is undefined', () => {
    expect(
      resolveViewLabel(undefined, {
        name: 'all_accounts',
        label: 'All Accounts',
        objectName: 'account',
      }),
    ).toBe('All Accounts');
  });
});

describe('resolveViewDescription', () => {
  it('returns translated description', () => {
    expect(
      resolveViewDescription(
        bundle,
        { name: 'all_accounts', objectName: 'account' },
        { locale: 'zh-CN' },
      ),
    ).toBe('所有客户');
  });

  it('falls back to literal description', () => {
    expect(
      resolveViewDescription(
        bundle,
        { name: 'unknown', objectName: 'account', description: 'literal' },
        { locale: 'zh-CN' },
      ),
    ).toBe('literal');
  });
});

describe('resolveActionLabel + confirm + success', () => {
  it('translates an object-bound action', () => {
    const action = {
      name: 'merge_accounts',
      label: 'Merge Accounts',
      objectName: 'account',
      confirmText: 'Merge selected accounts?',
      successMessage: 'Accounts merged.',
    };
    expect(resolveActionLabel(bundle, action, { locale: 'zh-CN' })).toBe('合并客户');
    expect(resolveActionConfirm(bundle, action, { locale: 'zh-CN' })).toBe(
      '确认合并选中的客户？',
    );
    expect(resolveActionSuccess(bundle, action, { locale: 'zh-CN' })).toBe('客户已合并。');
  });

  it('falls back to globalActions for object-less actions', () => {
    const action = {
      name: 'export_csv',
      label: 'Export to CSV',
      successMessage: 'Export completed!',
    };
    expect(resolveActionLabel(bundle, action, { locale: 'zh-CN' })).toBe('导出 CSV');
    expect(resolveActionSuccess(bundle, action, { locale: 'zh-CN' })).toBe('导出完成。');
    expect(resolveActionConfirm(bundle, action, { locale: 'zh-CN' })).toBeUndefined();
  });

  it('returns the literal label when no bundle entry matches', () => {
    expect(
      resolveActionLabel(
        bundle,
        { name: 'unknown_action', label: 'Mystery', objectName: 'account' },
        { locale: 'zh-CN' },
      ),
    ).toBe('Mystery');
  });

  it('returns the action name when neither bundle nor literal label exists', () => {
    expect(
      resolveActionLabel(undefined, { name: 'nameless_action' }),
    ).toBe('nameless_action');
  });
});

describe('resolveActionResultDialog + translateAction', () => {
  const dialogBundle: TranslationBundle = {
    'zh-CN': {
      objects: {
        sys_user: {
          label: '用户',
          _actions: {
            create_user: {
              resultDialog: {
                title: '用户已创建',
                description: '请立即复制临时密码——它只显示一次，不会被存储。',
                acknowledge: '我已保存该密码',
                fields: {
                  'user.email': '邮箱',
                  temporaryPassword: '临时密码',
                },
              },
            },
          },
        },
      },
      globalActions: {
        export_secrets: {
          resultDialog: { title: '密钥已导出' },
        },
      },
    },
  };

  const createUser = {
    name: 'create_user',
    label: 'Create User',
    objectName: 'sys_user',
    resultDialog: {
      title: 'User Created',
      description: 'Copy the temporary password now — it is shown only once and never stored.',
      acknowledge: 'I have saved this password',
      fields: [
        { path: 'user.email', label: 'Email', format: 'text' },
        { path: 'user.phoneNumber', label: 'Phone Number', format: 'text' },
        { path: 'temporaryPassword', label: 'Temporary Password', format: 'secret' },
      ],
    },
  };

  it('overlays title/description/acknowledge and per-path field labels', () => {
    const out = resolveActionResultDialog(dialogBundle, createUser, { locale: 'zh-CN' });
    expect(out?.title).toBe('用户已创建');
    expect(out?.description).toBe('请立即复制临时密码——它只显示一次，不会被存储。');
    expect(out?.acknowledge).toBe('我已保存该密码');
    expect(out?.fields?.[0]).toEqual({ path: 'user.email', label: '邮箱', format: 'text' });
    // Untranslated field keeps its literal label; formats survive the overlay.
    expect(out?.fields?.[1]).toEqual({ path: 'user.phoneNumber', label: 'Phone Number', format: 'text' });
    expect(out?.fields?.[2]).toEqual({ path: 'temporaryPassword', label: '临时密码', format: 'secret' });
    // Source spec is not mutated.
    expect(createUser.resultDialog.title).toBe('User Created');
    expect(createUser.resultDialog.fields[0].label).toBe('Email');
  });

  it('falls back to the literal spec when the locale has no entry', () => {
    const out = resolveActionResultDialog(dialogBundle, createUser, { locale: 'ja-JP', fallbackChain: [] });
    expect(out?.title).toBe('User Created');
    expect(out?.fields?.[0].label).toBe('Email');
  });

  it('resolves globalActions for object-less actions', () => {
    const out = resolveActionResultDialog(
      dialogBundle,
      { name: 'export_secrets', resultDialog: { title: 'Secrets exported' } },
      { locale: 'zh-CN' },
    );
    expect(out?.title).toBe('密钥已导出');
  });

  it('returns undefined when the action has no resultDialog', () => {
    expect(
      resolveActionResultDialog(dialogBundle, { name: 'create_user', objectName: 'sys_user' }, { locale: 'zh-CN' }),
    ).toBeUndefined();
  });

  it('translateAction carries the translated resultDialog', () => {
    const out = translateAction(createUser, dialogBundle, { locale: 'zh-CN' });
    expect(out.resultDialog?.title).toBe('用户已创建');
    expect(out.resultDialog?.fields?.[2].label).toBe('临时密码');
  });
});

describe('translateMetadataDocument', () => {
  it('translates a view document', () => {
    const view = {
      name: 'all_accounts',
      label: 'All Accounts',
      description: 'Every account',
      objectName: 'account',
      kind: 'list',
    };
    const out = translateMetadataDocument('view', view, bundle, { locale: 'zh-CN' });
    expect(out.label).toBe('全部客户');
    expect(out.description).toBe('所有客户');
    expect(out.kind).toBe('list');
    expect(view.label).toBe('All Accounts'); // not mutated
  });

  it('translates an action document with confirm + success', () => {
    const action = {
      name: 'merge_accounts',
      label: 'Merge Accounts',
      objectName: 'account',
      confirmText: 'Merge selected accounts?',
      successMessage: 'Accounts merged.',
    };
    const out = translateMetadataDocument('action', action, bundle, { locale: 'zh-CN' });
    expect(out.label).toBe('合并客户');
    expect(out.confirmText).toBe('确认合并选中的客户？');
    expect(out.successMessage).toBe('客户已合并。');
  });

  it('returns unknown types unchanged', () => {
    const doc = { name: 'foo', label: 'Bar' };
    const out = translateMetadataDocument('mystery', doc, bundle, { locale: 'zh-CN' });
    expect(out).toBe(doc);
  });

  it('returns literal labels when bundle is undefined', () => {
    const view = { name: 'all_accounts', label: 'All Accounts', objectName: 'account' };
    const out = translateMetadataDocument('view', view, undefined, { locale: 'zh-CN' });
    expect(out.label).toBe('All Accounts');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// metadataForms namespace + resolver
// ────────────────────────────────────────────────────────────────────────────

import {
  resolveMetadataTypeLabel,
  resolveMetadataTypeDescription,
  resolveMetadataFormLabels,
} from './i18n-resolver';

describe('TranslationDataSchema metadataForms', () => {
  it('accepts a fully-populated metadataForms entry', () => {
    const data = TranslationDataSchema.parse({
      metadataForms: {
        object: {
          label: '对象',
          description: '业务对象定义',
          sections: {
            basics: { label: '基础信息', description: '标识与标签' },
            capabilities: { label: '功能开关' },
          },
          fields: {
            name: { label: '名称', helpText: 'snake_case 唯一标识符', placeholder: 'e.g. account' },
            'capabilities.trackHistory': { label: '历史追踪' },
          },
        },
      },
    });
    expect(data.metadataForms?.object?.label).toBe('对象');
    expect(data.metadataForms?.object?.sections?.basics?.label).toBe('基础信息');
    expect(data.metadataForms?.object?.fields?.['capabilities.trackHistory']?.label).toBe('历史追踪');
  });

  it('all metadataForms fields are optional', () => {
    expect(() => TranslationDataSchema.parse({ metadataForms: {} })).not.toThrow();
    expect(() => TranslationDataSchema.parse({ metadataForms: { object: {} } })).not.toThrow();
  });
});

describe('resolveMetadataTypeLabel', () => {
  const bundle: TranslationBundle = {
    'zh-CN': {
      metadataForms: { object: { label: '对象', description: '业务对象定义' } },
    },
    'en-US': {
      metadataForms: { object: { label: 'Object (en-US)' } },
    },
  };

  it('returns translated label when present', () => {
    expect(resolveMetadataTypeLabel(bundle, 'object', 'Object', { locale: 'zh-CN' })).toBe('对象');
  });

  it('falls back to the literal when no bundle entry', () => {
    expect(resolveMetadataTypeLabel(bundle, 'unknown', 'Unknown', { locale: 'zh-CN' })).toBe('Unknown');
  });

  it('walks the locale fallback chain', () => {
    expect(
      resolveMetadataTypeLabel(bundle, 'object', 'Object', {
        locale: 'fr-FR',
        fallbackChain: ['en-US'],
      }),
    ).toBe('Object (en-US)');
  });

  it('returns fallback when bundle is undefined', () => {
    expect(resolveMetadataTypeLabel(undefined, 'object', 'Object', { locale: 'zh-CN' })).toBe('Object');
  });
});

describe('resolveMetadataTypeDescription', () => {
  const bundle: TranslationBundle = {
    'zh-CN': { metadataForms: { object: { description: '业务对象定义' } } },
  };
  it('returns translated description', () => {
    expect(resolveMetadataTypeDescription(bundle, 'object', 'Business object definition', { locale: 'zh-CN' })).toBe(
      '业务对象定义',
    );
  });
  it('returns literal fallback when no translation', () => {
    expect(resolveMetadataTypeDescription(bundle, 'field', 'Field def', { locale: 'zh-CN' })).toBe('Field def');
  });
  it('passes through undefined fallback', () => {
    expect(resolveMetadataTypeDescription(bundle, 'field', undefined, { locale: 'zh-CN' })).toBeUndefined();
  });
});

describe('resolveMetadataFormLabels', () => {
  const bundle: TranslationBundle = {
    'zh-CN': {
      metadataForms: {
        object: {
          sections: {
            basics: { label: '基础信息', description: '标识与标签' },
            capabilities: { label: '功能开关' },
          },
          fields: {
            name: { label: '名称', helpText: 'snake_case 唯一标识符' },
            label: { label: '显示名' },
            'capabilities.trackHistory': { label: '历史追踪' },
            'fields.items.label': { label: '字段标签' },
          },
        },
      },
    },
  };

  const form = {
    schemaId: 'object',
    type: 'simple',
    sections: [
      {
        name: 'basics',
        label: 'Basics',
        description: 'Identity and labels.',
        fields: [
          { field: 'name', type: 'text', helpText: 'snake_case unique identifier' },
          { field: 'label', type: 'text' },
          { field: 'description', type: 'textarea' }, // No translation → unchanged
        ],
      },
      {
        name: 'capabilities',
        label: 'Capabilities',
        fields: [
          {
            field: 'capabilities',
            type: 'composite',
            fields: [
              { field: 'trackHistory', type: 'boolean' },
              { field: 'searchable', type: 'boolean' },
            ],
          },
        ],
      },
      {
        // No `name` → only field-level translations apply
        label: 'Untranslated section',
        fields: [{ field: 'something', type: 'text' }],
      },
      {
        name: 'fields',
        label: 'Fields',
        fields: [
          {
            field: 'fields',
            type: 'repeater',
            fields: [
              { field: 'items', type: 'composite', fields: [{ field: 'label', type: 'text' }] },
            ],
          },
        ],
      },
    ],
  };

  it('translates section labels keyed by section.name', () => {
    const out = resolveMetadataFormLabels(form, 'object', bundle, { locale: 'zh-CN' });
    expect(out.sections[0].label).toBe('基础信息');
    expect(out.sections[0].description).toBe('标识与标签');
    expect(out.sections[1].label).toBe('功能开关');
  });

  it('leaves sections without name unchanged at section level', () => {
    const out = resolveMetadataFormLabels(form, 'object', bundle, { locale: 'zh-CN' });
    expect(out.sections[2].label).toBe('Untranslated section');
  });

  it('translates top-level field label + helpText', () => {
    const out = resolveMetadataFormLabels(form, 'object', bundle, { locale: 'zh-CN' });
    const nameField = out.sections[0].fields[0];
    expect(nameField.label).toBe('名称');
    expect(nameField.helpText).toBe('snake_case 唯一标识符');
  });

  it('leaves untranslated fields untouched', () => {
    const out = resolveMetadataFormLabels(form, 'object', bundle, { locale: 'zh-CN' });
    expect(out.sections[0].fields[2].field).toBe('description');
    expect(out.sections[0].fields[2].label).toBeUndefined();
  });

  it('translates nested composite field via dot-notation path', () => {
    const out = resolveMetadataFormLabels(form, 'object', bundle, { locale: 'zh-CN' });
    const trackHistory = out.sections[1].fields[0].fields[0];
    expect(trackHistory.label).toBe('历史追踪');
    // sibling without translation stays untranslated
    expect(out.sections[1].fields[0].fields[1].label).toBeUndefined();
  });

  it('translates deeply-nested repeater sub-field via dot-notation path', () => {
    const out = resolveMetadataFormLabels(form, 'object', bundle, { locale: 'zh-CN' });
    const labelField = out.sections[3].fields[0].fields[0].fields[0];
    expect(labelField.label).toBe('字段标签');
  });

  it('returns the input unchanged when no bundle entry for type', () => {
    const out = resolveMetadataFormLabels(form, 'unknown_type', bundle, { locale: 'zh-CN' });
    expect(out).toBe(form);
  });

  it('returns the input unchanged when bundle is undefined', () => {
    expect(resolveMetadataFormLabels(form, 'object', undefined, { locale: 'zh-CN' })).toBe(form);
  });

  it('does not mutate the input form', () => {
    const snapshot = JSON.parse(JSON.stringify(form));
    resolveMetadataFormLabels(form, 'object', bundle, { locale: 'zh-CN' });
    expect(form).toEqual(snapshot);
  });

  it('respects locale fallback chain', () => {
    const fallbackBundle: TranslationBundle = {
      'en-US': {
        metadataForms: { object: { sections: { basics: { label: 'Basics (en)' } } } },
      },
    };
    const out = resolveMetadataFormLabels(form, 'object', fallbackBundle, {
      locale: 'fr-FR',
      fallbackChain: ['en-US'],
    });
    expect(out.sections[0].label).toBe('Basics (en)');
  });
});

import {
  translateApp,
  translateDashboard,
  resolveViewLabel as _resolveViewLabel,
} from './i18n-resolver';

describe('locale fallback resolution (BCP-47)', () => {
  const bundle: TranslationBundle = {
    'zh-CN': {
      objects: { account: { label: '客户' } },
    },
  };

  it('resolves base language to a registered region variant (zh → zh-CN)', () => {
    const out = translateMetadataDocument(
      'object',
      { name: 'account', label: 'Account' },
      bundle,
      { locale: 'zh' },
    );
    expect(out.label).toBe('客户');
  });

  it('resolves case-insensitively (zh-cn → zh-CN)', () => {
    const out = translateMetadataDocument(
      'object',
      { name: 'account', label: 'Account' },
      bundle,
      { locale: 'zh-cn' },
    );
    expect(out.label).toBe('客户');
  });

  it('resolves a region-qualified request down to base/other variant (zh-TW → zh-CN)', () => {
    const out = translateMetadataDocument(
      'object',
      { name: 'account', label: 'Account' },
      bundle,
      { locale: 'zh-TW' },
    );
    expect(out.label).toBe('客户');
  });

  it('falls back to literal when no related locale is registered', () => {
    const out = translateMetadataDocument(
      'object',
      { name: 'account', label: 'Account' },
      bundle,
      { locale: 'fr', fallbackChain: [] },
    );
    expect(out.label).toBe('Account');
  });
});

describe('translateApp', () => {
  const bundle: TranslationBundle = {
    'zh-CN': {
      apps: {
        setup: {
          label: '系统设置',
          description: '平台设置与管理',
          navigation: {
            group_overview: { label: '总览' },
            nav_users: { label: '用户' },
          },
        },
      },
    },
  };

  const app = {
    name: 'setup',
    label: 'Setup',
    description: 'Platform settings and administration',
    navigation: [
      {
        id: 'group_overview',
        type: 'group',
        label: 'Overview',
        children: [{ id: 'nav_users', type: 'object', label: 'Users' }],
      },
    ],
  };

  it('translates app label/description and nested navigation labels', () => {
    const out = translateApp(app, bundle, { locale: 'zh-CN' });
    expect(out.label).toBe('系统设置');
    expect(out.description).toBe('平台设置与管理');
    expect(out.navigation[0].label).toBe('总览');
    expect(out.navigation[0].children[0].label).toBe('用户');
  });

  it('works through translateMetadataDocument with app type', () => {
    const out = translateMetadataDocument('app', app, bundle, { locale: 'zh' });
    expect(out.navigation[0].children[0].label).toBe('用户');
  });

  it('does not mutate the input app', () => {
    const snapshot = JSON.parse(JSON.stringify(app));
    translateApp(app, bundle, { locale: 'zh-CN' });
    expect(app).toEqual(snapshot);
  });

  it('falls back to literal labels when no translation present', () => {
    const out = translateApp(app, undefined, { locale: 'zh-CN' });
    expect(out.label).toBe('Setup');
    expect(out.navigation[0].label).toBe('Overview');
  });
});

describe('translateDashboard', () => {
  const bundle: TranslationBundle = {
    'zh-CN': {
      dashboards: {
        system_overview: {
          label: '系统概览',
          widgets: {
            widget_total_users: { title: '用户总数', description: '系统中注册的用户总数' },
          },
        },
      },
    },
  };

  const dashboard = {
    name: 'system_overview',
    label: 'System Overview',
    widgets: [
      { id: 'widget_total_users', title: 'Total Users', description: 'Total registered users' },
      { id: 'widget_other', title: 'Other' },
    ],
  };

  it('translates dashboard label and widget title/description', () => {
    const out = translateDashboard(dashboard, bundle, { locale: 'zh-CN' });
    expect(out.label).toBe('系统概览');
    expect(out.widgets[0].title).toBe('用户总数');
    expect(out.widgets[0].description).toBe('系统中注册的用户总数');
  });

  it('leaves widgets without a translation entry unchanged', () => {
    const out = translateDashboard(dashboard, bundle, { locale: 'zh-CN' });
    expect(out.widgets[1].title).toBe('Other');
  });

  it('works through translateMetadataDocument with dashboard type', () => {
    const out = translateMetadataDocument('dashboard', dashboard, bundle, { locale: 'zh-CN' });
    expect(out.label).toBe('系统概览');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// translatePage — page label/description + `page:header` title/subtitle
// ────────────────────────────────────────────────────────────────────────────

import { translatePage } from './i18n-resolver';

describe('translatePage', () => {
  const bundle: TranslationBundle = {
    'zh-CN': {
      pages: {
        connect_agent: {
          label: '连接智能体',
          subtitle: '让任意支持 MCP 的 AI 客户端受控访问此环境。',
        },
        cloud_connection_settings: {
          label: '云连接',
          title: '云连接设置',
          description: '绑定控制平面',
        },
      },
    },
  };

  const page = {
    name: 'connect_agent',
    label: 'Connect an Agent',
    regions: [
      {
        name: 'header',
        components: [
          {
            type: 'page:header',
            properties: { title: 'Connect an Agent', subtitle: 'Give any MCP-capable client…', icon: 'bot' },
          },
        ],
      },
      {
        name: 'main',
        components: [{ type: 'mcp:connect-agent', properties: {} }],
      },
    ],
  };

  it('translates the page label and its page:header title/subtitle', () => {
    const out = translatePage(page, bundle, { locale: 'zh-CN' });
    expect(out.label).toBe('连接智能体');
    expect(out.regions[0].components[0].properties.title).toBe('连接智能体');
    expect(out.regions[0].components[0].properties.subtitle).toBe('让任意支持 MCP 的 AI 客户端受控访问此环境。');
  });

  it('preserves non-translatable header properties such as icon', () => {
    const out = translatePage(page, bundle, { locale: 'zh-CN' });
    expect(out.regions[0].components[0].properties.icon).toBe('bot');
  });

  it('leaves non-header components untouched', () => {
    const out = translatePage(page, bundle, { locale: 'zh-CN' });
    expect(out.regions[1].components[0]).toEqual({ type: 'mcp:connect-agent', properties: {} });
  });

  it('prefers an explicit title over the label fallback', () => {
    const settingsPage = {
      name: 'cloud_connection_settings',
      label: 'Cloud Connection',
      regions: [
        { name: 'header', components: [{ type: 'page:header', properties: { title: 'Cloud Connection' } }] },
      ],
    };
    const out = translatePage(settingsPage, bundle, { locale: 'zh-CN' });
    expect(out.label).toBe('云连接');
    expect(out.description).toBe('绑定控制平面');
    expect(out.regions[0].components[0].properties.title).toBe('云连接设置');
  });

  it('leaves pages without a translation entry unchanged', () => {
    const other = {
      name: 'some_other_page',
      label: 'Other',
      regions: [{ name: 'header', components: [{ type: 'page:header', properties: { title: 'Other' } }] }],
    };
    const out = translatePage(other, bundle, { locale: 'zh-CN' });
    expect(out.label).toBe('Other');
    expect(out.regions[0].components[0].properties.title).toBe('Other');
  });

  it('does not mutate the input page', () => {
    const snapshot = JSON.parse(JSON.stringify(page));
    translatePage(page, bundle, { locale: 'zh-CN' });
    expect(page).toEqual(snapshot);
  });

  it('falls back to literal copy when no bundle is present', () => {
    const out = translatePage(page, undefined, { locale: 'zh-CN' });
    expect(out.label).toBe('Connect an Agent');
    expect(out.regions[0].components[0].properties.title).toBe('Connect an Agent');
  });

  it('handles pages with no regions', () => {
    const bare = { name: 'connect_agent', label: 'Connect an Agent' };
    const out = translatePage(bare, bundle, { locale: 'zh-CN' });
    expect(out.label).toBe('连接智能体');
    expect(out).not.toHaveProperty('regions');
  });

  it('works through translateMetadataDocument with page type', () => {
    const out = translateMetadataDocument('page', page, bundle, { locale: 'zh-CN' });
    expect(out.regions[0].components[0].properties.title).toBe('连接智能体');
  });

  it('falls back through the BCP-47 locale chain (zh → zh-CN)', () => {
    const out = translatePage(page, bundle, { locale: 'zh' });
    expect(out.label).toBe('连接智能体');
  });
});

describe('TranslationDataSchema pages', () => {
  it('accepts a fully-populated pages entry', () => {
    const data = TranslationDataSchema.parse({
      pages: {
        connect_agent: {
          label: '连接智能体',
          description: '为 MCP 客户端授予访问权限',
          title: '连接智能体',
          subtitle: '每次调用都在调用者自身的权限范围内执行。',
        },
      },
    });
    expect(data.pages?.connect_agent?.title).toBe('连接智能体');
    expect(data.pages?.connect_agent?.subtitle).toBe('每次调用都在调用者自身的权限范围内执行。');
  });

  it('all pages fields are optional', () => {
    expect(() => TranslationDataSchema.parse({ pages: {} })).not.toThrow();
    expect(() => TranslationDataSchema.parse({ pages: { connect_agent: {} } })).not.toThrow();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// translateObject — built-in system-field label fallback
// ────────────────────────────────────────────────────────────────────────────

import { translateObject } from './i18n-resolver';

describe('translateObject system-field label fallback', () => {
  const contract = {
    name: 'contracts',
    label: 'Contract',
    fields: {
      title: { name: 'title', type: 'text', label: '合同名称' },
      owner_id: { name: 'owner_id', type: 'lookup', label: 'Owner' },
      created_at: { name: 'created_at', type: 'datetime', label: 'Created At' },
      created_by: { name: 'created_by', type: 'lookup', label: 'Created By' },
      updated_at: { name: 'updated_at', type: 'datetime', label: 'Last Modified At' },
      updated_by: { name: 'updated_by', type: 'lookup', label: 'Last Modified By' },
    },
  };

  it('localizes injected system-field labels even without a bundle', () => {
    const out = translateObject(contract, undefined, { locale: 'zh-CN' });
    const fields = out.fields as Record<string, any>;
    expect(fields.owner_id.label).toBe('所有者');
    expect(fields.created_at.label).toBe('创建时间');
    expect(fields.created_by.label).toBe('创建人');
    expect(fields.updated_at.label).toBe('更新时间');
    expect(fields.updated_by.label).toBe('更新人');
    // Authored labels stay untouched.
    expect(fields.title.label).toBe('合同名称');
    // Input not mutated.
    expect((contract.fields as any).owner_id.label).toBe('Owner');
  });

  it('applies BCP-47 fallback for base-language and variant locales', () => {
    const zh = translateObject(contract, undefined, { locale: 'zh' });
    expect((zh.fields as any).owner_id.label).toBe('所有者');
    const ja = translateObject(contract, undefined, { locale: 'ja' });
    expect((ja.fields as any).created_by.label).toBe('作成者');
  });

  it('keeps English labels for en and unknown locales', () => {
    const en = translateObject(contract, undefined, { locale: 'en' });
    expect((en.fields as any).owner_id.label).toBe('Owner');
    const fr = translateObject(contract, undefined, { locale: 'fr-FR', fallbackChain: [] });
    expect((fr.fields as any).owner_id.label).toBe('Owner');
  });

  it('never overrides an author-customized system-field label', () => {
    const custom = {
      name: 'contracts',
      fields: { owner_id: { name: 'owner_id', type: 'lookup', label: '负责人' } },
    };
    const out = translateObject(custom, undefined, { locale: 'zh-CN' });
    expect((out.fields as any).owner_id.label).toBe('负责人');
  });

  it('prefers an explicit bundle entry over the built-in fallback', () => {
    const withBundle: TranslationBundle = {
      'zh-CN': {
        objects: {
          contracts: { fields: { owner_id: { label: '合同负责人' } } },
        },
      } as any,
    };
    const out = translateObject(contract, withBundle, { locale: 'zh-CN' });
    expect((out.fields as any).owner_id.label).toBe('合同负责人');
  });

  it('handles the array field shape', () => {
    const arrayDoc = {
      name: 'contracts',
      fields: [{ name: 'owner_id', type: 'lookup', label: 'Owner' }],
    };
    const out = translateObject(arrayDoc, undefined, { locale: 'zh-CN' });
    expect((out.fields as any)[0].label).toBe('所有者');
  });
});

describe('translateObject inline actions (objectstack#3370)', () => {
  // The `sys_approval_request` shape: decision actions declared inline on the
  // object. The plugin ships `_actions` translations for them, but the object
  // document used to go out with the English literals regardless of locale —
  // so anything that was not the Console (which re-resolves labels client-side
  // against its own bundle) rendered Approve / Reject in a zh-CN workspace.
  const approvalRequest = {
    name: 'sys_approval_request',
    label: 'Approval Request',
    actions: [
      { name: 'approval_approve', label: 'Approve', successMessage: 'Approved.' },
      { name: 'approval_reject', label: 'Reject', confirmText: 'Reject this request?' },
      { name: 'approval_remind', label: 'Send reminder' },
    ],
  };

  const bundle = {
    'zh-CN': {
      objects: {
        sys_approval_request: {
          label: '审批请求',
          _actions: {
            approval_approve: { label: '通过', successMessage: '已通过。' },
            approval_reject: { label: '拒绝', confirmText: '拒绝该请求？' },
          },
        },
      },
    },
  };

  it('translates inline action labels and copy', () => {
    const out = translateObject(approvalRequest, bundle, { locale: 'zh-CN' });
    const actions = out.actions as any[];

    expect(actions[0].label).toBe('通过');
    expect(actions[0].successMessage).toBe('已通过。');
    expect(actions[1].label).toBe('拒绝');
    expect(actions[1].confirmText).toBe('拒绝该请求？');
  });

  it('falls back to the authored literal for an untranslated action', () => {
    const out = translateObject(approvalRequest, bundle, { locale: 'zh-CN' });
    expect((out.actions as any[])[2].label).toBe('Send reminder');
  });

  it('does not stamp a synthetic objectName onto inline actions', () => {
    // The lookup needs the declaring object's name; the response should not
    // grow a field the document never carried.
    const out = translateObject(approvalRequest, bundle, { locale: 'zh-CN' });
    for (const action of out.actions as any[]) {
      expect(Object.hasOwn(action, 'objectName')).toBe(false);
    }
  });

  it('leaves the input document unmutated', () => {
    translateObject(approvalRequest, bundle, { locale: 'zh-CN' });
    expect(approvalRequest.actions[0].label).toBe('Approve');
  });

  it('honours an action that names its own object', () => {
    const doc = {
      name: 'sys_approval_request',
      actions: [{ name: 'approval_approve', label: 'Approve', objectName: 'sys_approval_request' }],
    };
    const out = translateObject(doc, bundle, { locale: 'zh-CN' });
    expect((out.actions as any[])[0].label).toBe('通过');
    expect((out.actions as any[])[0].objectName).toBe('sys_approval_request');
  });

  it('passes objects through untouched when they declare no actions', () => {
    const out = translateObject({ name: 'sys_approval_request', label: 'Approval Request' }, bundle, {
      locale: 'zh-CN',
    });
    expect(out.label).toBe('审批请求');
    expect(Object.hasOwn(out, 'actions')).toBe(false);
  });
});

// ==========================================
// resolveObjectFieldLabels — the `/i18n/labels/:object/:locale` body
// ==========================================

describe('resolveObjectFieldLabels (objectstack#3833)', () => {
  const data = TranslationDataSchema.parse({
    objects: {
      contact: {
        label: 'Contact',
        fields: {
          first_name: { label: 'First Name' },
          email: { label: 'Email', help: 'Primary address' },
          phone: { help: 'Mobile preferred' },
        },
      },
    },
    messages: { save: 'Save' },
  });

  it('enumerates the labels a locale actually translates', () => {
    expect(resolveObjectFieldLabels(data, 'contact')).toEqual({
      first_name: 'First Name',
      email: 'Email',
    });
  });

  it('omits fields carrying no label rather than emitting a blank one', () => {
    // Partial translation is the normal state (see ObjectTranslationDataSchema),
    // and callers merge this over their source labels — a '' would erase them.
    expect(resolveObjectFieldLabels(data, 'contact')).not.toHaveProperty('phone');
  });

  it('returns {} for an untranslated object, a bundle with no objects, and no bundle', () => {
    expect(resolveObjectFieldLabels(data, 'account')).toEqual({});
    expect(resolveObjectFieldLabels({ messages: { save: 'Save' } }, 'contact')).toEqual({});
    expect(resolveObjectFieldLabels(undefined, 'contact')).toEqual({});
  });

  it('never matches the retired flat `o.<object>.fields.<field>` dialect', () => {
    // The shape the dispatcher scanned for until #3833. It is not a bundle
    // any producer writes, and reading it as one is what returned {} in
    // production while a test built on the same fiction stayed green.
    const flat = {
      'o.contact.fields.first_name': 'First Name',
      'o.contact.label': 'Contact',
    } as unknown as Parameters<typeof resolveObjectFieldLabels>[0];
    expect(resolveObjectFieldLabels(flat, 'contact')).toEqual({});
  });
});

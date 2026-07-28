import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  TranslationDataSchema,
  TranslationBundleSchema,
  LocaleSchema,
  FieldTranslationSchema,
  ObjectTranslationDataSchema,
  TranslationConfigSchema,
  TranslationItemSchema,
  defineTranslation,
  TranslationDiffStatusSchema,
  TranslationDiffItemSchema,
  TranslationCoverageResultSchema,
  CoverageBreakdownEntrySchema,
  type TranslationBundle,
  type ObjectTranslationData,
  type TranslationConfig,
  type TranslationItem,
  type TranslationDiffItem,
  type TranslationCoverageResult,
  type CoverageBreakdownEntry,
} from './translation.zod';

describe('LocaleSchema', () => {
  it('should accept valid locale strings', () => {
    const validLocales = ['en-US', 'zh-CN', 'es-ES', 'fr-FR', 'de-DE', 'ja-JP'];

    validLocales.forEach(locale => {
      expect(() => LocaleSchema.parse(locale)).not.toThrow();
    });
  });

  it('should accept simple language codes', () => {
    const locales = ['en', 'zh', 'es', 'fr', 'de'];

    locales.forEach(locale => {
      expect(() => LocaleSchema.parse(locale)).not.toThrow();
    });
  });
});

describe('TranslationDataSchema', () => {
  it('should accept empty translation data', () => {
    const data = TranslationDataSchema.parse({});

    expect(data).toBeDefined();
  });

  it('should accept object translations', () => {
    const data = TranslationDataSchema.parse({
      objects: {
        account: {
          label: 'Account',
          pluralLabel: 'Accounts',
        },
      },
    });

    expect(data.objects?.account.label).toBe('Account');
  });

  it('should accept field translations', () => {
    const data = TranslationDataSchema.parse({
      objects: {
        account: {
          label: 'Account',
          fields: {
            name: {
              label: 'Account Name',
              help: 'Enter the name of the account',
            },
            status: {
              label: 'Status',
              options: {
                active: 'Active',
                inactive: 'Inactive',
              },
            },
          },
        },
      },
    });

    expect(data.objects?.account.fields?.name.label).toBe('Account Name');
    expect(data.objects?.account.fields?.status.options?.active).toBe('Active');
  });

  it('should accept app translations', () => {
    const data = TranslationDataSchema.parse({
      apps: {
        sales: {
          label: 'Sales',
          description: 'Manage your sales pipeline',
        },
      },
    });

    expect(data.apps?.sales.label).toBe('Sales');
  });

  it('should accept message translations', () => {
    const data = TranslationDataSchema.parse({
      messages: {
        'common.save': 'Save',
        'common.cancel': 'Cancel',
        'error.required': 'This field is required',
      },
    });

    expect(data.messages?.['common.save']).toBe('Save');
  });

  it('should accept complete translation data', () => {
    const data = TranslationDataSchema.parse({
      objects: {
        account: {
          label: 'Account',
          pluralLabel: 'Accounts',
          fields: {
            name: {
              label: 'Name',
            },
          },
        },
      },
      apps: {
        sales: {
          label: 'Sales',
        },
      },
      messages: {
        'common.save': 'Save',
      },
    });

    expect(data.objects).toBeDefined();
    expect(data.apps).toBeDefined();
    expect(data.messages).toBeDefined();
  });
});

describe('TranslationBundleSchema', () => {
  it('should accept valid translation bundle', () => {
    const bundle: TranslationBundle = {
      'en-US': {
        objects: {
          account: {
            label: 'Account',
            pluralLabel: 'Accounts',
          },
        },
      },
    };

    expect(() => TranslationBundleSchema.parse(bundle)).not.toThrow();
  });

  it('should accept multi-language bundle', () => {
    const bundle = TranslationBundleSchema.parse({
      'en-US': {
        objects: {
          account: {
            label: 'Account',
          },
        },
        messages: {
          'common.save': 'Save',
        },
      },
      'zh-CN': {
        objects: {
          account: {
            label: '客户',
          },
        },
        messages: {
          'common.save': '保存',
        },
      },
    });

    expect(bundle['en-US'].objects?.account.label).toBe('Account');
    expect(bundle['zh-CN'].objects?.account.label).toBe('客户');
  });

  it('should handle English translations', () => {
    const bundle = TranslationBundleSchema.parse({
      'en-US': {
        objects: {
          account: {
            label: 'Account',
            pluralLabel: 'Accounts',
            fields: {
              name: {
                label: 'Account Name',
                help: 'The name of the account',
              },
              type: {
                label: 'Type',
                options: {
                  customer: 'Customer',
                  partner: 'Partner',
                  vendor: 'Vendor',
                },
              },
            },
          },
        },
        apps: {
          sales: {
            label: 'Sales',
            description: 'Manage your sales pipeline',
          },
        },
        messages: {
          'common.save': 'Save',
          'common.cancel': 'Cancel',
          'common.delete': 'Delete',
        },
      },
    });

    expect(bundle['en-US'].objects?.account.label).toBe('Account');
  });

  it('should handle Chinese translations', () => {
    const bundle = TranslationBundleSchema.parse({
      'zh-CN': {
        objects: {
          account: {
            label: '客户',
            pluralLabel: '客户',
            fields: {
              name: {
                label: '客户名称',
                help: '输入客户名称',
              },
            },
          },
        },
        messages: {
          'common.save': '保存',
          'common.cancel': '取消',
        },
      },
    });

    expect(bundle['zh-CN'].objects?.account.label).toBe('客户');
  });

  it('should handle Spanish translations', () => {
    const bundle = TranslationBundleSchema.parse({
      'es-ES': {
        objects: {
          account: {
            label: 'Cuenta',
            pluralLabel: 'Cuentas',
          },
        },
        messages: {
          'common.save': 'Guardar',
          'common.cancel': 'Cancelar',
        },
      },
    });

    expect(bundle['es-ES'].objects?.account.label).toBe('Cuenta');
  });

  it('should handle field option translations', () => {
    const bundle = TranslationBundleSchema.parse({
      'en-US': {
        objects: {
          opportunity: {
            label: 'Opportunity',
            fields: {
              stage: {
                label: 'Stage',
                options: {
                  prospecting: 'Prospecting',
                  qualification: 'Qualification',
                  proposal: 'Proposal',
                  closed_won: 'Closed Won',
                  closed_lost: 'Closed Lost',
                },
              },
            },
          },
        },
      },
      'zh-CN': {
        objects: {
          opportunity: {
            label: '商机',
            fields: {
              stage: {
                label: '阶段',
                options: {
                  prospecting: '寻找客户',
                  qualification: '资格审查',
                  proposal: '提案',
                  closed_won: '成交',
                  closed_lost: '失败',
                },
              },
            },
          },
        },
      },
    });

    expect(bundle['en-US'].objects?.opportunity.fields?.stage.options?.prospecting).toBe('Prospecting');
    expect(bundle['zh-CN'].objects?.opportunity.fields?.stage.options?.prospecting).toBe('寻找客户');
  });

  it('should handle app menu translations', () => {
    const bundle = TranslationBundleSchema.parse({
      'en-US': {
        apps: {
          sales: {
            label: 'Sales',
            description: 'Manage your sales pipeline and opportunities',
          },
          service: {
            label: 'Service',
            description: 'Handle customer support cases',
          },
        },
      },
      'fr-FR': {
        apps: {
          sales: {
            label: 'Ventes',
            description: 'Gérez votre pipeline de ventes',
          },
          service: {
            label: 'Service',
            description: 'Gérez les cas de support client',
          },
        },
      },
    });

    expect(bundle['en-US'].apps?.sales.label).toBe('Sales');
    expect(bundle['fr-FR'].apps?.sales.label).toBe('Ventes');
  });

  it('should handle UI message translations', () => {
    const bundle = TranslationBundleSchema.parse({
      'en-US': {
        messages: {
          'error.required': 'This field is required',
          'error.invalid_email': 'Invalid email address',
          'success.saved': 'Successfully saved',
          'confirm.delete': 'Are you sure you want to delete this record?',
        },
      },
      'de-DE': {
        messages: {
          'error.required': 'Dieses Feld ist erforderlich',
          'error.invalid_email': 'Ungültige E-Mail-Adresse',
          'success.saved': 'Erfolgreich gespeichert',
          'confirm.delete': 'Möchten Sie diesen Datensatz wirklich löschen?',
        },
      },
    });

    expect(bundle['en-US'].messages?.['error.required']).toBe('This field is required');
    expect(bundle['de-DE'].messages?.['error.required']).toBe('Dieses Feld ist erforderlich');
  });

  it('should accept empty locale data', () => {
    const bundle = TranslationBundleSchema.parse({
      'en-US': {},
      'zh-CN': {},
    });

    expect(bundle['en-US']).toBeDefined();
    expect(bundle['zh-CN']).toBeDefined();
  });

  it('should handle partial translations', () => {
    const bundle = TranslationBundleSchema.parse({
      'en-US': {
        objects: {
          account: {
            label: 'Account',
          },
        },
        messages: {
          'common.save': 'Save',
        },
      },
      'zh-CN': {
        objects: {
          account: {
            label: '客户',
          },
        },
        // messages not translated yet
      },
    });

    expect(bundle['zh-CN'].objects?.account.label).toBe('客户');
    expect(bundle['zh-CN'].messages).toBeUndefined();
  });
});

// ============================================================================
// Protocol Improvement Tests: Translation validationMessages
// ============================================================================

describe('TranslationDataSchema - validationMessages', () => {
  it('should accept translation data with validationMessages', () => {
    const data = TranslationDataSchema.parse({
      validationMessages: {
        'discount_limit': 'Discount cannot exceed 40%',
        'amount_required': 'Amount is required for closed deals',
      },
    });
    expect(data.validationMessages?.['discount_limit']).toBe('Discount cannot exceed 40%');
    expect(data.validationMessages?.['amount_required']).toBe('Amount is required for closed deals');
  });

  it('should accept Chinese validation messages', () => {
    const bundle = TranslationBundleSchema.parse({
      'zh-CN': {
        validationMessages: {
          'discount_limit': '折扣不能超过40%',
          'end_date_check': '结束日期必须大于开始日期',
        },
      },
    });
    expect(bundle['zh-CN'].validationMessages?.['discount_limit']).toBe('折扣不能超过40%');
  });

  it('should accept translation data without validationMessages (optional)', () => {
    const data = TranslationDataSchema.parse({
      messages: { 'save': 'Save' },
    });
    expect(data.validationMessages).toBeUndefined();
  });
});

// ============================================================================
// FieldTranslationSchema
// ============================================================================

describe('FieldTranslationSchema', () => {
  it('should accept label only', () => {
    const result = FieldTranslationSchema.parse({ label: 'Account Name' });
    expect(result.label).toBe('Account Name');
    expect(result.help).toBeUndefined();
    expect(result.options).toBeUndefined();
  });

  it('should accept label with help text', () => {
    const result = FieldTranslationSchema.parse({
      label: 'Industry',
      help: 'Select the primary industry',
    });
    expect(result.help).toBe('Select the primary industry');
  });

  it('should accept field with options', () => {
    const result = FieldTranslationSchema.parse({
      label: 'Status',
      options: { active: 'Active', inactive: 'Inactive' },
    });
    expect(result.options?.active).toBe('Active');
  });

  it('should accept empty object', () => {
    const result = FieldTranslationSchema.parse({});
    expect(result).toBeDefined();
  });

  it('should accept field with placeholder', () => {
    const result = FieldTranslationSchema.parse({
      label: 'Email',
      placeholder: 'Enter your email address',
    });
    expect(result.placeholder).toBe('Enter your email address');
  });

  it('should accept field with all properties including placeholder', () => {
    const result = FieldTranslationSchema.parse({
      label: '邮箱',
      help: '输入您的电子邮箱地址',
      placeholder: '例如：user@example.com',
      options: { work: '工作邮箱', personal: '个人邮箱' },
    });
    expect(result.label).toBe('邮箱');
    expect(result.placeholder).toBe('例如：user@example.com');
  });
});

// ============================================================================
// ObjectTranslationDataSchema — per-object file validation
// ============================================================================

describe('ObjectTranslationDataSchema', () => {
  it('should accept minimal object translation', () => {
    const data: ObjectTranslationData = {
      label: 'Account',
    };
    const result = ObjectTranslationDataSchema.parse(data);
    expect(result.label).toBe('Account');
    expect(result.pluralLabel).toBeUndefined();
    expect(result.fields).toBeUndefined();
  });

  it('should accept full object translation (en/account.json)', () => {
    const data = ObjectTranslationDataSchema.parse({
      label: 'Account',
      pluralLabel: 'Accounts',
      fields: {
        name: { label: 'Account Name', help: 'Legal name of the company' },
        type: {
          label: 'Type',
          options: { customer: 'Customer', partner: 'Partner', vendor: 'Vendor' },
        },
        industry: { label: 'Industry' },
      },
    });
    expect(data.label).toBe('Account');
    expect(data.pluralLabel).toBe('Accounts');
    expect(data.fields?.name.label).toBe('Account Name');
    expect(data.fields?.type.options?.customer).toBe('Customer');
  });

  it('should accept Chinese object translation (zh-CN/account.json)', () => {
    const data = ObjectTranslationDataSchema.parse({
      label: '客户',
      pluralLabel: '客户',
      fields: {
        name: { label: '客户名称', help: '公司或组织的法定名称' },
        type: {
          label: '类型',
          options: { customer: '正式客户', partner: '合作伙伴' },
        },
      },
    });
    expect(data.label).toBe('客户');
    expect(data.fields?.name.help).toBe('公司或组织的法定名称');
  });

  it('should accept a partial object translation with no label', () => {
    // Partial translation is the normal state — see the schema's note on why
    // `label` is optional.
    const data = ObjectTranslationDataSchema.parse({
      fields: { name: { label: 'Account Name' } },
    });
    expect(data.label).toBeUndefined();
    expect(data.fields?.name.label).toBe('Account Name');
  });

  it('should compose into TranslationDataSchema via objects record', () => {
    const localeData = TranslationDataSchema.parse({
      objects: {
        account: { label: 'Account', pluralLabel: 'Accounts' },
        contact: { label: 'Contact' },
      },
    });
    expect(localeData.objects?.account.label).toBe('Account');
    expect(localeData.objects?.contact.label).toBe('Contact');
  });
});

// ============================================================================
// TranslationConfigSchema
// ============================================================================

describe('TranslationConfigSchema', () => {
  it('should accept minimal config', () => {
    const config: TranslationConfig = TranslationConfigSchema.parse({
      defaultLocale: 'en',
      supportedLocales: ['en'],
    });
    expect(config.defaultLocale).toBe('en');
    expect(config.supportedLocales).toEqual(['en']);
    expect(config.fallbackLocale).toBeUndefined();
  });

  it('should accept full multi-language config', () => {
    const config = TranslationConfigSchema.parse({
      defaultLocale: 'en',
      supportedLocales: ['en', 'zh-CN', 'ja-JP', 'es-ES'],
      fallbackLocale: 'en',
    });
    expect(config.supportedLocales).toHaveLength(4);
    expect(config.fallbackLocale).toBe('en');
  });

  it('should reject config without defaultLocale', () => {
    expect(() =>
      TranslationConfigSchema.parse({
        supportedLocales: ['en'],
      }),
    ).toThrow();
  });

  it('should reject config without supportedLocales', () => {
    expect(() =>
      TranslationConfigSchema.parse({
        defaultLocale: 'en',
      }),
    ).toThrow();
  });
});

// ============================================================================
// TranslationItemSchema — the runtime-authored `translation` metadata type
// ============================================================================

describe('TranslationItemSchema', () => {
  it('should accept a single-locale item in the runtime `objects.` shape', () => {
    const item: TranslationItem = defineTranslation({
      locale: 'zh-CN',
      objects: {
        account: {
          label: '客户',
          fields: { name: { label: '客户名称' } },
          _views: { all_accounts: { label: '全部客户' } },
          _actions: { merge: { label: '合并客户', confirmText: '确认合并？' } },
        },
      },
      apps: { crm: { label: '客户关系管理' } },
      messages: { 'common.save': '保存' },
    });
    expect(item.locale).toBe('zh-CN');
    expect(item.objects?.account.label).toBe('客户');
    expect(item.objects?.account._actions?.merge.confirmText).toBe('确认合并？');
    expect(item.apps?.crm.label).toBe('客户关系管理');
  });

  it('should require a locale — an unresolvable one is silently skipped at runtime', () => {
    const result = TranslationItemSchema.safeParse({
      objects: { account: { label: '客户' } },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path[0] === 'locale')).toBe(true);
  });

  it('should accept a partial item that translates one field and nothing else', () => {
    const item = TranslationItemSchema.parse({
      locale: 'ja-JP',
      objects: { account: { fields: { name: { label: '取引先名' } } } },
    });
    expect(item.objects?.account.label).toBeUndefined();
    expect(item.objects?.account.fields?.name.label).toBe('取引先名');
  });

  it.each([
    ['o', 'objects.<object_name>'],
    ['app', 'apps.<app_name>'],
    ['nav', 'apps.<app_name>.navigation'],
    ['dashboard', 'dashboards.<dashboard_name>'],
    ['_globalOptions', 'objects.<object_name>.fields.<field_name>.options'],
    ['_meta', "top-level 'locale'"],
    ['namespace', 'omit it'],
  ])('should reject the retired object-first key `%s` with an actionable message', (key, hint) => {
    const result = TranslationItemSchema.safeParse({
      locale: 'zh-CN',
      [key]: { account: { label: '客户' } },
    });
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((i) => i.path[0] === key);
    expect(issue).toBeDefined();
    expect(issue?.message).toContain(hint);
  });

  it('should reject the retired shape rather than silently stripping it (#3778)', () => {
    // The pre-fix failure mode: Zod strips undeclared keys, so an `o.`-shaped
    // item saved cleanly and then resolved to nothing. A save that succeeds
    // must be a save that renders.
    const result = TranslationItemSchema.safeParse({
      locale: 'zh-CN',
      o: { account: { label: '客户' } },
    });
    expect(result.success).toBe(false);
  });

  it('should not leak the retired keys into a parsed item', () => {
    const item = TranslationItemSchema.parse({
      locale: 'en',
      objects: { account: { label: 'Account' } },
    });
    expect(Object.keys(item)).toEqual(expect.arrayContaining(['locale', 'objects']));
    for (const key of ['o', 'app', 'nav', 'dashboard', '_meta', 'namespace']) {
      expect(item).not.toHaveProperty(key);
    }
  });

  it('should not advertise the retired keys in its generated JSON Schema', () => {
    // The JSON Schema is what `/meta/types/:type` hands the Studio editor and
    // any agent authoring metadata — listing a retired key there would teach
    // the shape the refinement then rejects.
    for (const io of ['input', 'output'] as const) {
      const json = z.toJSONSchema(TranslationItemSchema, { io, unrepresentable: 'any' }) as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(json.required).toContain('locale');
      expect(Object.keys(json.properties ?? {})).toEqual(
        expect.not.arrayContaining(['o', 'app', 'nav', 'dashboard', '_meta', 'namespace']),
      );
      expect(json.properties).toHaveProperty('objects');
    }
  });

  it('should compose into a TranslationBundle entry (item == one bundle locale)', () => {
    const item = TranslationItemSchema.parse({
      locale: 'zh-CN',
      objects: { account: { label: '客户' } },
    });
    const { locale, ...data } = item;
    const bundle = TranslationBundleSchema.parse({ [locale]: data });
    expect(bundle['zh-CN'].objects?.account.label).toBe('客户');
  });
});

// ============================================================================
// TranslationDiffStatusSchema
// ============================================================================

describe('TranslationDiffStatusSchema', () => {
  it('should accept valid statuses', () => {
    expect(TranslationDiffStatusSchema.parse('missing')).toBe('missing');
    expect(TranslationDiffStatusSchema.parse('redundant')).toBe('redundant');
    expect(TranslationDiffStatusSchema.parse('stale')).toBe('stale');
  });

  it('should reject invalid status', () => {
    expect(() => TranslationDiffStatusSchema.parse('outdated')).toThrow();
  });
});

// ============================================================================
// TranslationDiffItemSchema
// ============================================================================

describe('TranslationDiffItemSchema', () => {
  it('should accept a missing translation diff item', () => {
    const item: TranslationDiffItem = TranslationDiffItemSchema.parse({
      key: 'objects.account.fields.website.label',
      status: 'missing',
      objectName: 'account',
      locale: 'zh-CN',
    });
    expect(item.key).toBe('objects.account.fields.website.label');
    expect(item.status).toBe('missing');
    expect(item.objectName).toBe('account');
    expect(item.locale).toBe('zh-CN');
  });

  it('should accept a redundant diff item without objectName', () => {
    const item = TranslationDiffItemSchema.parse({
      key: 'messages.old_key',
      status: 'redundant',
      locale: 'en',
    });
    expect(item.objectName).toBeUndefined();
    expect(item.status).toBe('redundant');
  });

  it('should accept a stale diff item', () => {
    const item = TranslationDiffItemSchema.parse({
      key: 'objects.contact.label',
      status: 'stale',
      objectName: 'contact',
      locale: 'ja',
    });
    expect(item.status).toBe('stale');
  });

  it('should reject diff item without key', () => {
    expect(() =>
      TranslationDiffItemSchema.parse({ status: 'missing', locale: 'en' }),
    ).toThrow();
  });

  it('should accept diff item with sourceHash', () => {
    const item = TranslationDiffItemSchema.parse({
      key: 'objects.account.label',
      status: 'stale',
      locale: 'zh-CN',
      sourceHash: 'sha256:abc123',
    });
    expect(item.sourceHash).toBe('sha256:abc123');
  });

  it('should accept diff item with AI suggestion fields', () => {
    const item: TranslationDiffItem = TranslationDiffItemSchema.parse({
      key: 'objects.account.fields.website.label',
      status: 'missing',
      locale: 'zh-CN',
      aiSuggested: '网站',
      aiConfidence: 0.92,
    });
    expect(item.aiSuggested).toBe('网站');
    expect(item.aiConfidence).toBe(0.92);
  });

  it('should reject AI confidence above 1', () => {
    expect(() =>
      TranslationDiffItemSchema.parse({
        key: 'objects.account.label',
        status: 'missing',
        locale: 'en',
        aiConfidence: 1.5,
      }),
    ).toThrow();
  });

  it('should reject AI confidence below 0', () => {
    expect(() =>
      TranslationDiffItemSchema.parse({
        key: 'objects.account.label',
        status: 'missing',
        locale: 'en',
        aiConfidence: -0.1,
      }),
    ).toThrow();
  });
});

// ============================================================================
// TranslationCoverageResultSchema
// ============================================================================

describe('TranslationCoverageResultSchema', () => {
  it('should accept a full coverage result', () => {
    const result: TranslationCoverageResult = TranslationCoverageResultSchema.parse({
      locale: 'zh-CN',
      totalKeys: 120,
      translatedKeys: 105,
      missingKeys: 12,
      redundantKeys: 3,
      staleKeys: 0,
      coveragePercent: 87.5,
      items: [
        { key: 'objects.account.fields.website.label', status: 'missing', objectName: 'account', locale: 'zh-CN' },
        { key: 'messages.old_key', status: 'redundant', locale: 'zh-CN' },
      ],
    });

    expect(result.locale).toBe('zh-CN');
    expect(result.totalKeys).toBe(120);
    expect(result.translatedKeys).toBe(105);
    expect(result.missingKeys).toBe(12);
    expect(result.redundantKeys).toBe(3);
    expect(result.staleKeys).toBe(0);
    expect(result.coveragePercent).toBe(87.5);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].status).toBe('missing');
  });

  it('should accept a scoped coverage result for a single object', () => {
    const result = TranslationCoverageResultSchema.parse({
      locale: 'de',
      objectName: 'account',
      totalKeys: 15,
      translatedKeys: 15,
      missingKeys: 0,
      redundantKeys: 0,
      staleKeys: 0,
      coveragePercent: 100,
      items: [],
    });

    expect(result.objectName).toBe('account');
    expect(result.coveragePercent).toBe(100);
    expect(result.items).toHaveLength(0);
  });

  it('should reject result with negative counts', () => {
    expect(() =>
      TranslationCoverageResultSchema.parse({
        locale: 'en',
        totalKeys: -1,
        translatedKeys: 0,
        missingKeys: 0,
        redundantKeys: 0,
        staleKeys: 0,
        coveragePercent: 0,
        items: [],
      }),
    ).toThrow();
  });

  it('should reject result with coverage percent above 100', () => {
    expect(() =>
      TranslationCoverageResultSchema.parse({
        locale: 'en',
        totalKeys: 10,
        translatedKeys: 10,
        missingKeys: 0,
        redundantKeys: 0,
        staleKeys: 0,
        coveragePercent: 101,
        items: [],
      }),
    ).toThrow();
  });

  it('should accept result with breakdown', () => {
    const result: TranslationCoverageResult = TranslationCoverageResultSchema.parse({
      locale: 'zh-CN',
      totalKeys: 100,
      translatedKeys: 80,
      missingKeys: 20,
      redundantKeys: 0,
      staleKeys: 0,
      coveragePercent: 80,
      items: [],
      breakdown: [
        { group: 'fields', totalKeys: 60, translatedKeys: 50, coveragePercent: 83.3 },
        { group: 'views', totalKeys: 20, translatedKeys: 15, coveragePercent: 75 },
        { group: 'actions', totalKeys: 10, translatedKeys: 10, coveragePercent: 100 },
        { group: 'messages', totalKeys: 10, translatedKeys: 5, coveragePercent: 50 },
      ],
    });
    expect(result.breakdown).toHaveLength(4);
    expect(result.breakdown![0].group).toBe('fields');
    expect(result.breakdown![0].coveragePercent).toBe(83.3);
    expect(result.breakdown![2].coveragePercent).toBe(100);
  });

  it('should accept result without breakdown (optional)', () => {
    const result = TranslationCoverageResultSchema.parse({
      locale: 'en',
      totalKeys: 10,
      translatedKeys: 10,
      missingKeys: 0,
      redundantKeys: 0,
      staleKeys: 0,
      coveragePercent: 100,
      items: [],
    });
    expect(result.breakdown).toBeUndefined();
  });
});

// ============================================================================
// CoverageBreakdownEntrySchema
// ============================================================================

describe('CoverageBreakdownEntrySchema', () => {
  it('should accept a valid breakdown entry', () => {
    const entry: CoverageBreakdownEntry = CoverageBreakdownEntrySchema.parse({
      group: 'fields',
      totalKeys: 50,
      translatedKeys: 45,
      coveragePercent: 90,
    });
    expect(entry.group).toBe('fields');
    expect(entry.totalKeys).toBe(50);
    expect(entry.translatedKeys).toBe(45);
    expect(entry.coveragePercent).toBe(90);
  });

  it('should reject breakdown entry with negative totalKeys', () => {
    expect(() =>
      CoverageBreakdownEntrySchema.parse({
        group: 'fields',
        totalKeys: -1,
        translatedKeys: 0,
        coveragePercent: 0,
      }),
    ).toThrow();
  });

  it('should reject breakdown entry with coverage above 100', () => {
    expect(() =>
      CoverageBreakdownEntrySchema.parse({
        group: 'fields',
        totalKeys: 10,
        translatedKeys: 10,
        coveragePercent: 101,
      }),
    ).toThrow();
  });
});

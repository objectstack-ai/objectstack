import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { PAGE_COMPONENT_COPY_KEYS } from './i18n-resolver';
import { FlowSchema } from '../automation/flow.zod';
import { ScreenConfigSchema, ScreenFieldConfigSchema } from '../automation/builtin-node-config.zod';
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
// Translation validationMessages — RETIRED in 17.0.0 (#4667)
// ============================================================================
//
// This block used to assert the group parsed at both doors. It was never read
// by any resolver, so a translated rule message was stored and never shown;
// the rejection now lives in the "retired translation.validationMessages"
// describe at the bottom of this file. Validation messages are authored on the
// rule itself (`object.validations[].message`).

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
    // The prescriptions used to come from a bespoke `z.preprocess` that scanned
    // for these ten keys; since #4001 they ride the strict unknown-key error as
    // `guidance`, so the issue is `unrecognized_keys` naming the key rather than
    // a custom issue at `path: [key]`. The message is what an author reads, and
    // it still has to carry the destination.
    const issue = result.error?.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue).toBeDefined();
    expect((issue as { keys?: string[] } | undefined)?.keys).toContain(key);
    expect(issue?.message).toContain(hint);
  });

  it('should not offer `app` → `apps` as a rename — the inner shapes differ', () => {
    // Edit distance 1, so without a `guidance` entry the suggester would call
    // this a typo. It is not: the object-first `app.<object>` and the current
    // `apps.<app_name>` hold different content, so the fix is a rewrite. A
    // guidance entry suppresses the rename, which is the point of having one.
    const result = TranslationItemSchema.safeParse({ locale: 'en', app: { account: { label: 'Account' } } });
    expect(result.success).toBe(false);
    const message = result.error?.issues.find((i) => i.code === 'unrecognized_keys')?.message ?? '';
    expect(message).not.toContain('Did you mean');
    expect(message).toContain('apps.<app_name>');
  });

  it('should reject an unknown key the retired-key list never named (#4001)', () => {
    // What the #3778 guard could not do. It enumerated ten keys someone had
    // thought of; `object` for `objects` was not one of them, and a bundle
    // written that way saved clean and resolved to nothing.
    const result = TranslationItemSchema.safeParse({
      locale: 'zh-CN',
      object: { account: { label: '客户' } },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.find((i) => i.code === 'unrecognized_keys')?.message)
      .toContain('`object` → `objects`');
  });

  it('should round-trip its own identity keys (the Studio create seed sends both)', () => {
    // `metadata-create-seeds.ts` ships `{ name, label, locale, objects }` as the
    // authoritative minimal create shape, and its test asserts every seed is
    // spec-valid — the canonical guard for "designer create shape ≠ spec".
    // That guard could only ever catch a MISSING required key: an extra key the
    // schema did not declare was stripped, so the seed validated while two
    // thirds of it was being thrown away. Closing the shape made it fail, which
    // is the guard finally working in both directions.
    const item = TranslationItemSchema.parse({ name: 'zh-CN', label: '简体中文', locale: 'zh-CN' });
    expect(item.name).toBe('zh-CN');
    expect(item.label).toBe('简体中文');
  });

  it('should declare the ADR-0010 protection envelope', () => {
    // The loader stamps these on every registered type; undeclared, they were
    // dropped on each parse, and `authored-translation-sync` strips them by
    // hand on the read side because the schema could not hold them.
    const item = TranslationItemSchema.parse({
      locale: 'en',
      objects: { account: { label: 'Account' } },
      _packageId: 'com.example.pkg',
      _provenance: 'package',
      _lock: 'no-overlay',
    });
    expect(item._packageId).toBe('com.example.pkg');
    expect(item._lock).toBe('no-overlay');
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
// Unknown-key strictness across the translation groups (#4001)
// ============================================================================

describe('translation unknown-key strictness (#4001)', () => {
  // The failure this file is closing is unusually cruel: a translation that
  // resolves to nothing is indistinguishable from a translation nobody wrote.
  // There is no wrong string on screen to notice — just the source language,
  // forever, exactly as if the key were still on the backlog.

  it('rejects a retired key on the file-authored BUNDLE path, which the guard never covered', () => {
    // #3778's `z.preprocess` ran on the item door only. The examples and the
    // platform apps author bundles (`defineTranslationBundle`), and the same
    // ten keys were stripped there in silence. Same asymmetry #4522 found in
    // #1535's object guard: closed at one door, open at the other.
    const result = TranslationBundleSchema.safeParse({
      en: { o: { account: { label: 'Account' } } },
    });
    expect(result.success).toBe(false);
    const message = result.error?.issues.find((i) => i.code === 'unrecognized_keys')?.message ?? '';
    expect(message).toContain('objects.<object_name>');
  });

  it.each([
    ['a top-level group', { messsages: { 'common.save': 'Save' } }, 'messages'],
    ['an app translation', { apps: { crm: { label: 'CRM', nagivation: {} } } }, 'navigation'],
    ['a page translation', { pages: { home: { subtitel: 'Welcome' } } }, 'subtitle'],
    ['a dashboard widget', { dashboards: { sales: { widgets: { rev: { titel: 'Revenue' } } } } }, 'title'],
    ['a settings key', { settings: { mail: { keys: { host: { lable: 'Host' } } } } }, 'label'],
    ['a metadata form field', { metadataForms: { object: { fields: { name: { helpTxt: 'x' } } } } }, 'helpText'],
  ])('rejects a typo in %s and names the key it meant', (_what, body, expected) => {
    const result = TranslationDataSchema.safeParse(body);
    expect(result.success).toBe(false);
    expect(result.error?.issues.find((i) => i.code === 'unrecognized_keys')?.message)
      .toContain(`→ \`${expected}\``);
  });

  it.each([
    ['object', { objects: { account: { views: {} } } }, '_views'],
    ['object', { objects: { account: { actions: {} } } }, '_actions'],
    ['object', { objects: { account: { sections: {} } } }, '_sections'],
  ])('points the un-prefixed %s group at its `_`-prefixed name', (_what, body, expected) => {
    const result = TranslationDataSchema.safeParse(body);
    expect(result.success).toBe(false);
    expect(result.error?.issues.find((i) => i.code === 'unrecognized_keys')?.message)
      .toContain(`→ \`${expected}\``);
  });

  it('sends `help` on an action param to `helpText`, the spelling that surface uses', () => {
    // `help` is correct on a FIELD translation and on a settings key; on an
    // action param it is `helpText`. Borrowing from a neighbouring surface
    // reads as a real word, not a slip, so edit distance cannot rule on it —
    // this is what the alias tables are for.
    const result = TranslationDataSchema.safeParse({
      globalActions: { export_csv: { params: { format: { help: 'CSV or XLSX' } } } },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.find((i) => i.code === 'unrecognized_keys')?.message)
      .toContain('`help` → `helpText`');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // #6080 — `pages.<name>.components.<id>`, the page half of `dashboards.widgets`
  // ──────────────────────────────────────────────────────────────────────────
  describe('page component copy (#6080)', () => {
    const parse = (components: unknown) =>
      TranslationDataSchema.safeParse({ pages: { sales_home_page: { label: 'Sales', components } } });

    it('accepts the measured key face, keyed by component id', () => {
      const result = parse({
        quick_create: { title: 'Quick Create' },
        kpi_revenue_won: { label: 'Revenue (Won)' },
        ai_briefing: { title: 'Ask the AI', description: 'Open the panel.' },
        lead_picker: { placeholder: 'Search…', emptyText: 'No records' },
        new_lead_form: { submitLabel: 'Create' },
      });
      expect(result.success).toBe(true);
    });

    it('stays `.strict()` — an invented key is still refused', () => {
      const result = parse({ quick_create: { tooltip: 'Create a record' } });
      expect(result.success).toBe(false);
      expect(result.error?.issues.some((i) => i.code === 'unrecognized_keys')).toBe(true);
    });

    it('sends `help` to `description` rather than declaring a key no component has', () => {
      // The issue proposed `help` in this face. No component in
      // `ComponentPropsMap` declares it, so declaring it would parse clean and
      // translate nothing (ADR-0078). It is an alias instead.
      const result = parse({ ai_briefing: { help: 'Open the panel.' } });
      expect(result.success).toBe(false);
      expect(result.error?.issues.find((i) => i.code === 'unrecognized_keys')?.message)
        .toContain('`help` → `description`');
    });

    it('keeps `subtitle` at the page level — one string, one spelling', () => {
      // `page:header` is `subtitle`'s only declarer and is addressed by page
      // name, so a per-component `subtitle` would be a second route to it.
      expect(parse({ some_header: { subtitle: 'Welcome back' } }).success).toBe(false);
      expect(TranslationDataSchema.safeParse({
        pages: { sales_home_page: { subtitle: 'Welcome back' } },
      }).success).toBe(true);
    });

    it('names this surface in the error, not the dashboard widget one', () => {
      const result = parse({ quick_create: { titel: 'Quick Create' } });
      expect(result.error?.issues[0]?.message).toContain('this page component translation');
      expect(result.error?.issues.find((i) => i.code === 'unrecognized_keys')?.message)
        .toContain('→ `title`');
    });

    it('declares exactly the keys the resolver and the extractor act on', () => {
      // `PAGE_COMPONENT_COPY_KEYS` drives both `translatePage`'s overlay and
      // the CLI's skeleton extraction. If this schema declared a key missing
      // from that list the extractor would offer a slot nothing reads; if the
      // list carried one this schema lacks, `.strict()` would reject the very
      // key the extractor just wrote. Pin the two together.
      for (const key of PAGE_COMPONENT_COPY_KEYS) {
        expect(parse({ some_component: { [key]: 'x' } }).success, `\`${key}\` must be declared`).toBe(true);
      }
      const declared = Object.keys(
        (TranslationDataSchema.safeParse({
          pages: { p: { components: { c: Object.fromEntries(PAGE_COMPONENT_COPY_KEYS.map((k) => [k, 'x'])) } } },
        }) as { success: true; data: any }).data.pages.p.components.c,
      ).sort();
      expect(declared).toEqual([...PAGE_COMPONENT_COPY_KEYS].sort());
    });

    it('carries the `label`/`title` trap alias the dashboard widget face carries', () => {
      // A page's headline is `label`; a component's is `title`. One level
      // apart, opposite spellings — the same trap `dashboards.widgets` names.
      const result = parse({ quick_create: { name: 'Quick Create' } });
      expect(result.error?.issues.find((i) => i.code === 'unrecognized_keys')?.message)
        .toContain('`name` → `title`');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // #7646 — `flows.<name>.screens.<nodeId>`, the screen-flow wizard's copy
  // ──────────────────────────────────────────────────────────────────────────
  describe('screen-flow copy (#7646)', () => {
    const parse = (flows: unknown) => TranslationDataSchema.safeParse({ flows });

    it('accepts a fully-populated flow entry', () => {
      const result = parse({
        lead_conversion: {
          label: '转化线索',
          screens: {
            conversion_details: {
              title: '转化详情',
              fields: {
                create_opportunity: { label: '创建商机？' },
                opportunity_name: { label: '商机名称', placeholder: '输入商机名称' },
                opportunity_amount: { label: '商机金额' },
              },
            },
          },
        },
      });
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    });

    it('accepts partial entries at every level — the family\'s partial-locale semantics', () => {
      // Every key on this surface is optional for the same reason
      // `ObjectTranslationDataSchema.label` is: partial translation is the
      // normal state, and requiring a level to be complete would force
      // translators to restate source strings just to pass validation.
      expect(parse({ lead_conversion: {} }).success).toBe(true);
      expect(parse({ lead_conversion: { label: '转化线索' } }).success).toBe(true);
      expect(parse({ lead_conversion: { screens: {} } }).success).toBe(true);
      expect(parse({ lead_conversion: { screens: { s1: {} } } }).success).toBe(true);
      expect(parse({ lead_conversion: { screens: { s1: { fields: { f: {} } } } } }).success).toBe(true);
      // …and one locale of a bundle may carry `flows` while another does not.
      expect(TranslationBundleSchema.safeParse({
        en: {},
        'zh-CN': { flows: { lead_conversion: { screens: { s1: { title: '转化详情' } } } } },
      }).success).toBe(true);
    });

    it('addresses flows/screens/fields by the identifiers the runner resolves against', () => {
      // The trap this pins is declared-but-unresolvable: a translation surface
      // keyed by names nothing produces parses clean and translates nothing.
      // Each level's key is taken from the flow schema itself, and the two
      // inner ones reach the client verbatim on the `ScreenSpec`
      // (`nodeId` / `fields[].name`, contracts/automation-service.ts).
      const flow = FlowSchema.parse({
        name: 'lead_conversion',
        label: 'Convert Lead',
        type: 'screen',
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          {
            id: 'conversion_details',
            type: 'screen',
            label: 'Conversion Details',
            config: {
              title: 'Conversion Details',
              fields: [{ name: 'opportunity_name', label: 'Opportunity Name', placeholder: 'Enter a name' }],
            },
          },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'conversion_details' }],
      });
      const screenNode = flow.nodes.find((n) => n.type === 'screen')!;
      const screenConfig = ScreenConfigSchema.parse(screenNode.config);
      const fieldName = screenConfig.fields![0]!.name;

      const result = parse({
        [flow.name]: {
          label: 'Convert Lead',
          screens: { [screenNode.id]: { title: '转化详情', fields: { [fieldName]: { label: '商机名称' } } } },
        },
      });
      expect(result.success).toBe(true);
    });

    it('stays `.strict()` — an invented key is refused at each of the three levels', () => {
      for (const body of [
        { lead_conversion: { labell: 'x' } },
        { lead_conversion: { screens: { s1: { titel: 'x' } } } },
        { lead_conversion: { screens: { s1: { fields: { f: { lable: 'x' } } } } } },
      ]) {
        const result = parse(body);
        expect(result.success, JSON.stringify(body)).toBe(false);
        expect(result.error?.issues.some((i) => i.code === 'unrecognized_keys')).toBe(true);
      }
    });

    it('carries the `label`/`title` trap alias one level down, as its two siblings do', () => {
      // A flow's headline is `label`; a screen's is `title`. One level apart,
      // opposite spellings — the trap `dashboards.widgets` and
      // `pages.components` both name.
      expect(parse({ lead_conversion: { screens: { s1: { label: 'x' } } } })
        .error?.issues.find((i) => i.code === 'unrecognized_keys')?.message)
        .toContain('`label` → `title`');
      expect(parse({ lead_conversion: { title: 'x' } })
        .error?.issues.find((i) => i.code === 'unrecognized_keys')?.message)
        .toContain('`title` → `label`');
    });

    it('refuses `help` on a screen field rather than declaring a key the field has not got', () => {
      // The report proposed label/placeholder/help. `ScreenFieldConfigSchema`
      // declares nothing help-shaped, so `help` would parse clean and translate
      // nothing (ADR-0078) — and unlike #6080's page-component `help` there is
      // no honest key to alias it to, since `placeholder` is the in-input hint
      // and not help text. It is `guidance` instead.
      const declared = Object.keys((ScreenFieldConfigSchema as unknown as z.ZodObject<z.ZodRawShape>).shape);
      expect(declared).not.toContain('help');
      expect(declared).not.toContain('helpText');
      expect(declared).toContain('label');
      expect(declared).toContain('placeholder');

      const message = parse({ lead_conversion: { screens: { s1: { fields: { f: { help: 'x' } } } } } })
        .error?.issues.find((i) => i.code === 'unrecognized_keys')?.message ?? '';
      expect(message).toContain('a screen field declares no help/hint copy');
      // …and it must not be re-pointed at `placeholder`, which means something else.
      expect(message).not.toContain('`help` → `placeholder`');
    });

    it('says why select-option labels are not translatable here', () => {
      const message = parse({ lead_conversion: { screens: { s1: { fields: { f: { options: {} } } } } } })
        .error?.issues.find((i) => i.code === 'unrecognized_keys')?.message ?? '';
      expect(message).toContain('unconstrained');
    });

    it('keeps runner chrome out of the bundle', () => {
      // Cancel/Submit are the CONSOLE's words in every app; the maintainer
      // ruling on #7646 keeps them in its own message catalog rather than
      // asking each app to re-translate the platform. There is no key for them
      // on any of the three levels.
      expect(parse({ lead_conversion: { submitLabel: 'Submit', cancelLabel: 'Cancel' } }).success).toBe(false);
      expect(parse({ lead_conversion: { screens: { s1: { submitLabel: 'Submit' } } } }).success).toBe(false);
    });

    it('states what the runner applies, and that chrome is not here', () => {
      // The describes are the authoring surface's documentation — the JSON
      // Schema and the generated reference are built from them.
      const json = z.toJSONSchema(TranslationDataSchema as unknown as z.ZodType, { io: 'input' }) as any;
      const flowsNode = json.properties.flows;
      expect(flowsNode.description).toContain('flow name');
      expect(flowsNode.additionalProperties.properties.screens.description).toContain('node id');
      expect(
        flowsNode.additionalProperties.properties.screens.additionalProperties.properties.fields.description,
      ).toContain('field name');
    });

    it('sends a top-level `screens` group down to the flow that owns it', () => {
      // A rename would be wrong: screen copy nests under its flow, so the
      // content has to move, not be re-spelled — the `app`/`apps` distinction
      // the guidance table was built to draw.
      const message = TranslationDataSchema.safeParse({ screens: { s1: { title: 'x' } } })
        .error?.issues.find((i) => i.code === 'unrecognized_keys')?.message ?? '';
      expect(message).toContain('flows.<flow_name>.screens.<node_id>');
      expect(message).not.toContain('`screens` → `flows`');
    });

    it('offers `flow` → `flows` as the rename it actually is', () => {
      expect(TranslationDataSchema.safeParse({ flow: { lead_conversion: {} } })
        .error?.issues.find((i) => i.code === 'unrecognized_keys')?.message)
        .toContain('`flow` → `flows`');
    });

    it('reaches the metadata-item door too, not just the file-authored bundle', () => {
      // #3778's guard closed one door and left the other open; a group added
      // to the shared shape has to land on both by construction.
      const flows = { lead_conversion: { screens: { s1: { title: '转化详情' } } } };
      expect(TranslationItemSchema.safeParse({ locale: 'zh-CN', flows }).success).toBe(true);
      expect(TranslationItemSchema.safeParse({ locale: 'zh-CN', flows: { f: { titel: 'x' } } }).success).toBe(false);
    });
  });

  it('names which action surface the key landed on', () => {
    const onObject = TranslationDataSchema.safeParse({
      objects: { account: { _actions: { merge: { confirm: 'ok?' } } } },
    });
    const onGlobal = TranslationDataSchema.safeParse({
      globalActions: { log_call: { confirm: 'ok?' } },
    });
    expect(onObject.error?.issues[0]?.message).toContain('this object action translation');
    expect(onGlobal.error?.issues[0]?.message).toContain('this global action translation');
  });

  it('still accepts every declared group together', () => {
    // The shape is spread into two schemas (bundle entry + metadata item); this
    // is the guard against closing one of them against a stale key list.
    const body = {
      objects: { account: { label: 'Account', _views: { all: { label: 'All', emptyState: { title: 'None' } } } } },
      apps: { crm: { label: 'CRM', navigation: { sales: { label: 'Sales' } } } },
      messages: { 'common.save': 'Save' },
      globalActions: { export_csv: { label: 'Export', params: { format: { label: 'Format' } } } },
      dashboards: { sales: { label: 'Sales', widgets: { rev: { title: 'Revenue' } } } },
      pages: { home: { label: 'Home', title: 'Welcome' } },
      flows: { lead_conversion: { label: 'Convert Lead', screens: { details: { title: 'Details', fields: { name: { label: 'Name', placeholder: 'Enter a name' } } } } } },
      settings: { mail: { title: 'Mail', keys: { host: { label: 'Host' } } } },
      metadataForms: { object: { label: 'Object', fields: { name: { label: 'Name' } } } },
      settingsCommon: { sourceLabels: { env: 'Env', tenant: 'Tenant' } },
    };
    expect(() => TranslationDataSchema.parse(body)).not.toThrow();
    expect(() => TranslationItemSchema.parse({ locale: 'en', ...body })).not.toThrow();
  });

  it.each(['fileOrganization', 'messageFormat', 'lazyLoad', 'cache'])(
    'tells an author upgrading from <17 where the removed i18n knob `%s` went',
    (key) => {
      // #3494 removed these four because no runtime read them. Removing a key
      // that was already a no-op leaves the author with the same silence and one
      // more reason for it — the tombstone is the only thing that says why.
      const result = TranslationConfigSchema.safeParse({
        defaultLocale: 'en',
        supportedLocales: ['en'],
        [key]: true,
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues.find((i) => i.code === 'unrecognized_keys')?.message)
        .toContain('#3494');
    },
  );
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

// ── `validationMessages` retired in 17.0.0 (#4667, ADR-0049) ────────────────
describe('retired translation.validationMessages (#4667)', () => {
  it('rejects the group at BOTH doors — bundle entry and registered item', () => {
    // #3778's original guard ran on the item door only, which is exactly how
    // this key survived in file-authored bundles. It now lives in the shared
    // `translationDataShape()`, so retiring it closes both at once — that
    // symmetry is what these two assertions pin.
    const payload = { validationMessages: { discount_limit: '折扣不能超过40%' } };
    expect(() => TranslationDataSchema.parse(payload))
      .toThrow(/validationMessages.*removed.*17\.0\.0/s);
    expect(() => TranslationItemSchema.parse({ name: 'zh_cn', locale: 'zh-CN', ...payload }))
      .toThrow(/validationMessages.*removed.*17\.0\.0/s);
  });

  it('points at the rule, which is where a validation message actually renders', () => {
    expect(() => TranslationDataSchema.parse({ validationMessages: { x: 'y' } }))
      .toThrow(/object\.validations\[\]\.message/s);
  });

  it('the retired `errors` dialect no longer signposts a dead key', () => {
    // #3778 retired `errors` by telling authors to use `validationMessages` —
    // a signpost into another unread group. Taking that advice moved content
    // from one dead place to another. The replacement guidance must NOT name
    // `validationMessages`.
    let msg = '';
    try { TranslationDataSchema.parse({ errors: { x: 'y' } }); } catch (e) { msg = String(e); }
    expect(msg).toMatch(/`errors` is the retired object-first dialect/s);
    expect(msg).not.toMatch(/use 'validationMessages'/s);
    expect(msg).toMatch(/object\.validations\[\]\.message/s);
  });

  it('still accepts the live sibling groups', () => {
    expect(() => TranslationDataSchema.parse({
      messages: { 'common.save': '保存' },
      apps: { crm: { label: 'CRM' } },
    })).not.toThrow();
  });
});

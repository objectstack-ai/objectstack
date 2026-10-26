import { describe, it, expect } from 'vitest';
import {
  isSpecTranslationData,
  transformSpecTranslations,
  type SpecTranslationData,
} from '../utils/spec-translations';
import { builtInLocales } from '../locales';

describe('isSpecTranslationData', () => {
  it('returns false for empty / non-object input', () => {
    expect(isSpecTranslationData(null)).toBe(false);
    expect(isSpecTranslationData(undefined)).toBe(false);
    expect(isSpecTranslationData({})).toBe(false);
    expect(isSpecTranslationData({ objects: null as unknown as object })).toBe(false);
    expect(isSpecTranslationData({ objects: [] as unknown as object })).toBe(false);
  });

  it('recognises a bundle that translates object labels and no field label (objectui#10235)', () => {
    expect(isSpecTranslationData({ objects: { crm_lead: { label: '线索' } } })).toBe(true);
    // The shape that was recognised before still is.
    expect(
      isSpecTranslationData({
        objects: { account: { label: 'Account', fields: {} } },
      }),
    ).toBe(true);
  });

  it('recognises a bundle by any spec group it carries, alone', () => {
    // The groups the card names. The full list is pinned against the spec's
    // own key list beside the console's loader, which depends on the spec.
    expect(isSpecTranslationData({ apps: { crm: { label: '客户关系' } } })).toBe(true);
    expect(isSpecTranslationData({ dashboards: { overview: { label: '概览' } } })).toBe(true);
    expect(isSpecTranslationData({ pages: { home: { label: '首页' } } })).toBe(true);
    expect(
      isSpecTranslationData({
        flows: { lead_conversion: { screens: { screen_1: { title: '转化详情' } } } },
      }),
    ).toBe(true);
  });

  describe('an already-namespaced i18next tree stays on the as-is branch', () => {
    it('an app namespace, a built-in namespace, and the envelope-less error body', () => {
      expect(
        isSpecTranslationData({
          crm: {
            objects: { crm_lead: { label: '线索' } },
            fields: { crm_lead: { name: '名称' } },
          },
        }),
      ).toBe(false);
      expect(isSpecTranslationData({ common: { save: '保存' } })).toBe(false);
      expect(isSpecTranslationData({ success: true, data: {} })).toBe(false);
    });

    it("the transform's own output — so a loaded payload is never wrapped twice", () => {
      const once = transformSpecTranslations({ objects: { crm_lead: { label: '线索' } } });
      expect(isSpecTranslationData(once)).toBe(false);
    });

    it('a group-named key whose value is not an object', () => {
      expect(isSpecTranslationData({ apps: 'Applications' })).toBe(false);
      expect(isSpecTranslationData({ flows: ['lead_conversion'] })).toBe(false);
      expect(isSpecTranslationData({ pages: null })).toBe(false);
    });

    it('no built-in pack namespace is spelled like a spec group', () => {
      // A flat payload may override built-in strings (`{ common: { save } }`);
      // it reaches the as-is branch only while no pack namespace collides with
      // a spec group. Read off the packs, so a namespace added later is judged.
      const namespaces = new Set(
        Object.values(builtInLocales).flatMap((pack) => Object.keys(pack)),
      );
      expect(namespaces.has('common')).toBe(true);
      for (const ns of namespaces) {
        expect(isSpecTranslationData({ [ns]: { key: 'value' } }), ns).toBe(false);
      }
    });
  });
});

describe('transformSpecTranslations', () => {
  it('flattens fields and field options under top-level keys', () => {
    const out = transformSpecTranslations({
      objects: {
        account: {
          label: '客户',
          pluralLabel: '客户列表',
          description: '客户主数据',
          fields: {
            first_name: { label: '名' },
            status: {
              label: '状态',
              options: { open: '开放', closed: '关闭' },
            },
          },
        },
      },
    });

    const app = (out as { app: Record<string, any> }).app;
    expect(app.objects.account.label).toBe('客户');
    expect(app.objects.account.pluralLabel).toBe('客户列表');
    expect(app.objects.account.description).toBe('客户主数据');
    expect(app.fields.account.first_name).toBe('名');
    expect(app.fields.account.status).toBe('状态');
    expect(app.fieldOptions.account.status).toEqual({ open: '开放', closed: '关闭' });
  });

  it('preserves all _-prefixed object scopes verbatim (the regression guard)', () => {
    const out = transformSpecTranslations({
      objects: {
        account: {
          label: '客户',
          fields: { name: { label: '名称' } },
          _views: { all_accounts: { label: '全部客户' } },
          _actions: { archive: { label: '归档' } },
          _sections: { details: { label: '详情' } },
          _notifications: { created: { label: '已创建' } },
          _errors: { duplicate: { label: '重复' } },
          _options: { theme: { dark: '深色' } },
        },
      },
    });

    const obj = (out as { app: { objects: Record<string, any> } }).app.objects.account;
    expect(obj._views.all_accounts.label).toBe('全部客户');
    expect(obj._actions.archive.label).toBe('归档');
    expect(obj._sections.details.label).toBe('详情');
    expect(obj._notifications.created.label).toBe('已创建');
    expect(obj._errors.duplicate.label).toBe('重复');
    expect(obj._options.theme.dark).toBe('深色');
  });

  it('preserves any unknown _-prefixed scope added in the future', () => {
    const out = transformSpecTranslations({
      objects: {
        account: {
          label: 'Account',
          fields: {},
          _futureScope: { foo: { label: 'Bar' } },
          // `objects` is optional on `SpecTranslationData`, so indexing it
          // directly is `Record<…> | undefined` — which has no index signature
          // and cannot be indexed by `string` (TS2537). `NonNullable` names the
          // record itself, which is what this fixture is one entry of.
        } as NonNullable<SpecTranslationData['objects']>[string],
      },
    });
    const obj = (out as { app: { objects: Record<string, any> } }).app.objects.account;
    expect(obj._futureScope.foo.label).toBe('Bar');
  });

  it('passes known top-level namespaces through to the app namespace', () => {
    const out = transformSpecTranslations({
      objects: { account: { label: 'Account', fields: {} } },
      apps: { crm: { label: 'CRM' } },
      messages: { hello: 'Hi' },
      validationMessages: { required: '必填' },
      dashboards: { overview: { label: '概览' } },
      globalActions: { save: { label: '保存' } },
    });
    const app = (out as { app: Record<string, any> }).app;
    expect(app.apps.crm.label).toBe('CRM');
    expect(app.messages.hello).toBe('Hi');
    expect(app.validationMessages.required).toBe('必填');
    expect(app.dashboards.overview.label).toBe('概览');
    expect(app.globalActions.save.label).toBe('保存');
  });

  it('forwards any unknown top-level key (future-proof)', () => {
    const out = transformSpecTranslations({
      objects: { account: { label: 'Account', fields: {} } },
      futureNamespace: { foo: 'bar' },
    } as SpecTranslationData);
    const app = (out as { app: Record<string, any> }).app;
    expect(app.futureNamespace).toEqual({ foo: 'bar' });
  });

  it('omits empty top-level collections', () => {
    const out = transformSpecTranslations({ objects: {} });
    expect(out).toEqual({ app: {} });
  });

  it('namespaces an object-label-only bundle under `app` (objectui#10235)', () => {
    expect(transformSpecTranslations({ objects: { crm_lead: { label: '线索' } } })).toEqual({
      app: { objects: { crm_lead: { label: '线索' } } },
    });
  });

  it('namespaces a flows-only bundle under `app`, verbatim (objectui#10235)', () => {
    const flows = { lead_conversion: { screens: { screen_1: { title: '转化详情' } } } };
    expect(transformSpecTranslations({ flows })).toEqual({ app: { flows } });
  });
});

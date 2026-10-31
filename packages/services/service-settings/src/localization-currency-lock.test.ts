// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The home-currency lock (ADR-0144 D4, multi-currency M1-3):
 * `localization.currency` saves freely until an exchange rate row or a
 * `homeAmount` declaration uses it, and is refused after either; the refusal
 * and the Localization page name what uses it, in every locale the settings
 * bundle ships.
 */

import { describe, expect, it, vi } from 'vitest';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { SettingsService } from './settings-service.js';
import { registerSettingsRoutes } from './settings-routes.js';
import { localizationSettingsManifest } from './manifests/localization.manifest.js';
import { mailSettingsManifest } from './manifests/mail.manifest.js';
import { settingsBuiltinTranslations } from './translations/index.js';
import { SETTINGS_LIVE_STATUS_BANNER_ID, SettingsValidationError } from './settings-service.types.js';
import {
  CURRENCY_LOCK_COPY,
  EXCHANGE_RATE_OBJECT,
  readCurrencyUsage,
  registerLocalizationCurrencyLock,
  type CurrencyUsageEngine,
} from './localization-currency-lock.js';

const ORG = 'org_alpha';
const OTHER_ORG = 'org_beta';
const ctx = { tenantId: ORG, userId: 'usr_admin' };

/** An invoice whose `amount` declares its home-currency projection (#27191's shape). */
const INVOICE = {
  name: 'invoice',
  label: 'Invoice',
  fields: {
    amount: {
      type: 'currency',
      currencyConfig: {
        currencyMode: 'record',
        currencyField: 'currency_code',
        homeAmount: { field: 'amount_home', rateDate: 'invoice_date', rateField: 'amount_rate' },
      },
    },
    amount_home: { type: 'currency', readonly: true },
  },
};
/** A record-mode amount with no home projection: it does not use the home currency. */
const QUOTE = {
  name: 'quote',
  label: 'Quote',
  fields: { total: { type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'code' } } },
};

/** The engine the lock reads: `sys_exchange_rate` rows and the object registry. */
function fakeEngine(opts: { rateObjectRegistered?: boolean } = {}) {
  const rates: Array<{ organization_id: string | null; currency: string }> = [];
  const objects: unknown[] = [QUOTE];
  const count = vi.fn(async (name: string, query?: { where?: Record<string, unknown> }) => {
    if (name !== EXCHANGE_RATE_OBJECT) throw new Error(`unexpected count of ${name}`);
    const org = query?.where?.organization_id;
    return rates.filter((r) => org === undefined || r.organization_id === org).length;
  });
  const engine: CurrencyUsageEngine = {
    count,
    registry: {
      getAllObjects: () => objects,
      getObject: (name: string) =>
        name === EXCHANGE_RATE_OBJECT && opts.rateObjectRegistered !== false ? { name } : undefined,
    },
  };
  return { engine, rates, objects, count };
}

function rig(opts: { rateObjectRegistered?: boolean } = {}) {
  const svc = new SettingsService({ env: {} });
  svc.registerManifest(localizationSettingsManifest);
  const fake = fakeEngine(opts);
  expect(registerLocalizationCurrencyLock(svc, fake.engine)).toBe(true);
  return { svc, ...fake };
}

async function refusalOf(p: Promise<unknown>): Promise<SettingsValidationError> {
  const err = await p.then(() => undefined, (e: unknown) => e);
  expect(err).toBeInstanceOf(SettingsValidationError);
  return err as SettingsValidationError;
}

describe('localization.currency — saves freely until used', () => {
  it('saves and changes before the first rate row and before any homeAmount declaration', async () => {
    const { svc } = rig();
    await svc.set('localization', 'currency', 'USD', ctx);
    await svc.set('localization', 'currency', 'EUR', ctx);
    await svc.set('localization', 'currency', null, ctx);
    await svc.set('localization', 'currency', 'CNY', ctx);
    expect((await svc.get('localization', 'currency', ctx)).value).toBe('CNY');
  });

  it('a record-mode amount without `homeAmount` does not lock it', async () => {
    const { svc } = rig();
    await svc.set('localization', 'currency', 'USD', ctx);
    await svc.set('localization', 'currency', 'EUR', ctx);
    expect((await svc.get('localization', 'currency', ctx)).value).toBe('EUR');
  });

  it("another organization's rate rows do not lock this one", async () => {
    const { svc, rates } = rig();
    await svc.set('localization', 'currency', 'USD', ctx);
    rates.push({ organization_id: OTHER_ORG, currency: 'EUR' });
    await svc.set('localization', 'currency', 'EUR', ctx);
    expect((await svc.get('localization', 'currency', ctx)).value).toBe('EUR');
  });
});

describe('localization.currency — locked once used', () => {
  it('is refused after the first rate row, naming it', async () => {
    const { svc, rates } = rig();
    await svc.set('localization', 'currency', 'USD', ctx);
    rates.push({ organization_id: ORG, currency: 'EUR' });
    const err = await refusalOf(svc.set('localization', 'currency', 'EUR', ctx));
    expect(err.fields).toHaveLength(1);
    expect(err.fields[0]).toMatchObject({
      field: 'currency',
      code: 'invalid_value',
      label: 'Default currency',
      constraint: { lockedBy: 'in_use', objects: [], exchangeRates: 1 },
    });
    expect(err.fields[0].message).toMatch(/^The default currency is locked at USD because it is in use by 1 exchange rate\. /);
    expect((await svc.get('localization', 'currency', ctx)).value).toBe('USD');
  });

  it('is refused after a homeAmount declaration, naming the object', async () => {
    const { svc, objects } = rig();
    await svc.set('localization', 'currency', 'USD', ctx);
    objects.push(INVOICE);
    const err = await refusalOf(svc.set('localization', 'currency', 'EUR', ctx));
    expect(err.fields[0].constraint).toEqual({ lockedBy: 'in_use', objects: ['invoice'], exchangeRates: 0 });
    expect(err.fields[0].message).toContain('in use by 1 object (Invoice).');
    expect((await svc.get('localization', 'currency', ctx)).value).toBe('USD');
  });

  it('names both users when both exist', async () => {
    const { svc, rates, objects } = rig();
    await svc.set('localization', 'currency', 'USD', ctx);
    objects.push(INVOICE, { ...INVOICE, name: 'order', label: 'Order' });
    rates.push({ organization_id: ORG, currency: 'EUR' }, { organization_id: ORG, currency: 'JPY' });
    const err = await refusalOf(svc.set('localization', 'currency', 'EUR', ctx));
    expect(err.fields[0].message).toContain('in use by 2 objects (Invoice, Order) and 2 exchange rates.');
  });

  it('refuses a clear too, and the namespace reset with it', async () => {
    const { svc, rates } = rig();
    await svc.set('localization', 'currency', 'USD', ctx);
    rates.push({ organization_id: ORG, currency: 'EUR' });
    await refusalOf(svc.set('localization', 'currency', null, ctx));
    await refusalOf(svc.setMany('localization', { currency: null, timezone: null }, ctx));
    expect((await svc.get('localization', 'currency', ctx)).value).toBe('USD');
  });

  it('lets a re-save of the value in force through, and the batch beside it', async () => {
    const { svc, rates } = rig();
    await svc.set('localization', 'currency', 'USD', ctx);
    rates.push({ organization_id: ORG, currency: 'EUR' });
    await svc.setMany('localization', { currency: 'USD', timezone: 'Asia/Tokyo' }, ctx);
    expect((await svc.get('localization', 'timezone', ctx)).value).toBe('Asia/Tokyo');
  });

  it('lets the first value through while the currency is unset (ADR-0144 Open item 4: never blocks choosing one)', async () => {
    const { svc, rates, objects } = rig();
    rates.push({ organization_id: ORG, currency: 'EUR' });
    objects.push(INVOICE);
    await svc.set('localization', 'currency', 'USD', ctx);
    await refusalOf(svc.set('localization', 'currency', 'GBP', ctx));
    expect((await svc.get('localization', 'currency', ctx)).value).toBe('USD');
  });

  it('lifts by itself once the last rate row and the last declaration are gone', async () => {
    const { svc, rates, objects } = rig();
    await svc.set('localization', 'currency', 'USD', ctx);
    rates.push({ organization_id: ORG, currency: 'EUR' });
    objects.push(INVOICE);
    await refusalOf(svc.set('localization', 'currency', 'EUR', ctx));
    rates.length = 0;
    await refusalOf(svc.set('localization', 'currency', 'EUR', ctx));
    objects.pop();
    await svc.set('localization', 'currency', 'EUR', ctx);
    expect((await svc.get('localization', 'currency', ctx)).value).toBe('EUR');
  });

  it('counts no rate rows where the composition does not register the rate table', async () => {
    const { svc, count } = rig({ rateObjectRegistered: false });
    await svc.set('localization', 'currency', 'USD', ctx);
    await svc.set('localization', 'currency', 'EUR', ctx);
    expect(count).not.toHaveBeenCalled();
  });

  it('fails the write when the rate count fails, rather than guess', async () => {
    const { svc, count } = rig();
    await svc.set('localization', 'currency', 'USD', ctx);
    count.mockRejectedValueOnce(new Error('driver down'));
    await expect(svc.set('localization', 'currency', 'EUR', ctx)).rejects.toThrow('driver down');
    expect((await svc.get('localization', 'currency', ctx)).value).toBe('USD');
  });
});

describe('readCurrencyUsage', () => {
  it("counts the organization's own rows, under a system read", async () => {
    const { engine, rates, count } = fakeEngine();
    rates.push({ organization_id: ORG, currency: 'EUR' }, { organization_id: OTHER_ORG, currency: 'EUR' });
    expect((await readCurrencyUsage(engine, ORG)).exchangeRates).toBe(1);
    expect(count).toHaveBeenLastCalledWith(EXCHANGE_RATE_OBJECT, {
      where: { organization_id: ORG },
      context: { isSystem: true },
    });
  });

  it('counts every row in a composition with no organization object', async () => {
    const { engine, rates } = fakeEngine();
    rates.push({ organization_id: null, currency: 'EUR' }, { organization_id: null, currency: 'JPY' });
    expect((await readCurrencyUsage(engine, null)).exchangeRates).toBe(2);
  });
});

describe('the copy — every locale the settings bundle ships', () => {
  it('covers exactly the locales of settingsBuiltinTranslations', () => {
    expect(Object.keys(CURRENCY_LOCK_COPY).sort()).toEqual(Object.keys(settingsBuiltinTranslations).sort());
  });

  it.each([
    ['zh-CN', '默认币种已锁定为 USD：它已被 1 个对象（Invoice）和 2 条汇率使用。'],
    ['ja', '既定の通貨は USD でロックされています。1 件のオブジェクト（Invoice）と 2 件の為替レートで使用されているためです。'],
    ['es-MX', 'La moneda predeterminada está bloqueada en USD porque está en uso en 1 objeto (Invoice) y 2 tipos de cambio.'],
    ['fr-FR', 'The default currency is locked at USD because it is in use by 1 object (Invoice) and 2 exchange rates.'],
  ])('writes the refusal in %s', async (locale, opening) => {
    const { svc, rates, objects } = rig();
    await svc.set('localization', 'currency', 'USD', ctx);
    objects.push(INVOICE);
    rates.push({ organization_id: ORG, currency: 'EUR' }, { organization_id: ORG, currency: 'JPY' });
    const err = await refusalOf(svc.set('localization', 'currency', 'EUR', { ...ctx, locale }));
    expect(err.fields[0].message.startsWith(opening)).toBe(true);
  });
});

// ── The page: GET /api/settings/localization ──────────────────────────────

class MockHttp implements IHttpServer {
  routes = new Map<string, RouteHandler>();
  private add(method: string, path: string, handler: RouteHandler) {
    this.routes.set(`${method} ${path}`, handler);
  }
  get(path: string, h: RouteHandler) { this.add('GET', path, h); return this as any; }
  post(path: string, h: RouteHandler) { this.add('POST', path, h); return this as any; }
  put(path: string, h: RouteHandler) { this.add('PUT', path, h); return this as any; }
  delete(path: string, h: RouteHandler) { this.add('DELETE', path, h); return this as any; }
  patch(path: string, h: RouteHandler) { this.add('PATCH', path, h); return this as any; }
  use() { return this as any; }
  listen() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  getInstance() { return null; }
}

function pageRig() {
  const base = rig();
  const http = new MockHttp();
  registerSettingsRoutes(http, base.svc, {
    contextFromRequest: () => ({ ...ctx, enforced: true, permissions: ['setup.access', 'setup.write'] }),
  });
  const call = async (verb: 'GET' | 'PUT', headers: Record<string, string>, body?: unknown) => {
    const req: IHttpRequest = {
      params: { namespace: 'localization' }, query: {}, body, headers, method: verb, path: '/',
    };
    const state: { status: number; body?: any } = { status: 200 };
    const res: IHttpResponse = {
      json: vi.fn((data) => { state.body = data; }) as any,
      send: vi.fn() as any,
      status: vi.fn((code: number) => { state.status = code; return res; }) as any,
      header: vi.fn(() => res) as any,
    };
    await http.routes.get(`${verb} /api/settings/:namespace`)!(req, res);
    return state;
  };
  return { ...base, call };
}

describe('the Localization page states what uses the currency', () => {
  it('states nothing while nothing uses it', async () => {
    const { svc, call } = pageRig();
    await svc.set('localization', 'currency', 'USD', ctx);
    const { body } = await call('GET', {});
    expect(body.data.manifest.specifiers).toEqual(localizationSettingsManifest.specifiers);
  });

  it('heads the page with the lock and its users once used, in the request language', async () => {
    const { svc, rates, objects, call } = pageRig();
    await svc.set('localization', 'currency', 'USD', ctx);
    objects.push(INVOICE);
    rates.push({ organization_id: ORG, currency: 'EUR' });
    const en = (await call('GET', {})).body.data.manifest.specifiers[0];
    expect(en).toMatchObject({
      type: 'info_banner',
      id: SETTINGS_LIVE_STATUS_BANNER_ID,
      label: 'Default currency locked: USD',
      bannerText: 'In use by 1 object (Invoice) and 1 exchange rate. Converted amounts are stored in this currency, so it can no longer be changed.',
      bannerSeverity: 'info',
    });
    const zh = (await call('GET', { 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' })).body.data.manifest.specifiers[0];
    expect(zh.label).toBe('默认币种已锁定：USD');
    expect(zh.bannerText).toBe('已被 1 个对象（Invoice）和 1 条汇率使用。换算后的金额都以该币种存储，因此不能再修改。');
  });

  it('warns while the currency is unset and something already needs it', async () => {
    const { rates, call } = pageRig();
    rates.push({ organization_id: ORG, currency: 'EUR' });
    const banner = (await call('GET', { 'accept-language': 'ja-JP' })).body.data.manifest.specifiers[0];
    expect(banner).toMatchObject({ label: '既定の通貨が設定されていません', bannerSeverity: 'warning' });
    expect(banner.bannerText).toContain('使用状況: 1 件の為替レート。');
  });

  it('answers a refused save 400 SETTINGS_VALIDATION, the refusal in the request language', async () => {
    const { svc, rates, call } = pageRig();
    await svc.set('localization', 'currency', 'USD', ctx);
    rates.push({ organization_id: ORG, currency: 'EUR' });
    const { status, body } = await call('PUT', { 'accept-language': 'es-ES' }, { currency: 'EUR' });
    expect(status).toBe(400);
    expect(body.error.code).toBe('SETTINGS_VALIDATION');
    expect(body.error.details.fields[0]).toMatchObject({ field: 'currency', code: 'invalid_value' });
    expect(body.error.details.fields[0].message).toMatch(/^La moneda predeterminada está bloqueada en USD porque está en uso en 1 tipo de cambio\./);
  });
});

describe('registerLocalizationCurrencyLock', () => {
  it('registers nothing on a service without the localization namespace', () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(mailSettingsManifest);
    expect(registerLocalizationCurrencyLock(svc, fakeEngine().engine)).toBe(false);
  });
});

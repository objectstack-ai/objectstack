// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #14788 — `GET /auth/me/localization` is the ONE read face for the signed-in
// user's language (maintainer ruling 2026-09-03, option D, which also retired
// the never-produced `SessionUser.language` from the session contract).
// `locale` resolves, in order:
//
//   1. the user's own `sys_user.locale` when set — accepted only when it passes
//      the column's OWN shape rule (`locale_bcp47_shape`, read off the
//      registered object; never a second parser here);
//   2. the request's `Accept-Language` preference (`preferredLocaleFromHeader`,
//      the same parse the dispatcher feeds `execCtx.locale` from);
//   3. the deployment default (`resolveLocalizationContext` — the
//      `localization.locale` cascade, floor `en-US`).
//
// Every case below pins one rung's precedence over the rungs beneath it by
// supplying ALL the lower rungs at once — a case that only supplied the rung
// under test would pass in a world where the other rungs were never consulted.
// The malformed-column case is the ruling's "malformed ⇒ next rung, never
// served" clause; the narrowed-rule case is the "no second parser" clause
// (the answer moves with the registry's rule, not with a built-in regex).
//
// Before #14788 the resolver behind these endpoints assembled NO localization
// at all — `execCtx.locale` here was always `undefined` and the endpoint
// answered `locale: null` for every authenticated caller — so the rung-3 cases
// are also the first pins that this surface answers a language at all.
//
// #15387 — WHAT THIS FILE PINS CHANGED, deliberately and not silently.
// `currency` / `timezone` were out of #14788's scope and kept coming off that
// same resolver, so the rung-1 case below asserted `timezone: null` as the
// contract. It was pinning the DEFECT: the endpoint answered null for both to
// every authenticated caller whatever the deployment configured. The
// assertion is now the corrected contract, and the `#15387` block at the foot
// of this file is what makes the two values falsifiable rather than merely
// present:
//
//   * `timezone` — the deployment cascade's answer, floor `UTC`. An
//     authenticated caller can no longer be answered `null` for it, which is
//     why the rung-1 fixture (which configures no time zone) now reads `UTC`.
//   * `currency` — the deployment cascade's answer, and the one value with NO
//     floor. `null` there is still legal and still correct for a deployment
//     that configures no currency, so the rung-1 expectation for it is
//     UNCHANGED. Keeping that asymmetry visible is the point: the two keys do
//     not have the same nullability contract.
//
// The response SHAPE objectui reads is unchanged — same four keys.

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { registerCurrentUserEndpoints } from './current-user-endpoints';

const ME_LOCALIZATION = '/api/v1/auth/me/localization';
const USER = 'usr_lang';
const ORG = 'org_lang';

type Row = Record<string, any>;

/**
 * The column's own rule, as the registry hands it to the endpoint — the
 * `validations[]` entry `sys-user.object.ts` declares (`SYS_USER_LOCALE_TAG_
 * PATTERN`; byte-parity with service-messaging's read-side regex is pinned in
 * `recipient-locale-shape-parity.test.ts`). Fixture data here: what is under
 * test is that the endpoint EVALUATES whatever rule the registry declares.
 */
const LOCALE_SHAPE_RULE: Row = {
    type: 'format',
    name: 'locale_bcp47_shape',
    field: 'locale',
    regex: '^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$',
    severity: 'error',
    message: 'Locale must be a BCP-47 language tag, such as zh-CN or ja-JP.',
};

interface MountOptions {
    /** `sys_user.locale` on the caller's row; `undefined` = column unset. */
    storedLocale?: unknown;
    /** The `sys_user` object's `validations[]` as the registry reports them; `null` = no schema at all. */
    rules?: Row[] | null;
    /** Tenant-scoped `localization.locale` `sys_setting` row value (rung 3). */
    settingLocale?: string;
    /** Tenant-scoped `localization.timezone` `sys_setting` row value. */
    settingTimezone?: string;
    /** Tenant-scoped `localization.currency` `sys_setting` row value. */
    settingCurrency?: string;
    /** Whether a session resolves at all. */
    authenticated?: boolean;
    /**
     * Make the ENDPOINT's own `sys_user` read throw (the courtesy-never-fails-
     * the-answer case). The session resolver reads the same row first, once,
     * through core's fail-LOUD `tryFind` (#13279) — a throw there is a
     * different contract (the whole answer is refused), so only the read
     * after it fails here.
     */
    failUserRead?: boolean;
}

function mount({ storedLocale, rules = [LOCALE_SHAPE_RULE], settingLocale, settingTimezone, settingCurrency, authenticated = true, failUserRead = false }: MountOptions = {}) {
    const reads: Array<{ object: string; opts: any }> = [];
    let sysUserReads = 0;
    const ql = {
        find: async (object: string, opts: any) => {
            reads.push({ object, opts });
            if (object === 'sys_user') {
                if (failUserRead && ++sysUserReads > 1) throw new Error('sys_user unavailable');
                return opts?.where?.id === USER ? [{ id: USER, email: 'lang@example.com', locale: storedLocale }] : [];
            }
            if (object === 'sys_setting') {
                // The endpoint reads all three `localization` keys in ONE `$in`
                // query, so the double answers whichever of them the fixture
                // configured — and nothing for the rest.
                const configured: Array<[string, string | undefined]> = [
                    ['locale', settingLocale],
                    ['timezone', settingTimezone],
                    ['currency', settingCurrency],
                ];
                return configured
                    .filter(([, value]) => value !== undefined)
                    .map(([key, value]) => ({ namespace: 'localization', key, value, scope: 'tenant' }));
            }
            return [];
        },
        // The registry view the endpoint reads the column's rule off.
        getSchema: (name: string) => (name === 'sys_user' && rules !== null ? { name: 'sys_user', validations: rules } : undefined),
        registry: { getAllApps: () => [], getAllObjects: () => [] },
    };
    const services: Record<string, unknown> = {
        auth: {
            api: {
                getSession: async () => (authenticated
                    ? { user: { id: USER }, session: { activeOrganizationId: ORG } }
                    : null),
            },
        },
        objectql: ql,
        metadata: { list: async () => [] },
    };
    const app = new Hono();
    registerCurrentUserEndpoints({
        rawApp: app,
        ctx: {
            logger: { debug() {}, warn() {} },
            // Throws for an unclaimed slot, like the real kernel locator.
            getService: <T,>(name: string): T => {
                if (!(name in services)) throw new Error(`[Kernel] Service '${name}' not found`);
                return services[name] as T;
            },
        },
    });
    const get = async (acceptLanguage?: string) => {
        const res = await app.request(`http://localhost${ME_LOCALIZATION}`, {
            headers: acceptLanguage === undefined ? {} : { 'accept-language': acceptLanguage },
        });
        return { status: res.status, body: await res.json() as any };
    };
    return { get, reads };
}

describe('/auth/me/localization — the signed-in user\'s language, three rungs (#14788)', () => {
    it('rung 1: the user\'s own sys_user.locale wins over the request AND the deployment default', async () => {
        const { get, reads } = mount({ storedLocale: 'zh-CN', settingLocale: 'fr-FR' });
        const { status, body } = await get('ja-JP,ja;q=0.9,en;q=0.8');
        expect(status).toBe(200);
        // The SHAPE objectui reads (`json?.locale`, plus `currency`) — unchanged.
        // `timezone: 'UTC'` is the cascade floor for a fixture that configures
        // no time zone (#15387); `currency: null` is the no-floor value.
        expect(body).toEqual({ authenticated: true, currency: null, locale: 'zh-CN', timezone: 'UTC' });
        // The identity row is read under a SYSTEM context by the caller's own
        // id (the `tryFind` shape core uses for the same row) — never routed
        // through the caller's own RLS wall.
        const userReads = reads.filter((r) => r.object === 'sys_user');
        expect(userReads.length).toBeGreaterThan(0);
        for (const r of userReads) {
            expect(r.opts?.context?.isSystem).toBe(true);
            expect(r.opts?.where?.id).toBe(USER);
        }
    });

    it('rung 2: with the column unset, the request\'s Accept-Language preference wins over the deployment default', async () => {
        const { get } = mount({ storedLocale: undefined, settingLocale: 'fr-FR' });
        expect((await get('ja-JP,ja;q=0.9,en;q=0.8')).body.locale).toBe('ja-JP');
        // An EMPTY column is "unset", not a preference for the empty string.
        const blank = mount({ storedLocale: '   ', settingLocale: 'fr-FR' });
        expect((await blank.get('ja-JP')).body.locale).toBe('ja-JP');
    });

    it('rung 3: with neither, the deployment default answers — and it has a floor', async () => {
        const { get } = mount({ storedLocale: undefined, settingLocale: 'fr-FR' });
        expect((await get()).body.locale).toBe('fr-FR');
        // `*` is "any language" — no preference expressed, so rung 3 again.
        expect((await get('*')).body.locale).toBe('fr-FR');
        // Nothing configured anywhere: the cascade's own floor, never `null`.
        const bare = mount({ storedLocale: undefined });
        expect((await bare.get()).body.locale).toBe('en-US');
    });

    it('a malformed column value falls to the next rung — it is never served', async () => {
        // The shape a lossy producer leaves at rest (the hotcrm dead-letter
        // shape service-messaging refuses on the delivery side); and a value
        // a user typed before the write rule existed.
        for (const stored of ['Chinese (Simplified)', 'undefined', 'zh_CN!', 42]) {
            const { get } = mount({ storedLocale: stored, settingLocale: 'fr-FR' });
            expect((await get('ja-JP')).body.locale, `stored=${String(stored)}`).toBe('ja-JP');
            expect((await get()).body.locale, `stored=${String(stored)}, no header`).toBe('fr-FR');
        }
    });

    it('the column\'s OWN rule is what governs — narrow the registry\'s rule and the answer moves with it', async () => {
        // A second parser hard-coded here would keep accepting `zh-CN`. The
        // endpoint evaluates the rule the registry declares, so a narrower
        // rule refuses what the real rule accepts, and vice versa.
        const narrow = { ...LOCALE_SHAPE_RULE, regex: '^[a-z]{2}$' };
        const refused = mount({ storedLocale: 'zh-CN', rules: [narrow] });
        expect((await refused.get('ja-JP')).body.locale).toBe('ja-JP');
        const accepted = mount({ storedLocale: 'zh', rules: [narrow] });
        expect((await accepted.get('ja-JP')).body.locale).toBe('zh');
        // A rule objectql would skip as malformed is skipped here too, which
        // leaves NO usable rule — the unverifiable case below, not a bypass.
        const broken = mount({ storedLocale: 'zh-CN', rules: [{ ...LOCALE_SHAPE_RULE, regex: '[' }] });
        expect((await broken.get('ja-JP')).body.locale).toBe('ja-JP');
    });

    it('an unverifiable column (no shape rule declared) is not trusted — it falls through', async () => {
        // Fail direction pinned on purpose: a registry that declares no
        // `format` rule for `locale` cannot vouch for the stored value, and an
        // unvouched value reads as "unset", the same as a malformed one.
        const noRule = mount({ storedLocale: 'zh-CN', rules: [] });
        expect((await noRule.get('ja-JP')).body.locale).toBe('ja-JP');
        const noSchema = mount({ storedLocale: 'zh-CN', rules: null });
        expect((await noSchema.get('ja-JP')).body.locale).toBe('ja-JP');
    });

    it('a failed identity read is a courtesy lost, never a failed answer', async () => {
        const { get, reads } = mount({ storedLocale: 'zh-CN', settingLocale: 'fr-FR', failUserRead: true });
        const { status, body } = await get('ja-JP');
        expect(status).toBe(200);
        expect(body.authenticated).toBe(true);
        expect(body.locale).toBe('ja-JP');
        // Anti-vacuity: the endpoint's own read really was issued (and threw).
        expect(reads.filter((r) => r.object === 'sys_user').length).toBeGreaterThan(1);
    });

    it('the unauthenticated answer is unchanged', async () => {
        const { get, reads } = mount({ authenticated: false, storedLocale: 'zh-CN' });
        const { status, body } = await get('ja-JP');
        expect(status).toBe(200);
        expect(body).toEqual({ authenticated: false });
        // No identity row is read for an anonymous caller.
        expect(reads.filter((r) => r.object === 'sys_user')).toEqual([]);
    });
});

describe('/auth/me/localization — the regional defaults are RESOLVED, not always null (#15387)', () => {
    it('answers the tenant\'s configured currency and time zone', async () => {
        const { get } = mount({ settingTimezone: 'Asia/Shanghai', settingCurrency: 'CNY', settingLocale: 'zh-CN' });
        const { status, body } = await get();
        expect(status).toBe(200);
        // The WHOLE published shape, so a fourth key cannot appear unnoticed.
        expect(body).toEqual({ authenticated: true, currency: 'CNY', locale: 'zh-CN', timezone: 'Asia/Shanghai' });
    });

    it('resolves them independently of which locale rung won — they are not a by-product of the language cascade', async () => {
        // Rung 1 answers the language, so the deployment cascade does NOT decide
        // `locale` here. Before this card that short-circuit was the only reason
        // the cascade was consulted at all, and `currency` / `timezone` came off
        // an ExecutionContext that never carried them.
        const { get } = mount({ storedLocale: 'ja-JP', settingLocale: 'zh-CN', settingTimezone: 'Europe/Paris', settingCurrency: 'eur' });
        const { body } = await get('de-DE');
        // `eur` lower-case: the cascade's own coercion upper-cases a 3-letter code.
        expect(body).toEqual({ authenticated: true, currency: 'EUR', locale: 'ja-JP', timezone: 'Europe/Paris' });
    });

    it('a value the cascade refuses falls to the cascade\'s own answer — this surface adds no second parser', async () => {
        // `coerceCurrency` takes exactly three letters; `coerceTimeZone` takes an
        // `iana_time_zone` domain member. Neither refusal is re-implemented here:
        // the endpoint answers whatever the shared resolver answers.
        const { get } = mount({ settingTimezone: 'Middle/Earth', settingCurrency: 'euro' });
        const { body } = await get();
        expect(body.timezone).toBe('UTC');
        expect(body.currency).toBeNull();
    });

    it('with nothing configured: the time-zone floor answers, and currency is the one value that stays null', async () => {
        // The asymmetry is the cascade's, and it is deliberate to pin: `timezone`
        // has a floor (`UTC`) so an authenticated caller can never see null for
        // it again, while `currency` has none — a deployment that configures no
        // currency has no reference currency, and inventing one would be a wrong
        // answer rather than a missing one.
        const { get } = mount({});
        const { body } = await get();
        expect(body).toEqual({ authenticated: true, currency: null, locale: 'en-US', timezone: 'UTC' });
    });

    it('the unauthenticated answer stays localization-free', async () => {
        const { get, reads } = mount({ authenticated: false, settingTimezone: 'Asia/Shanghai', settingCurrency: 'CNY' });
        const { body } = await get();
        expect(body).toEqual({ authenticated: false });
        // Anti-vacuity: no settings read is issued for a caller with no session.
        expect(reads.filter((r) => r.object === 'sys_setting')).toEqual([]);
    });
});

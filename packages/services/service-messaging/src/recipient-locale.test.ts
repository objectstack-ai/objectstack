// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13881 — the per-recipient locale chain, pinned at its ONE read point.
 *
 * Maintainer ruling 2026-09-01: 「解析链 = 收件人 `locale` → 部署默认,缺失恒回退,
 * ⛔ 任何路径不得死信」. The channel suites pin what each channel DOES with
 * the resolved value; this file pins the resolution itself, so the two rungs
 * and the dead-letter refusal cannot drift apart across channels.
 */

import { describe, it, expect } from 'vitest';
import { normalizeRecipientLocale, resolveRecipientLocale, RECIPIENT_LOCALE_FIELD, USER_OBJECT } from './recipient-locale.js';

describe('#13881 — normalizeRecipientLocale', () => {
    it('passes a BCP-47-shaped tag through, trimmed', () => {
        expect(normalizeRecipientLocale('zh-CN')).toBe('zh-CN');
        expect(normalizeRecipientLocale('  ja-JP ')).toBe('ja-JP');
        expect(normalizeRecipientLocale('en')).toBe('en');
        expect(normalizeRecipientLocale('zh-Hans-CN')).toBe('zh-Hans-CN');
        expect(normalizeRecipientLocale('es-419')).toBe('es-419');
    });

    it('refuses the dead-letter shape hotcrm measured: the literal string "undefined" (and "null")', () => {
        // A missing preference interpolated to `${undefined}` dead-lettered
        // every delivery for every user without a row. That literal must never
        // reach a template lookup from this seam, whatever a lossy producer
        // left in the column.
        expect(normalizeRecipientLocale('undefined')).toBeUndefined();
        expect(normalizeRecipientLocale('null')).toBeUndefined();
        expect(normalizeRecipientLocale(' undefined ')).toBeUndefined();
    });

    it('refuses absent, empty, whitespace and non-string values', () => {
        for (const raw of [undefined, null, '', '   ', 0, 42, true, {}, [], Symbol('x')]) {
            expect(normalizeRecipientLocale(raw), `${String(raw)} must not name a locale`).toBeUndefined();
        }
    });

    it('refuses anything not shaped like a locale tag', () => {
        for (const raw of ['not a locale!!', 'zh_CN', '-zh', 'zh-', 'a', 'toolonglanguage', 'en-US;q=0.9', 'zh-CN,zh']) {
            expect(normalizeRecipientLocale(raw), `${raw} must not name a locale`).toBeUndefined();
        }
    });
});

describe('#13881 — resolveRecipientLocale (the ruled chain)', () => {
    it("rung 1: the recipient's own locale wins over the deployment default", () => {
        expect(resolveRecipientLocale('zh-CN', () => 'ja-JP')).toBe('zh-CN');
    });

    it('rung 2: a recipient without one falls to the deployment default', () => {
        expect(resolveRecipientLocale(undefined, () => 'ja-JP')).toBe('ja-JP');
        expect(resolveRecipientLocale(null, () => 'ja-JP')).toBe('ja-JP');
        expect(resolveRecipientLocale('', () => 'ja-JP')).toBe('ja-JP');
    });

    it('the dead-letter literal falls to the deployment default, never through', () => {
        expect(resolveRecipientLocale('undefined', () => 'ja-JP')).toBe('ja-JP');
        expect(resolveRecipientLocale('undefined', undefined)).toBeUndefined();
    });

    it('nothing named anywhere ⇒ undefined (the ladders\' documented floor), never ""', () => {
        expect(resolveRecipientLocale(undefined, undefined)).toBeUndefined();
        expect(resolveRecipientLocale(undefined, () => undefined)).toBeUndefined();
        expect(resolveRecipientLocale(undefined, () => '')).toBeUndefined();
        expect(resolveRecipientLocale(undefined, () => '   ')).toBeUndefined();
    });

    it('a throwing deployment-default probe costs the language, not the delivery', () => {
        expect(() => resolveRecipientLocale(undefined, () => { throw new Error('i18n down'); })).not.toThrow();
        expect(resolveRecipientLocale(undefined, () => { throw new Error('i18n down'); })).toBeUndefined();
        // …and is not even consulted when rung 1 answers.
        expect(resolveRecipientLocale('zh-CN', () => { throw new Error('i18n down'); })).toBe('zh-CN');
    });

    it('is lazy: the deployment default is probed only when rung 1 is silent', () => {
        let probed = 0;
        resolveRecipientLocale('zh-CN', () => { probed += 1; return 'ja-JP'; });
        expect(probed).toBe(0);
        resolveRecipientLocale(undefined, () => { probed += 1; return 'ja-JP'; });
        expect(probed).toBe(1);
    });

    it('names the column and object every channel reads', () => {
        // The channels project this field off the recipient row; the object
        // is the one `sys_user` declares the column on (platform-objects).
        expect(RECIPIENT_LOCALE_FIELD).toBe('locale');
        expect(USER_OBJECT).toBe('sys_user');
    });
});

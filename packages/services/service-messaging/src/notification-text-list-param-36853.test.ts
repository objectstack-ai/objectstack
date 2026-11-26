// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36853] A keyed param that is a LIST: each item its catalog sentence with
 * its own params, rendered in the recipient's language, joined by the
 * separator entry.
 *
 * A `{ key }` param resolves through `t(key, locale)` with no params, so a
 * hole held one text or one hole-free key, and a list whose items are
 * sentences with holes of their own could reach a reader only as the
 * producer's literal (the approval submitter's notice named a slate of more
 * than 8 slots in English inside a zh-CN sentence). Drives the real
 * `NotificationTextRenderer` over the kernel's in-memory `i18n` service.
 */

import { describe, it, expect } from 'vitest';
import { createMemoryI18n } from '@objectstack/core';
import {
    NOTIFICATION_LIST_PARAM_MAX_ITEMS,
    NotificationTextRenderer,
    assertNotificationTextKeys,
    readNotificationTextKeys,
    type NotificationListParam,
    type NotificationTextKeys,
} from './notification-text.js';

const CATALOG = {
    en: {
        messages: {
            holding: 'A member who holds {{who}} can decide it.',
            slot: "{{type}} '{{value}}'",
            separator: ', ',
            team: 'team',
        },
    },
    'zh-CN': {
        messages: {
            holding: '担任{{who}}的成员可以决定它。',
            slot: '{{type}}「{{value}}」',
            separator: '、',
            team: '团队',
        },
    },
};

function renderer() {
    const i18n = createMemoryI18n();
    for (const [locale, data] of Object.entries(CATALOG)) i18n.loadTranslations(locale, data);
    return new NotificationTextRenderer({ getData: () => undefined, getI18n: () => i18n as any });
}

/** A slate of `n` team slots as the list param. */
function slate(n: number, itemKey = 'messages.slot'): NotificationListParam {
    return {
        list: Array.from({ length: n }, (_, i) => ({
            key: itemKey,
            params: { type: { key: 'messages.team', fallback: 'team' }, value: `t${i + 1}` },
            fallback: `team 't${i + 1}'`,
        })),
        separator: { key: 'messages.separator', fallback: ', ' },
    };
}

const LITERAL = { title: 'Notice', body: 'literal body' };
const keysOf = (who: NotificationListParam): NotificationTextKeys => ({ bodyKey: 'messages.holding', params: { who } });

describe('#36853 — a list param renders every item in the recipient\'s language', () => {
    it('nine items in zh-CN: each its own sentence with its own params, joined by the zh-CN separator', () => {
        const body = renderer().render(keysOf(slate(9)), LITERAL, 'zh-CN').body;

        expect(body).toBe(`担任${Array.from({ length: 9 }, (_, i) => `团队「t${i + 1}」`).join('、')}的成员可以决定它。`);
        expect(body).not.toMatch(/team|, /);
    });

    it('in en, the English items and separator', () => {
        expect(renderer().render(keysOf(slate(2)), LITERAL, 'en').body)
            .toBe("A member who holds team 't1', team 't2' can decide it.");
    });

    it('an item whose sentence has no entry is its fallback; a separator with no entry is its fallback', () => {
        const who: NotificationListParam = {
            list: [slate(1).list[0], { key: 'messages.nowhere', fallback: 'role \'admin\'' }],
            separator: { key: 'messages.no_separator', fallback: ' / ' },
        };
        expect(renderer().render(keysOf(who), LITERAL, 'zh-CN').body)
            .toBe("担任团队「t1」 / role 'admin'的成员可以决定它。");
    });

    it('an item may take an object-label param and plain text, as a top-level hole does', () => {
        const who: NotificationListParam = {
            list: [{ key: 'messages.slot', params: { type: 'role', value: { object: 'crm_deal', fallback: 'Deal' } }, fallback: 'x' }],
            separator: { key: 'messages.separator', fallback: ', ' },
        };
        expect(renderer().render(keysOf(who), LITERAL, 'zh-CN').body).toBe('担任role「Deal」的成员可以决定它。');
    });
});

describe('#36853 — emit() refuses a malformed list param, and a stored one is read back', () => {
    const refused = (who: unknown) => () => assertNotificationTextKeys({ bodyKey: 'messages.holding', params: { who } });

    it('accepts the declared shape, and a stored row carrying it reads back', () => {
        expect(() => assertNotificationTextKeys(keysOf(slate(3)))).not.toThrow();
        expect(readNotificationTextKeys(keysOf(slate(3)))).toEqual(keysOf(slate(3)));
    });

    it('refuses an empty list, an oversized list, and a list with an undeclared member', () => {
        expect(refused({ list: [], separator: { key: 'messages.separator', fallback: ', ' } })).toThrow(/non-empty array/);
        expect(refused(slate(NOTIFICATION_LIST_PARAM_MAX_ITEMS + 1))).toThrow(/at most/);
        expect(refused({ ...slate(1), joiner: ', ' })).toThrow(/undeclared member 'joiner'/);
    });

    it('refuses a missing or malformed separator', () => {
        expect(refused({ list: slate(1).list })).toThrow(/separator must be/);
        expect(refused({ list: slate(1).list, separator: { key: 'separator', fallback: ', ' } })).toThrow(/separator\.key must be a catalog key/);
    });

    it('refuses an item that is not { key, params?, fallback }, and an item param that is a list', () => {
        expect(refused({ ...slate(1), list: ['team t1'] })).toThrow(/list\[0\] must be/);
        expect(refused(slate(1, 'slot'))).toThrow(/list\[0\]\.key must be a catalog key/);
        expect(refused({ ...slate(1), list: [{ key: 'messages.slot' }] })).toThrow(/list\[0\]\.fallback must be a string/);
        expect(refused({ ...slate(1), list: [{ key: 'messages.slot', params: { who: slate(1) }, fallback: 'x' }] }))
            .toThrow(/cannot be a list/);
        expect(refused({ ...slate(1), list: [{ key: 'messages.slot', params: { type: 42 }, fallback: 'x' }] }))
            .toThrow(/list\[0\]\.params\.type must be a string/);
    });

    it('a stored row whose list is malformed is delivered as its literal, as any malformed row is', () => {
        expect(readNotificationTextKeys({ bodyKey: 'messages.holding', params: { who: { list: [] } } })).toBeUndefined();
    });
});

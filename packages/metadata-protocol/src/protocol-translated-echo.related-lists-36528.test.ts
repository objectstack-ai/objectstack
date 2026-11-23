// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The save door's translated-echo restore on a `relatedLists` entry's
// `label`: the `/meta` read overlays `objects.<object>._relatedLists.<list>.label`
// onto it, Studio saves the whole body it read, and the translation must not
// become the stored title.

import { describe, it, expect } from 'vitest';
import { translateObject, type TranslationBundle } from '@objectstack/spec/system';
import { restoreTranslatedEchoes, translatedEchoNotices } from './protocol-translated-echo.js';

const bundle: TranslationBundle = {
    'zh-CN': { objects: { account: { _relatedLists: { contact: { label: '联系人' }, 'event.related_to': { label: '会议' } } } } },
};

const stored = () => ({
    name: 'account',
    label: 'Account',
    fields: {},
    relatedLists: [{ list: 'contact', label: 'People' }, { list: 'event.related_to', label: 'Meetings' }, 'case'],
});

describe('restoreTranslatedEchoes — a relatedLists entry\'s label', () => {
    it('puts a translated entry label back to its source, the dotted list included, and names each slot', () => {
        const echo = translateObject(stored(), bundle, { locale: 'zh-CN' });
        // The read did translate it: the case is real, not a no-op.
        expect((echo.relatedLists[0] as { label: string }).label).toBe('联系人');
        const { item, restored } = restoreTranslatedEchoes(echo, { source: stored(), bundle });
        expect((item as ReturnType<typeof stored>).relatedLists).toEqual(stored().relatedLists);
        expect(restored).toEqual([
            { path: 'relatedLists[contact].label', from: '联系人', to: 'People' },
            { path: 'relatedLists[event.related_to].label', from: '会议', to: 'Meetings' },
        ]);
        expect(translatedEchoNotices('account', restored)[0].path).toBe('objects.account.relatedLists[contact].label');
    });

    it('keeps a label the author typed that is no translation of its source', () => {
        const body = stored();
        body.relatedLists[0] = { list: 'contact', label: 'Key People' };
        const { item, restored } = restoreTranslatedEchoes(body, { source: stored(), bundle });
        expect(item).toBe(body);
        expect(restored).toEqual([]);
    });

    it('keeps a label on an entry the source does not title', () => {
        const source = stored();
        source.relatedLists[0] = { list: 'contact' } as never;
        const body = stored();
        body.relatedLists[0] = { list: 'contact', label: '联系人' };
        const { item } = restoreTranslatedEchoes(body, { source, bundle });
        expect(item).toBe(body);
    });
});

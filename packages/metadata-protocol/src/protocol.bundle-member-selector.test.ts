// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22877] THE one reading of the by-name doors' bundle member selector
 * (`resolveBundleMemberSelector`, ruling 6116165299 Q2 i): absent means the
 * canonical member, a well-formed member passes as named (trimmed), and a
 * wrong value is a located 400 `VALIDATION_ERROR` — the selector on a type
 * with no members, a value that is not a string, a blank one, and one longer
 * than a stored member can be. The doors that ask it are pinned on the real
 * engine in `@objectstack/objectql`'s `environment-overlay-email-locale-restart.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { SysMetadataObject } from '@objectstack/metadata-core';
import { BUNDLE_MEMBER_MAX_LENGTH, BUNDLE_MEMBER_SELECTOR, resolveBundleMemberSelector } from './protocol.js';

function refusal(type: string, member: unknown): { status?: number; code?: string; param?: string; message: string } {
    try {
        resolveBundleMemberSelector(type, member);
    } catch (e: any) {
        return { status: e.status, code: e.code, param: e.param, message: String(e.message) };
    }
    throw new Error(`expected ${JSON.stringify(member)} on '${type}' to be refused`);
}

describe('[#22877] resolveBundleMemberSelector', () => {
    it('is named `member`, never `locale`', () => {
        expect(BUNDLE_MEMBER_SELECTOR).toBe('member');
    });

    it('absent means the canonical member, for every type', () => {
        expect(resolveBundleMemberSelector('email_template', undefined)).toBeUndefined();
        expect(resolveBundleMemberSelector('view', undefined)).toBeUndefined();
    });

    it('a well-formed member passes as named, trimmed — the canonical value included', () => {
        expect(resolveBundleMemberSelector('email_template', 'zh-CN')).toBe('zh-CN');
        expect(resolveBundleMemberSelector('email_template', ' zh-CN ')).toBe('zh-CN');
        expect(resolveBundleMemberSelector('email_template', 'en-US')).toBe('en-US');
        // Either spelling of the type.
        expect(resolveBundleMemberSelector('email_templates', 'zh-CN')).toBe('zh-CN');
        expect(resolveBundleMemberSelector('email_template', 'x'.repeat(BUNDLE_MEMBER_MAX_LENGTH))).toHaveLength(100);
    });

    it('a type with no members refuses the selector, located', () => {
        const r = refusal('view', 'zh-CN');
        expect(r).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', param: 'member' });
        expect(r.message).toBe(
            'The "member" selector names a bundle member, and a \'view\' item has none: its identity is its name alone. '
            + 'Remove the selector.',
        );
    });

    it('a value that cannot name a member is refused: not a string, blank, or overlong', () => {
        expect(refusal('email_template', ['zh-CN'])).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', param: 'member' });
        expect(refusal('email_template', { zh: 'CN' }).message).toMatch(/^The "member" selector must be one string: the locale of one 'email_template' member/);
        const blank = refusal('email_template', '   ');
        expect(blank).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
        expect(blank.message).toMatch(/^The "member" selector is blank\. .*omit the selector to address the canonical member \('en-US'\)\.$/);
        const long = refusal('email_template', 'x'.repeat(BUNDLE_MEMBER_MAX_LENGTH + 1));
        expect(long).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
        expect(long.message).toMatch(/^The "member" selector is 101 characters long/);
    });

    it('the length bound IS the stored column\'s — a longer selector names no member that could be stored', () => {
        const column = (SysMetadataObject as any).fields.bundle_member;
        expect(column.maxLength).toBe(BUNDLE_MEMBER_MAX_LENGTH);
    });
});

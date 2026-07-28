// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3867 — the shared internal-leak predicate.
 *
 * It was extracted from `@objectstack/rest`'s `mapDataError` so the OTHER HTTP
 * boundary (the dispatcher-plugin routes) applies the same rule. These cases
 * pin both halves of its job: catch driver/SQL dumps, and leave deliberate
 * business messages alone — the second half matters because a false positive
 * on a 4xx would replace a real answer with "Internal server error".
 */

import { describe, it, expect } from 'vitest';
import { looksLikeInternalErrorLeak, INTERNAL_ERROR_MESSAGE } from './error-leak.js';

describe('looksLikeInternalErrorLeak', () => {
    it('catches the message that motivated #3867 (raw SQL from /analytics/query)', () => {
        expect(
            looksLikeInternalErrorLeak('SELECT  FROM "sqlite_sequence" - near "FROM": syntax error'),
        ).toBe(true);
    });

    it.each([
        ['sqlite dialect code', 'SQLITE_CONSTRAINT_NOTNULL: NOT NULL constraint failed: t.c'],
        ['postgres SQLSTATE', 'error: duplicate key value violates unique constraint (SQLSTATE 23505)'],
        ['bare INSERT', 'insert into `sys_team` (`id`) values (?) - some driver detail'],
        ['bare UPDATE', 'update `sys_team` set `name` = ? - failed'],
        ['bare DELETE', 'delete from `sys_team` where `id` = ? - failed'],
        ['constraint dump', 'NOT NULL constraint failed: sys_team.organization_id'],
        ['unique violation', 'UNIQUE constraint failed: sys_user.email'],
        ['foreign key', 'FOREIGN KEY constraint failed'],
    ])('catches %s', (_label, message) => {
        expect(looksLikeInternalErrorLeak(message)).toBe(true);
    });

    it.each([
        ['a business rule thrown by a hook', '删除被阻断:该客户下仍有未结订单'],
        ['a validation message', 'name is required'],
        ['a not-found message', "Object 'ghost' is not registered"],
        ['a permission denial', '[Security] Access denied: operation on object is not permitted'],
        // Anchored deliberately: a message may MENTION a verb without being SQL.
        ['a sentence merely mentioning update', 'Cannot update this record while it is locked'],
        ['a sentence merely mentioning select', 'Please select at least one row before exporting'],
    ])('leaves %s alone', (_label, message) => {
        expect(looksLikeInternalErrorLeak(message)).toBe(false);
    });

    it('is null-safe — an error with no message is not a leak', () => {
        expect(looksLikeInternalErrorLeak(undefined)).toBe(false);
        expect(looksLikeInternalErrorLeak(null)).toBe(false);
        expect(looksLikeInternalErrorLeak('')).toBe(false);
    });

    it('exposes a replacement message that names nothing internal', () => {
        expect(INTERNAL_ERROR_MESSAGE).toBe('Internal server error');
        expect(looksLikeInternalErrorLeak(INTERNAL_ERROR_MESSAGE)).toBe(false);
    });
});

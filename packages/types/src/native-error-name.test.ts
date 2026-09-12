// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17681] The one native-error-name reader, folded out of three copies.
 *
 * The cases below are the union of what the three doors relied on, pinned once
 * so a name learned here is learned everywhere:
 *
 *  - §1 every name in the list answers `true`, in BOTH slots the callers hold
 *    it against — the bare `name` a code hook throws, and the flattened
 *    `<name>: <message>` a sandbox puts in `innerMessage`;
 *  - §2 the omission of a plain `Error` — the load-bearing half, because a
 *    plain `Error` is the documented way to AUTHOR a refusal and a `true` here
 *    would withhold an author's words at every door at once;
 *  - §3 the two regex limbs, each with the case that only it refuses;
 *  - §4 the no-trim contract, which is what makes the fold behaviour-identical
 *    at three call sites that disagree about trimming.
 */

import { describe, it, expect } from 'vitest';
import { isNativeErrorName } from './native-error-name.js';

/**
 * The seven ECMA-262 native error constructors plus SpiderMonkey's
 * `InternalError`, which QuickJS raises for stack exhaustion.
 *
 * ⛔ Spelled out rather than derived from the predicate's own regex: a test
 * that reads its subject's pattern back asserts that the pattern equals itself
 * and would follow a name being dropped straight into a green run.
 */
const NATIVE_NAMES = [
    'TypeError',
    'ReferenceError',
    'RangeError',
    'SyntaxError',
    'URIError',
    'EvalError',
    'InternalError',
    'AggregateError',
] as const;

describe('§1 every native error name, in both slots', () => {
    it.each(NATIVE_NAMES)('%s — the bare `name` slot a CODE hook carries', (name) => {
        expect(isNativeErrorName(name)).toBe(true);
    });

    it.each(NATIVE_NAMES)('%s — the flattened `<name>: <message>` a sandbox carries', (name) => {
        expect(isNativeErrorName(`${name}: something went wrong`)).toBe(true);
    });

    it('the list is the whole list — a silent shrink is what this count catches', () => {
        expect(NATIVE_NAMES.length).toBe(8);
        expect(new Set(NATIVE_NAMES).size).toBe(8);
    });
});

describe('§2 a plain `Error` is an AUTHORED refusal, never a crash', () => {
    it.each([
        ['the bare name', 'Error'],
        ['the flattened form', 'Error: Opportunity is closed.'],
        ['an authored business sentence', 'Opportunity is closed.'],
        ['a Chinese business sentence', '数量超出范围'],
    ])('%s stays a refusal', (_label, text) => {
        expect(isNativeErrorName(text)).toBe(false);
    });

    it.each([
        ['the sandbox wrapper itself', "hook 'normalize_title' threw: TypeError: not a function"],
        ['a platform error class', 'SandboxError: capability denied'],
        ['a validation error class', 'ValidationFailedError: 2 fields'],
    ])('%s is not this predicate’s subject', (_label, text) => {
        expect(isNativeErrorName(text)).toBe(false);
    });
});

describe('§3 the two regex limbs, each with the case only it refuses', () => {
    it('`^` — prose that merely QUOTES a native name mid-sentence is not a crash report', () => {
        expect(isNativeErrorName('rejected with TypeError: check the template')).toBe(false);
        expect(isNativeErrorName('produced a TypeError in your template')).toBe(false);
    });

    it('`(?::|$)` — a longer identifier that merely STARTS with a native name is not one', () => {
        expect(isNativeErrorName('TypeErrorish')).toBe(false);
        expect(isNativeErrorName('RangeErrorReport: out of bounds')).toBe(false);
        expect(isNativeErrorName('TypeErrors are common')).toBe(false);
    });
});

describe('§4 the no-trim contract — the callers own their own trimming', () => {
    it('leading whitespace is NOT stripped here', () => {
        expect(isNativeErrorName('  TypeError: not a function')).toBe(false);
        expect(isNativeErrorName('\nTypeError')).toBe(false);
    });

    it('a caller that trims first gets the answer it had before the fold', () => {
        expect(isNativeErrorName('  TypeError: not a function'.trim())).toBe(true);
    });
});

describe('§5 absent input', () => {
    it.each([
        ['empty string', ''],
        ['undefined', undefined],
        ['null', null],
    ])('%s answers false rather than throwing', (_label, text) => {
        expect(isNativeErrorName(text as string | undefined | null)).toBe(false);
    });
});

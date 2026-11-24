// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { BUILTIN_OPERATION_MESSAGES, renderOperationMessage, resolveBundleLocale } from '@objectstack/spec/system';

/**
 * [#34699] Whose language a refusal's `userMessage` is in: the operation's
 * execution context, or any object carrying its two locale fields —
 * `locale` (the request's own, `ExecutionContext.locale`) and
 * `workspaceLocale` (the workspace default, the ladder's second rung).
 *
 * Typed `object`, not an interface of two optional fields: the contexts that
 * reach producers (engine, hook and middleware contexts, test callers) mostly
 * declare neither field, and TypeScript refuses such a value for an all-optional
 * type it shares no property with. The fields are read defensively instead: a
 * rung that is not a non-empty string the catalog carries is skipped.
 */
export type UserMessageCaller = object;

interface CallerLocales {
    readonly locale?: unknown;
    readonly workspaceLocale?: unknown;
}

/**
 * [#34699] A placeholder-free sentence of the shared operation-message catalog
 * (`BUILTIN_OPERATION_MESSAGES`, `@objectstack/spec/system`) in the caller's
 * language: the `userMessage` a producer marks beside a developer `message`.
 *
 * The locale is the first rung of the caller's ladder the built-in catalog
 * carries — the request's locale, then the workspace default — the ladder
 * plugin-security's refusals use, so a request in a language the catalog has
 * no text in falls to the workspace default before `en`. Absent both, `en`.
 *
 * For producers that hold no `i18n` service: no deployment `errors.<key>`
 * override is consulted. A producer that holds one renders through
 * `renderOperationMessage` with its `translate` instead.
 */
export function operationUserMessage(messageKey: string, caller?: UserMessageCaller | null): string {
    const rungs = caller as CallerLocales | null | undefined;
    const locale = [rungs?.locale, rungs?.workspaceLocale].find(
        (candidate): candidate is string =>
            typeof candidate === 'string' &&
            candidate.length > 0 &&
            resolveBundleLocale(BUILTIN_OPERATION_MESSAGES, candidate) !== undefined,
    );
    return renderOperationMessage({ messageKey }, { locale });
}

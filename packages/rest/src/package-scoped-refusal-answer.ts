// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32201, ADR-0150 D5] The `/meta` by-name read's package-scoped refusal on
 * this transport: the answer `handleRouteError` writes for it (`409`, the flat
 * `{ error, code: 'RESOURCE_CONFLICT' }`, the refusal's own sentence), with the
 * holders added as `details.candidates` — the `PackageScopedHolder` list the
 * runtime dispatcher's `/meta`, `/automation` and `/actions` doors answer.
 *
 * Additive only: every member the flat body carried stays as it was, and the
 * holders are the ones the sentence already names, so the answer tells the
 * caller nothing the message did not. A client reads them where it reads any
 * flat body's context (`body.details`).
 */

import { PackageScopedNameRefusedError, type PackageScopedHolder } from '@objectstack/core';
import { classifiedRefusalAnswer, handleRouteError } from './error-response.js';

/**
 * The refusal's holders, or `undefined` for any other thrown value. Recognised
 * by class and, as `import-mapping.ts` and the runtime's `/meta` door recognise
 * it, by shape (`code === 'RESOURCE_CONFLICT'` with a `refusal` whose `status`
 * is `'refused'`), for an error that crossed a second copy of
 * `@objectstack/core`.
 */
function packageScopedRefusalCandidates(error: unknown): readonly PackageScopedHolder[] | undefined {
    const thrown = error as { code?: unknown; refusal?: { status?: unknown; candidates?: unknown } } | null | undefined;
    const recognised = error instanceof PackageScopedNameRefusedError
        || (thrown?.code === 'RESOURCE_CONFLICT' && thrown.refusal?.status === 'refused');
    const candidates = recognised ? thrown?.refusal?.candidates : undefined;
    return Array.isArray(candidates) ? (candidates as readonly PackageScopedHolder[]) : undefined;
}

/**
 * Answer a caught value: the package-scoped refusal with its candidates, or,
 * for anything else (and for a refusal this door would not answer as a 4xx),
 * exactly what `handleRouteError` answers.
 */
export function handleMetaReadRouteError(res: any, error: unknown): void {
    const candidates = packageScopedRefusalCandidates(error);
    const resolved = candidates ? classifiedRefusalAnswer(error) : undefined;
    if (!candidates || !resolved) {
        handleRouteError(res, error);
        return;
    }
    const details = resolved.body.details as Record<string, unknown> | undefined;
    res.status(resolved.status).json({ ...resolved.body, details: { ...(details ?? {}), candidates } });
}

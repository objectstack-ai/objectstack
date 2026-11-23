// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `fetchInstalledPackageRow` — the installed-row read behind the package
 * management sheet, read today by the Studio landing cards' Manage
 * (objectstack#35196).
 *
 * These pins moved here from the two surface files that drove the read
 * through the Studio top bar's package switcher (objectui#7881's
 * `packageLookupFailure` and objectui#7938's `packageUserMessage`): the
 * switcher was removed by objectstack#36501, and the read it shared lives on.
 * Each case is the same wire answer those files served, asserted at the
 * helper itself.
 *
 *  - objectui#7881: a failed read is not an empty result. The ADR-0112
 *    failure envelope parses cleanly, so without `res.ok` a 503 read as "the
 *    list has no such package"; it THROWS now, with the code beside the words,
 *    and only a successful list that lacks the package answers `null`.
 *  - objectui#7938: a producer-marked `error.userMessage` outranks `message`,
 *    at every status; `code` composes with whichever sentence won, and a body
 *    with no prose names the status.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchInstalledPackageRow } from './PackageSwitcher';

const PACKAGE_ID = 'app.b2r4';
const GENERIC = 'Internal server error';
const MARKED = 'Publishing is temporarily unavailable. Nothing was changed.';

function answer(response: { ok: boolean; status: number; json: () => Promise<unknown> }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response),
  );
}
const listOk = (packages: unknown[]) =>
  answer({ ok: true, status: 200, json: async () => ({ success: true, data: { packages, total: packages.length } }) });
const listFailure = (status: number, error: Record<string, unknown>) =>
  answer({ ok: false, status, json: async () => ({ success: false, error }) });

/** The message the read throws with, for a failed answer. */
async function thrownFor(status: number, error: Record<string, unknown>): Promise<string> {
  listFailure(status, error);
  const failure = await fetchInstalledPackageRow(PACKAGE_ID).then(
    () => null,
    (e: unknown) => e,
  );
  expect(failure).toBeInstanceOf(Error);
  return (failure as Error).message;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a failed read is not an empty result (objectui#7881)', () => {
  it('a 503 envelope throws its message and code', async () => {
    expect(await thrownFor(503, { code: 'SERVICE_UNAVAILABLE', message: GENERIC })).toBe(
      'Internal server error (SERVICE_UNAVAILABLE)',
    );
  });

  it('a 403 envelope carries the server’s own sentence', async () => {
    expect(
      await thrownFor(403, {
        code: 'FORBIDDEN',
        message: 'Reading packages requires the `studio.access` or `setup.access` capability.',
      }),
    ).toBe('Reading packages requires the `studio.access` or `setup.access` capability. (FORBIDDEN)');
  });

  it('a 401 envelope throws too', async () => {
    expect(await thrownFor(401, { code: 'UNAUTHENTICATED', message: 'Authentication required' })).toBe(
      'Authentication required (UNAUTHENTICATED)',
    );
  });

  it('a non-JSON error body names the status, not a JSON syntax error', async () => {
    answer({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError("Unexpected token '<', \"<html>\"... is not valid JSON");
      },
    });
    await expect(fetchInstalledPackageRow(PACKAGE_ID)).rejects.toThrow(/^HTTP 502$/);
  });

  it('a SUCCESSFUL list without the package answers null', async () => {
    listOk([]);
    await expect(fetchInstalledPackageRow(PACKAGE_ID)).resolves.toBeNull();
  });

  it('CONTROL — a successful list with the package answers its row', async () => {
    listOk([{ manifest: { id: PACKAGE_ID, name: PACKAGE_ID }, writable: true }]);
    await expect(fetchInstalledPackageRow(PACKAGE_ID)).resolves.toMatchObject({ manifest: { id: PACKAGE_ID } });
  });

  it('CONTROL — the bare-array body the endpoint also serves reads the same', async () => {
    answer({ ok: true, status: 200, json: async () => [{ manifest: { id: PACKAGE_ID, name: PACKAGE_ID } }] });
    await expect(fetchInstalledPackageRow(PACKAGE_ID)).resolves.toMatchObject({ manifest: { id: PACKAGE_ID } });
  });
});

describe('a producer-marked userMessage reaches the author (objectui#7938)', () => {
  it('`message` only: the diagnostic prose with its code, unchanged', async () => {
    expect(await thrownFor(409, { code: 'RESOURCE_CONFLICT', message: 'version 1.2.0 already published' })).toBe(
      'version 1.2.0 already published (RESOURCE_CONFLICT)',
    );
  });

  it('`userMessage` only: the marked text, never the bare status', async () => {
    expect(await thrownFor(503, { code: 'SERVICE_UNAVAILABLE', userMessage: MARKED })).toBe(
      `${MARKED} (SERVICE_UNAVAILABLE)`,
    );
  });

  it('both, in the 5xx band: the mark displaces the generic sentence', async () => {
    const shown = await thrownFor(500, { code: 'INTERNAL_ERROR', message: GENERIC, userMessage: MARKED });
    expect(shown).toBe(`${MARKED} (INTERNAL_ERROR)`);
    expect(shown).not.toContain(GENERIC);
  });

  it('both, in the 4xx band: the mark still wins', async () => {
    expect(
      await thrownFor(409, {
        code: 'RESOURCE_CONFLICT',
        message: 'version 1.2.0 already published for app.b2r4',
        userMessage: 'That version is already published. Bump the version and retry.',
      }),
    ).toBe('That version is already published. Bump the version and retry. (RESOURCE_CONFLICT)');
  });

  it('a marked body with no code: the bare sentence', async () => {
    expect(await thrownFor(503, { message: GENERIC, userMessage: MARKED })).toBe(MARKED);
  });

  it('no prose, a code present: the status, and the code is not it', async () => {
    expect(await thrownFor(503, { code: 'SERVICE_UNAVAILABLE' })).toBe('HTTP 503');
  });

  it('a non-string or empty `userMessage` is not a mark', async () => {
    expect(await thrownFor(500, { code: 'INTERNAL_ERROR', message: GENERIC, userMessage: 42 })).toBe(
      `${GENERIC} (INTERNAL_ERROR)`,
    );
    expect(await thrownFor(500, { code: 'INTERNAL_ERROR', message: GENERIC, userMessage: '' })).toBe(
      `${GENERIC} (INTERNAL_ERROR)`,
    );
  });
});

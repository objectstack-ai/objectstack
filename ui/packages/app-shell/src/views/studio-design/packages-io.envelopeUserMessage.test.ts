// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7959 — the `packages-io` readers open the failure envelope.
 *
 * ## What was lost, measured
 *
 * `fetchPackages` answered a refusal with `throw new Error(\`HTTP ${status}\`)`.
 * It never opened the body, so `message`, `code` and `userMessage` were
 * discarded together — a strictly larger loss than the sibling
 * `fetchFullPackage` lookup's (objectui#7938), which at least read `message`
 * and `code`.
 *
 * That matters because every caller of this read reports the words: the Studio
 * switcher, the writability courtesy gate and the namespace lookup all render
 * `formatMetadataError(e)` — which returns `err.message` — onto the shared
 * `studio-package-list` sonner id (objectui#7368's posture), and the builder
 * landing page puts the same string in its error banner. So the plumbing to
 * display a sentence was already there and already wired; what was missing was
 * a sentence to put in it. A 403 whose envelope named the capability to grant
 * reached the author as the four characters `HTTP 403`.
 *
 * `duplicatePackage`, a hundred lines below it in the same module, read
 * `error.message` alone — a third reading of the same envelope, dropping the
 * mark and the code. Both now ask one shared rule
 * (`utils/apiErrorEnvelope.ts`), pinned on its own in `apiErrorEnvelope.test.ts`.
 *
 * ## Both doors serving these routes emit the marked channel
 *
 * Not assumed — read from the producers. `sendThrownError`
 * (`@objectstack/rest` `package-routes.ts`) spreads
 * `...(thrown.userMessage !== undefined ? { userMessage: thrown.userMessage } : {})`
 * beside `details`/`declaredCode`, and its own note calls that expression
 * "byte for byte the dispatcher twin's" — `errorFromThrown`
 * (`@objectstack/runtime` `http-dispatcher.ts`), which serves the lifecycle
 * routes including `/duplicate` and has emitted the channel since #9934.
 * `sendError` nests the whole object under `error`, which is the path these
 * pins drive. The framework pins the wire side in
 * `packages/rest/src/package-door-user-message.test.ts`.
 *
 * ## ⚠️ Where this file's §1 differs from objectui#7938's §1 — read before reverting
 *
 * objectui#7938's `message`-only pin is GREEN with its fix reverted, because
 * that reader already rendered `error.message`; its §1 is the guard that stops
 * "prefer `userMessage`" from sliding into "read `userMessage` INSTEAD".
 *
 * Here it CANNOT be green when reverted, and the difference is the defect, not
 * a weaker pin: the pre-fix `fetchPackages` opened no body at all, so the
 * unmarked refusal was as lost as the marked one. §1 below is therefore a
 * forward assertion of the same guarantee (an unmarked refusal renders its
 * diagnostic, not the status) and goes RED on revert along with §2 and §3. The
 * "still green when reverted" role is held here by §7 (an unreadable body still
 * names the status) and §8 (a successful read is untouched) — without them, a
 * "fix" that reported on every read, or that broke the success path by
 * consuming the body twice, would satisfy every assertion above.
 *
 * The `apiJson` twin (`PackagesPage.envelopeUserMessage.test.tsx` §1) DOES hold
 * the green-when-reverted guard, because that reader did already render
 * `error.message`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { duplicatePackage, fetchPackages } from './packages-io';

/** The generic sentence the 5xx prose withhold substitutes (`INTERNAL_ERROR_MESSAGE`). */
const GENERIC = 'Internal server error';
/** A producer's marked text: what `userMessage` carries, written for the author. */
const MARKED = 'Publishing is temporarily unavailable. Nothing was changed.';
/**
 * The card's measured sample. A 403 that names the very capability to grant —
 * and the reader was reporting it as `HTTP 403`.
 */
const CAPABILITY = 'Reading packages requires the `studio.access` or `setup.access` capability.';

/** A failure exactly as `sendError` writes it — `{ code, message, ...extra }` under `error`. */
function failure(status: number, error: Record<string, unknown>): Response {
  return {
    ok: false,
    status,
    json: async () => ({ success: false, error }),
  } as unknown as Response;
}

/** The success shape: `sendOk` wraps the handler's `{ packages, total }`. */
function listOk(packages: unknown[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: { packages, total: packages.length } }),
  } as unknown as Response;
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** What `formatMetadataError` would hand the toast — i.e. what the author reads. */
async function reportedFor(status: number, error: Record<string, unknown>): Promise<string> {
  stubFetch(failure(status, error));
  return await fetchPackages().then(
    () => {
      throw new Error('fetchPackages resolved on a refusal');
    },
    (e: unknown) => (e as Error).message,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchPackages — the four combinations (#7959)', () => {
  /**
   * ⚠️ RED when the fix is reverted, unlike objectui#7938's §1 — see the file
   * docblock. The pre-fix reader opened no body, so the unmarked refusal was
   * lost too. The guarantee asserted is the same one: an unmarked refusal
   * renders its diagnostic and is NOT displaced by anything.
   */
  it('§1 `message` only — the unmarked refusal reaches the author with its code', async () => {
    expect(await reportedFor(403, { code: 'FORBIDDEN', message: CAPABILITY })).toBe(
      `${CAPABILITY} (FORBIDDEN)`,
    );
  });

  it('§2 `userMessage` only — the marked sentence, not the bare status', async () => {
    const shown = await reportedFor(503, { code: 'SERVICE_UNAVAILABLE', userMessage: MARKED });
    expect(shown).toBe(`${MARKED} (SERVICE_UNAVAILABLE)`);
    expect(shown).not.toBe('HTTP 503');
  });

  it('§3 both — the mark displaces the generic substitution, it is not appended to it', async () => {
    const shown = await reportedFor(500, { code: 'INTERNAL_ERROR', message: GENERIC, userMessage: MARKED });
    expect(shown).toBe(`${MARKED} (INTERNAL_ERROR)`);
    expect(shown).not.toContain(GENERIC);
  });

  it('§4 neither — the status is still the honest answer', async () => {
    expect(await reportedFor(503, { code: 'SERVICE_UNAVAILABLE' })).toBe('HTTP 503');
  });
});

describe('fetchPackages — `message` and `code` arrive too, not only the mark (#7959)', () => {
  /**
   * ⭐ This reader's loss was not one optional field: the body was never opened.
   * So the fix has to be shown delivering the WHOLE envelope, and these two
   * cases would both be satisfied by a fix that read only `userMessage`.
   */
  it('the diagnostic sentence now reaches the author at all', async () => {
    expect(await reportedFor(403, { code: 'FORBIDDEN', message: CAPABILITY })).toContain(CAPABILITY);
  });

  it('the machine code now reaches the author at all', async () => {
    expect(await reportedFor(409, { code: 'RESOURCE_CONFLICT', message: 'version 1.2.0 already published' })).toBe(
      'version 1.2.0 already published (RESOURCE_CONFLICT)',
    );
  });

  it('the card\'s measured 403 sample is no longer reported as four characters', async () => {
    const shown = await reportedFor(403, { code: 'FORBIDDEN', message: CAPABILITY });
    expect(shown).not.toBe('HTTP 403');
    expect(shown).toContain('studio.access');
    expect(shown).toContain('setup.access');
  });
});

describe('fetchPackages — how `code` composes, and what is not a mark', () => {
  it('a marked body with NO code renders the bare sentence', async () => {
    expect(await reportedFor(503, { message: GENERIC, userMessage: MARKED })).toBe(MARKED);
  });

  it('a code with no prose is still just the status — a code is not a sentence', async () => {
    expect(await reportedFor(503, { code: 'SERVICE_UNAVAILABLE' })).toBe('HTTP 503');
  });

  it('a non-string `userMessage` is not a mark — it falls through to `message`', async () => {
    expect(await reportedFor(500, { code: 'INTERNAL_ERROR', message: GENERIC, userMessage: 42 })).toBe(
      `${GENERIC} (INTERNAL_ERROR)`,
    );
  });

  it('an empty-string `userMessage` is not a mark either', async () => {
    expect(await reportedFor(500, { code: 'INTERNAL_ERROR', message: GENERIC, userMessage: '' })).toBe(
      `${GENERIC} (INTERNAL_ERROR)`,
    );
  });

  /**
   * ⛔ NOT scoped to 5xx. The producing door applies no status condition to the
   * marked channel, so a consumer that honoured it in one band only would
   * re-create on the reading end the divergence that door refused to create on
   * the writing end (ruled on objectui#7938).
   */
  it('prefers the mark in the 4xx band too, where `message` was never withheld', async () => {
    expect(
      await reportedFor(409, {
        code: 'RESOURCE_CONFLICT',
        message: 'version 1.2.0 already published for app.b2r4',
        userMessage: 'That version is already published. Bump the version and retry.',
      }),
    ).toBe('That version is already published. Bump the version and retry. (RESOURCE_CONFLICT)');
  });
});

describe('fetchPackages — negative controls (GREEN with the fix reverted)', () => {
  /**
   * ⭐ §7. A proxy's HTML 502 has no envelope to read. The status is then the
   * only honest thing to say, and it is what `packageListErrorPosture` /
   * `manageSnapshotRefresh` already pin downstream.
   */
  it('§7 an unparseable body still names the status', async () => {
    stubFetch({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError("Unexpected token '<', \"<html>\"... is not valid JSON");
      },
    } as unknown as Response);

    await expect(fetchPackages()).rejects.toThrow('HTTP 502');
  });

  /**
   * ⭐ §8. The success path is untouched — and specifically the body is still
   * read exactly once on it. A fix that moved the `res.json()` call, or that
   * consumed the body on both arms, would break this while satisfying every
   * failure assertion above.
   */
  it('§8 a successful read still parses the list and reports nothing', async () => {
    stubFetch(
      listOk([
        { manifest: { id: 'app.b2r4', name: 'Leave', scope: 'project' }, writable: true },
        { manifest: { id: 'app.kernel', scope: 'system' } },
      ]),
    );

    const list = await fetchPackages();
    expect(list).toEqual([{ id: 'app.b2r4', name: 'Leave', writable: true, namespace: 'b2r4' }]);
  });
});

/**
 * The second reader in this module. It is here rather than in a card of its own
 * because leaving a hand-rolled copy of the rule a hundred lines below the
 * import is precisely the drift the extraction exists to stop — and because
 * `/packages/:id/duplicate` is served by the dispatcher door, the twin that has
 * emitted the marked channel since #9934.
 *
 * `packages-io.duplicateEnvelope.test.ts` keeps pinning what this reader is
 * mainly about — the OPERATION's verdict inside a 200 — and is unaffected.
 */
describe('duplicatePackage — the same envelope, the same rule (#7959)', () => {
  it('renders a producer-marked sentence that the old `error.message` read dropped', async () => {
    stubFetch(failure(503, { code: 'SERVICE_UNAVAILABLE', message: GENERIC, userMessage: MARKED }));

    await expect(duplicatePackage('a.b.c', 'a.b.d')).rejects.toThrow(`${MARKED} (SERVICE_UNAVAILABLE)`);
  });

  it('still renders the diagnostic when nothing was marked — now with its code', async () => {
    stubFetch(failure(403, { code: 'PERMISSION_DENIED', message: 'Permission denied: manage_metadata is required' }));

    await expect(duplicatePackage('a.b.c', 'a.b.d')).rejects.toThrow(
      'Permission denied: manage_metadata is required (PERMISSION_DENIED)',
    );
  });

  it('still falls back to the status when the body is unreadable', async () => {
    stubFetch({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
    } as unknown as Response);

    await expect(duplicatePackage('a.b.c', 'a.b.d')).rejects.toThrow('HTTP 502');
  });
});

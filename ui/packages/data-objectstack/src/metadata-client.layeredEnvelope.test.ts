// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `MetadataClient.layered()` validates the ADR-0010 protection envelope at the
 * boundary (objectui#5676).
 *
 * ## The defect, measured rather than argued
 *
 * The envelope used to arrive by ten `as` assertions over a raw `res.json()`
 * body — no parse, no allowlist, no default. The banner that consumes it opens
 * on `layered?.lock && layered.lock !== 'none'`, which is true for ANY non-`none`
 * value, so a server sending a lock state this console had never heard of opened
 * the amber box, drew the padlock and the border, and rendered an empty title.
 * No fifth state ever had to be added to this repo for that to happen — which is
 * why objectui#5024's duplicated-union framing could not have caught it. A union
 * types what this repo WRITES and constrains nothing about what a server SENDS.
 *
 * ## What is pinned here, and what is deliberately pinned elsewhere
 *
 * The ruling is "pass through and label", extending to the whole envelope the
 * treatment objectui#5672 chose for `lock` alone. That splits across two files
 * and neither half is sufficient on its own:
 *
 *   - THIS file pins the boundary: recognised values arrive typed from the
 *     producer's own schema, unrecognised ones are still FORWARDED (never
 *     dropped, never thrown) and are named in `_unrecognized`.
 *   - `ResourceEditPage.lockBanner.test.tsx` pins the screen: a token the banner
 *     cannot read is titled with the raw token instead of rendering blank.
 *
 * The forwarding assertions below are exactly the precondition that file's
 * fixtures assume. Together they are the ruled "an unknown `lock` token still
 * reaches the banner labelled"; separately, each is green against a client that
 * fails the other half.
 *
 * ## Why `safeParse` and not `parse`
 *
 * A bare `.parse()` was refused by name on the filing card: it turns a
 * silently-wrong render into a thrown or rejected response, which is a behaviour
 * change for every consumer of this client rather than a tightening of types. A
 * metadata console that rejected every dialect it had not been compiled against
 * would answer a newer server with a blank page — strictly worse than the wrong
 * render being fixed. The counter-probe at the bottom of this file is what keeps
 * that option refused: it is green only while structurally malformed bodies
 * RESOLVE, so an implementation that throws on anything it does not recognise
 * cannot pass this suite even though it would satisfy every other assertion.
 */
import { describe, expect, it } from 'vitest';
import { GetMetaItemLayeredResponseSchema } from '@objectstack/spec/api';
import { MetadataClient } from './metadata-client';

const BASE_URL = 'http://localhost:3000';

/** A client over a fetch that answers `body` for any request. */
function clientAnswering(body: unknown) {
  return new MetadataClient({
    baseUrl: BASE_URL,
    fetch: (async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch,
  });
}

/**
 * A body every field of which the producer's own schema accepts. Guarded as
 * such in the first test, so the conforming case cannot go green against a
 * shape no server sends.
 */
const CONFORMING = {
  type: 'object',
  name: 'showcase_project',
  code: { name: 'showcase_project', label: 'Project' },
  overlay: { label: 'Projects (ours)' },
  overlayScope: 'env',
  effective: { name: 'showcase_project', label: 'Projects (ours)' },
  lock: 'no-delete',
  lockReason: 'shipped by the crm package',
  lockSource: 'package',
  lockDocsUrl: 'https://docs.objectstack.ai/metadata/locks',
  provenance: 'package',
  packageId: 'crm',
  packageVersion: '1.2.3',
  editable: true,
  deletable: false,
  resettable: true,
} as const;

/** The seven fields the filing card names as cast through unchecked. */
const RULED_FIELDS = [
  'overlayScope',
  'lock',
  'lockSource',
  'provenance',
  'editable',
  'deletable',
  'resettable',
] as const;

describe('objectui#5676 · (a) a conforming envelope types cleanly', () => {
  it('is a body the producer accepts in the first place', () => {
    // Fixture guard before any value verdict: a vocabulary is being asserted,
    // so the body must parse fully green rather than merely avoid unknown keys.
    const parsed = GetMetaItemLayeredResponseSchema.safeParse(CONFORMING);
    expect(parsed.success).toBe(true);
  });

  it('hands back all seven ruled fields with the values the server sent', async () => {
    const layered = await clientAnswering(CONFORMING).layered('object', 'showcase_project');

    expect(layered.overlayScope).toBe('env');
    expect(layered.lock).toBe('no-delete');
    expect(layered.lockSource).toBe('package');
    expect(layered.provenance).toBe('package');
    expect(layered.editable).toBe(true);
    expect(layered.deletable).toBe(false);
    expect(layered.resettable).toBe(true);
  });

  it('flags nothing — `_unrecognized` is absent, not merely empty', async () => {
    const layered = await clientAnswering(CONFORMING).layered('object', 'showcase_project');

    // Absence is the signal. An always-present empty array would make every
    // consumer test for length instead of presence, and would break the exact
    // `toEqual` shape assertion in `metadata-client.layeredRoute.test.ts`.
    expect(layered._unrecognized).toBeUndefined();
    expect('_unrecognized' in layered).toBe(false);
  });
});

describe('objectui#5676 · (b) an unknown token degrades ONE field, and is labelled', () => {
  const UNKNOWN_LOCK = { ...CONFORMING, lock: 'no-publish' };

  it('is a body the producer REJECTS, so the case under test is the real one', () => {
    const parsed = GetMetaItemLayeredResponseSchema.safeParse(UNKNOWN_LOCK);
    expect(parsed.success).toBe(false);
  });

  it('resolves rather than throwing or rejecting', async () => {
    await expect(
      clientAnswering(UNKNOWN_LOCK).layered('object', 'showcase_project'),
    ).resolves.toBeDefined();
  });

  it('forwards the raw token, which is what lets the banner name it', async () => {
    const layered = await clientAnswering(UNKNOWN_LOCK).layered('object', 'showcase_project');

    // Dropping it would be the reject semantics the card refused: the operator
    // who meets this banner is the only person able to report which state their
    // server actually sent, and `lockBannerTitle` renders `String(lock)` for
    // exactly this case (objectui#5672).
    expect(layered.lock).toBe('no-publish');
  });

  it('labels the offending field by name', async () => {
    const layered = await clientAnswering(UNKNOWN_LOCK).layered('object', 'showcase_project');

    expect(layered._unrecognized).toEqual(['lock']);
  });

  it('costs the other six fields NOTHING — the granularity that makes this a degrade', async () => {
    const layered = await clientAnswering(UNKNOWN_LOCK).layered('object', 'showcase_project');

    // The trap this closes: `GetMetaItemLayeredResponseSchema.safeParse(body)`
    // is all-or-nothing. One unknown `lock` returns `success: false` with `data`
    // undefined, so a boundary that leaned on it alone would degrade the WHOLE
    // envelope every time a server spoke a newer dialect — a subtler version of
    // the bug being fixed. These six are the assertion that it does not.
    expect(layered.overlayScope).toBe('env');
    expect(layered.lockSource).toBe('package');
    expect(layered.provenance).toBe('package');
    expect(layered.editable).toBe(true);
    expect(layered.deletable).toBe(false);
    expect(layered.resettable).toBe(true);
  });

  it.each(RULED_FIELDS)('flags an off-spec `%s` without flagging its neighbours', async (field) => {
    // Table-driven so the guard covers the whole ruled surface rather than the
    // one field that happened to be reported. `null` is off-spec for every one
    // of the seven except `overlayScope`, which is nullable by declaration.
    const offSpec = field === 'overlayScope' ? 'tenant' : null;
    const layered = await clientAnswering({ ...CONFORMING, [field]: offSpec }).layered(
      'object',
      'showcase_project',
    );

    expect(layered._unrecognized).toEqual([field]);
    // …and it still arrives, rather than being silently dropped.
    expect(layered[field]).toBe(offSpec);
  });
});

describe('objectui#5676 · (c) counter-probe — a malformed envelope must not throw', () => {
  /**
   * Structurally wrong, not merely unknown-valued: wrong JSON types on fields
   * whose vocabulary is not even the question. Without this case, "degrade and
   * label" is satisfiable by code that throws on anything it cannot recognise,
   * which is precisely the option the card refused.
   */
  const MALFORMED = {
    ...CONFORMING,
    lock: 42,
    lockSource: { layer: 'artifact' },
    editable: 'yes',
    overlayScope: [],
    packageVersion: 7,
  };

  it('resolves — the promise is not rejected', async () => {
    await expect(
      clientAnswering(MALFORMED).layered('object', 'showcase_project'),
    ).resolves.toBeDefined();
  });

  it('names every malformed field and still forwards the layers', async () => {
    const layered = await clientAnswering(MALFORMED).layered('object', 'showcase_project');

    expect(layered._unrecognized).toEqual([
      'overlayScope',
      'lock',
      'lockSource',
      'packageVersion',
      'editable',
    ]);
    // The three layers are the reason this endpoint exists; a malformed
    // protection envelope may not cost the caller the data it came for.
    expect(layered.code).toEqual(CONFORMING.code);
    expect(layered.effective).toEqual(CONFORMING.effective);
    // Untouched envelope fields keep their values.
    expect(layered.deletable).toBe(false);
    expect(layered.provenance).toBe('package');
  });

  it.each([
    ['a body that is not an object', 'nonsense'],
    ['a null body', null],
    ['an array body', []],
    ['every envelope field wrong at once', Object.fromEntries(RULED_FIELDS.map((f) => [f, Symbol.iterator.toString()]))],
  ])('does not throw for %s', async (_label, body) => {
    await expect(clientAnswering(body).layered('object', 'x')).resolves.toBeDefined();
  });
});

describe('objectui#5676 · a pre-ADR-0010 server is not an error case', () => {
  it('sends no protection envelope, and nothing is flagged', async () => {
    // The four resolved verdicts are REQUIRED upstream on this path, so this
    // body fails the whole-envelope parse and takes the degrade branch. That
    // branch must be indistinguishable from the old behaviour: absence is a
    // legitimate envelope, not an unrecognised one.
    const legacy = { type: 'object', name: 'x', code: { a: 1 }, overlay: null, overlayScope: null, effective: { a: 1 } };
    expect(GetMetaItemLayeredResponseSchema.safeParse(legacy).success).toBe(false);

    const layered = await clientAnswering(legacy).layered('object', 'x');

    expect(layered).toEqual({ code: { a: 1 }, overlay: null, overlayScope: null, effective: { a: 1 } });
    expect(layered._unrecognized).toBeUndefined();
  });
});

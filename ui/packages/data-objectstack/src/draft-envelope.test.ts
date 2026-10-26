// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins the ONE draft-envelope reader (objectui#8181).
 *
 * ## What this file is defending
 *
 * `extractDraftBody` used to exist four times — three copies spelled
 * identically in `ResourceEditPage`, `StudioDesignSurface` and
 * `PackageOwdOverviewPanel`, plus a hand-rolled fourth in `ObjectHooksPanel`.
 * objectui#7603 taught exactly one of them to strip the framework's read
 * decorations. Hoisting the function is what makes "the next copy omits the
 * strip again" impossible, and these cases are what keep the hoisted one
 * honest.
 *
 * ## The three properties, and why none is optional
 *
 * 1. **The decorations come off.** `getDraft()` serves
 *    `item: decorateMetadataItem(type, ...)`, which attaches `_diagnostics`
 *    for any type with a registered Zod schema, and the draft branch stamps
 *    `_draft: true` first. The spec says a served body "is therefore NOT a
 *    valid input to the schema that produced it until these are removed".
 * 2. **The ADR-0010 protection envelope does NOT come off.** `_lock`,
 *    `_provenance`, `_packageId`, `_packageVersion` share the underscore
 *    spelling and are DECLARED by the closed schemas so provenance survives a
 *    re-parse. A strip that took them would be the "drop whatever looks
 *    internal" pass AGENTS.md #0.1 bans, and it would make the publish-review
 *    diff blind to a real provenance change.
 * 3. **The presence verdict runs BEFORE the strip.** What counts as a pending
 *    draft is the server's answer. A draft carrying nothing but decorations is
 *    still a served draft: it must come back as an EMPTY OBJECT (truthy — the
 *    callers all test `!!body` for "has pending changes"), never as `null`.
 *    Reversing the order silently converts "there is a draft to publish" into
 *    "nothing pending", which is the worse failure of the two.
 */

import { describe, it, expect } from 'vitest';
import { METADATA_READ_DECORATIONS } from '@objectstack/spec/kernel';
import { extractDraftBody } from './draft-envelope';

/** The decorations exactly as the framework serves them on a draft read. */
const DECORATIONS = { _diagnostics: { valid: true, errors: [] }, _draft: true };

/** ADR-0010 protection carriers — declared by the schemas, never stripped. */
const PROTECTION = {
  _lock: { locked: true },
  _provenance: 'package',
  _packageId: 'crmext',
  _packageVersion: '1.2.0',
};

const envelope = (item: unknown) => ({ type: 'object', name: 'crmext_visit', item });

describe('extractDraftBody — the hoisted draft-envelope reader (objectui#8181)', () => {
  it('is the spec list that gets removed, not a local one', () => {
    // The control for every "was it stripped?" assertion below: if the spec
    // ever adds a third decoration, this file must be read again.
    expect([...METADATA_READ_DECORATIONS]).toEqual(['_diagnostics', '_draft']);
  });

  it('removes the read decorations and leaves the authored body untouched', () => {
    const body = extractDraftBody(
      envelope({ name: 'crmext_visit', label: 'Visit', fields: { a: {} }, ...DECORATIONS }),
    );
    expect(body).toEqual({ name: 'crmext_visit', label: 'Visit', fields: { a: {} } });
    expect(Object.keys(body!)).not.toContain('_diagnostics');
    expect(Object.keys(body!)).not.toContain('_draft');
  });

  it('leaves the ADR-0010 protection envelope alone', () => {
    const body = extractDraftBody(
      envelope({ name: 'crmext_visit', ...PROTECTION, ...DECORATIONS }),
    )!;
    // Every protection carrier survives BY NAME…
    for (const [k, v] of Object.entries(PROTECTION)) expect(body[k]).toEqual(v);
    // …and the decorations still went, in the same call. Without this half the
    // case above would pass on a function that strips nothing at all.
    expect(body).not.toHaveProperty('_diagnostics');
    expect(body).not.toHaveProperty('_draft');
  });

  it('does not mutate the served envelope', () => {
    const item = { name: 'crmext_visit', ...DECORATIONS };
    extractDraftBody(envelope(item));
    // The caller may still be holding the response (`getDraft` results are
    // asserted on directly in several tests); the strip must be a copy.
    expect(item).toHaveProperty('_diagnostics');
    expect(item).toHaveProperty('_draft');
  });

  it('a draft carrying ONLY decorations is still a pending draft', () => {
    // The verdict-before-strip property. `{}` is truthy, `null` is not, and
    // every caller reads the difference as "has pending changes".
    const body = extractDraftBody(envelope({ ...DECORATIONS }));
    expect(body).not.toBeNull();
    expect(body).toEqual({});
    expect(!!body).toBe(true);
  });

  it('answers null for the shapes that mean "nothing pending"', () => {
    expect(extractDraftBody(null)).toBeNull();
    expect(extractDraftBody(undefined)).toBeNull();
    expect(extractDraftBody('x')).toBeNull();
    expect(extractDraftBody({})).toBeNull(); // no `item` member at all
    expect(extractDraftBody(envelope(undefined))).toBeNull();
    expect(extractDraftBody(envelope(null))).toBeNull();
    expect(extractDraftBody(envelope({}))).toBeNull(); // served empty draft
    expect(extractDraftBody(envelope('not-an-object'))).toBeNull();
  });
});

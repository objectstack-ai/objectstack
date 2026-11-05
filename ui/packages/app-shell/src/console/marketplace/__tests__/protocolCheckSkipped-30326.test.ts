// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The install answer's `protocolCheckSkipped` (objectstack#30326), drawn from
 * its facts: one key per `reason`, the facts interpolated; an unknown `reason`
 * draws the server's own `message`; an answer without the field draws nothing.
 * `t` echoes the key and the facts, so the claim is WHICH sentence and WHAT
 * facts, not the wording.
 */

import { describe, expect, it } from 'vitest';
import { protocolCheckSkippedText } from '../protocolCheckSkipped';

const t = (key: string, o?: Record<string, unknown>) =>
  `«${key}|${['packageId', 'protocolVersion', 'requiredRange'].map((k) => `${k}=${String(o?.[k])}`).join('|')}»`;

const SERVER_MESSAGE = 'SERVER-ENGLISH sentinel: installed without a compatibility check.';

describe('protocolCheckSkippedText (objectstack#30326)', () => {
  it('no-range: the package and the protocol it was installed under', () => {
    expect(protocolCheckSkippedText({
      manifestId: 'com.acme.psa',
      protocolCheckSkipped: { reason: 'no-range', packageId: 'com.acme.psa', protocolVersion: '18.1.0', message: SERVER_MESSAGE },
    }, t)).toBe('«marketplace.install.protocolCheckSkipped.noRange|packageId=com.acme.psa|protocolVersion=18.1.0|requiredRange=»');
  });

  it('unparsed-range: the range it declared, too', () => {
    expect(protocolCheckSkippedText({
      protocolCheckSkipped: {
        reason: 'unparsed-range', packageId: 'com.acme.psa', protocolVersion: '18.1.0',
        requiredRange: 'latest', rangeSource: 'engines.protocol', message: SERVER_MESSAGE,
      },
    }, t)).toBe('«marketplace.install.protocolCheckSkipped.unparsedRange|packageId=com.acme.psa|protocolVersion=18.1.0|requiredRange=latest»');
  });

  it('a reason this reader does not know: the server\'s message as given', () => {
    expect(protocolCheckSkippedText({
      protocolCheckSkipped: { reason: 'some-later-reason', packageId: 'com.acme.psa', protocolVersion: '18.1.0', message: SERVER_MESSAGE },
    }, t)).toBe(SERVER_MESSAGE);
  });

  it('an unparsed-range without its range: the server\'s message, not a sentence with a hole', () => {
    expect(protocolCheckSkippedText({
      protocolCheckSkipped: { reason: 'unparsed-range', packageId: 'com.acme.psa', protocolVersion: '18.1.0', message: SERVER_MESSAGE },
    }, t)).toBe(SERVER_MESSAGE);
  });

  it('CONTROL: a checked install (no field), an empty answer and a notice with nothing readable draw nothing', () => {
    expect(protocolCheckSkippedText({ manifestId: 'com.acme.psa', hotLoaded: true }, t)).toBeNull();
    expect(protocolCheckSkippedText(null, t)).toBeNull();
    expect(protocolCheckSkippedText(undefined, t)).toBeNull();
    expect(protocolCheckSkippedText({ protocolCheckSkipped: { reason: 'later' } }, t)).toBeNull();
  });
});

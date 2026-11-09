// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The install answer's `data.protocolCheckSkipped` (objectstack#30326), in the
 * reader's locale: the package IS installed, but the ADR-0087 D1 handshake
 * admitted it without checking its platform protocol range, so it may not work
 * on this platform version.
 *
 * `POST /api/v1/marketplace/install-local` carries it on a success answer only
 * then (managed, unmanaged and paired installs alike), omitted when the range
 * was checked:
 *
 *   { reason: 'no-range', packageId, protocolVersion, message }
 *   { reason: 'unparsed-range', packageId, protocolVersion, requiredRange, rangeSource, message }
 *
 * `message` is the server's English sentence. The Console draws its own
 * sentence from the facts instead, one key per `reason`; a `reason` this
 * reader does not know draws the server's `message` as given, and an answer
 * without the field draws nothing.
 */

import { useCallback } from 'react';
import { useObjectTranslation } from '@object-ui/i18n';

/** The two verdicts the handshake admits a package unchecked under. */
export type ProtocolCheckSkippedReason = 'no-range' | 'unparsed-range';

/** `data.protocolCheckSkipped`, as the install door answers it. */
export type ProtocolCheckSkipped =
  | { reason: 'no-range'; packageId: string; protocolVersion: string; message: string }
  | {
      reason: 'unparsed-range';
      packageId: string;
      protocolVersion: string;
      requiredRange: string;
      rangeSource: string;
      message: string;
    };

const LINE_KEY: Record<ProtocolCheckSkippedReason, string> = {
  'no-range': 'marketplace.install.protocolCheckSkipped.noRange',
  'unparsed-range': 'marketplace.install.protocolCheckSkipped.unparsedRange',
};

const isText = (v: unknown): v is string => typeof v === 'string' && v !== '';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The notice's sentence for an install answer, or `null` when the answer
 * carries none (the range was checked, or an older runtime answered).
 */
export function protocolCheckSkippedText(answer: unknown, t: Translate): string | null {
  const notice = (answer as { protocolCheckSkipped?: unknown } | null | undefined)?.protocolCheckSkipped;
  if (!notice || typeof notice !== 'object') return null;
  const n = notice as Record<string, unknown>;
  const known = typeof n.reason === 'string' && n.reason in LINE_KEY
    && isText(n.packageId) && isText(n.protocolVersion)
    && (n.reason !== 'unparsed-range' || isText(n.requiredRange));
  if (known) {
    return t(LINE_KEY[n.reason as ProtocolCheckSkippedReason], {
      packageId: n.packageId,
      protocolVersion: n.protocolVersion,
      requiredRange: isText(n.requiredRange) ? n.requiredRange : '',
    });
  }
  return isText(n.message) ? n.message : null;
}

/** {@link protocolCheckSkippedText} in the current locale. */
export function useProtocolCheckSkippedText(): (answer: unknown) => string | null {
  const { t } = useObjectTranslation();
  return useCallback((answer: unknown) => protocolCheckSkippedText(answer, t as Translate), [t]);
}

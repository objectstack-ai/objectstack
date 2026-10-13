// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Automatic-mail suppression: which inbound messages are not mirrored at all.
 *
 * An auto-reply or a bounce is mail a machine wrote about mail, not a message a
 * correspondent sent, so it would put noise on every record its addresses
 * match. Such a message is SUPPRESSED: no `sys_mail_message` row is written,
 * and the ingest result names the reason. `sys_mail_message` declares no
 * suppressed state (`association_state` is `associated` / `unassociated`), so
 * a suppressed message is not a row in the pool either — "never dropped"
 * (decision 3) is about messages no record matched, not about these.
 *
 * The signals, each a declared header or media type, never a guess from the
 * subject line:
 *
 *  - `auto_submitted` — RFC 3834 §5: `Auto-Submitted` with any value but `no`
 *    (`auto-generated`, `auto-replied`, `auto-notified`);
 *  - `precedence` — `Precedence: bulk`, `junk` or `list`, the de-facto marker
 *    RFC 3834 §3.1.8 tells responders to honour;
 *  - `autoreply_header` — `X-Autoreply` or `X-Autorespond` with a value other
 *    than `no` / `false` / `0`, the vendor headers common responders set;
 *  - `delivery_report` — a top-level `multipart/report` with
 *    `report-type=delivery-status` (RFC 6522, RFC 3464): a bounce.
 */

import type { ParsedInboundMessage } from './parse-message.js';

/** Why a message was suppressed. */
export const MAIL_SUPPRESSION_REASONS = ['auto_submitted', 'precedence', 'autoreply_header', 'delivery_report'] as const;

/** One of {@link MAIL_SUPPRESSION_REASONS}. */
export type MailSuppressionReason = (typeof MAIL_SUPPRESSION_REASONS)[number];

const PRECEDENCE_SUPPRESSED: ReadonlySet<string> = new Set(['bulk', 'junk', 'list']);
const NEGATIVE_FLAG: ReadonlySet<string> = new Set(['', 'no', 'false', '0']);

/** The first token of a header value, lower-cased, parameters and comments dropped. */
function tokenOf(value: string | null): string | null {
  if (value === null) return null;
  return value.replace(/\([^)]*\)/g, ' ').split(';')[0]!.trim().toLowerCase();
}

/** The reason this message is suppressed, or `null` when it is mirrored. */
export function suppressionReasonOf(
  message: Pick<ParsedInboundMessage, 'header' | 'mediaType' | 'reportType'>,
): MailSuppressionReason | null {
  const autoSubmitted = tokenOf(message.header('auto-submitted'));
  if (autoSubmitted !== null && autoSubmitted !== '' && autoSubmitted !== 'no') return 'auto_submitted';

  const precedence = tokenOf(message.header('precedence'));
  if (precedence !== null && PRECEDENCE_SUPPRESSED.has(precedence)) return 'precedence';

  for (const name of ['x-autoreply', 'x-autorespond']) {
    const flag = tokenOf(message.header(name));
    if (flag !== null && !NEGATIVE_FLAG.has(flag)) return 'autoreply_header';
  }

  if (message.mediaType === 'multipart/report' && message.reportType === 'delivery-status') return 'delivery_report';
  return null;
}

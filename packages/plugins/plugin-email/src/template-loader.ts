// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `sys_email_template` {@link TemplateLoader} — locale resolution that
 * answers from the DECLARED contract instead of from driver row order (#7731).
 *
 * ## What was wrong
 *
 * The loader used to be four lines inline in `EmailServicePlugin`: build
 * `where = { name }`, add `where.locale` only when a locale was passed, then
 * `find(..., { limit: 1 })` with **no ordering**. "First row of an unordered
 * set" is whatever the driver happens to yield — so an i18n bundle with `en-US`
 * and `zh-CN` rows under one name rendered `zh-CN` for a caller that named no
 * locale at all, on two consecutive fresh boots. Nothing in the system declares
 * that; three separate places declare the opposite:
 *
 *  - `SendTemplateInput.locale` (spec contract): *"Falls back to `'en-US'`"*.
 *  - `EmailTemplateDefinitionSchema.locale`: *"the service picks the best match
 *    for the recipient's locale, falling back to `en-US`"*.
 *  - `sys_email_template`'s own object doc: *"Resolved by `(name, locale)`; the
 *    EmailService picks the best-matching locale for the recipient, falling
 *    back to `en-US`"*.
 *
 * ## The rule this implements
 *
 * Every branch below pins the row it wants in the `where` clause; none of them
 * asks the store to pick a locale for us:
 *
 *  1. **A locale was named** → exact `(name, locale)` match, or `null`. The
 *     en-US fallback stays where it is documented — in `sendTemplate`'s ladder
 *     — so a replacement loader cannot silently relocate it.
 *  2. **No locale** → `(name, 'en-US')`, the documented default. This is the
 *     #7731 fix: the *query* names en-US, so even a driver that honours no
 *     ordering at all cannot answer with a different locale.
 *  3. **No locale and no en-US row** → the bundle's lowest locale tag, ordered.
 *     A store holding only `zh-CN` rows worked before this change (there was
 *     exactly one row to pick arbitrarily from), and refusing it now would
 *     trade one bug for an outage. Ordered rather than arbitrary, so the answer
 *     is the same on every boot.
 *
 * Language-only prefix matching (`zh` → `zh-CN`) is deliberately NOT here: no
 * contract declares it, and inventing it would put a resolution rule in the
 * code that no spec, doc or form describes.
 *
 * Ordering is spelled `orderBy` — the canonical engine key. `sort` is the wire
 * spelling and `find()` rejects it outright, so a tie-break has to be spelled
 * this way to exist at all.
 */

import { DEFAULT_TEMPLATE_LOCALE, type EmailTemplateRow, type TemplateLoader } from './email-service.js';
import { EMAIL_TEMPLATE_OBJECT } from './bootstrap-declared-email-templates.js';

/** System read context — template resolution is not an end-user query. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/**
 * The slice of the ObjectQL engine this loader calls. Declared here rather than
 * imported as `IDataEngine` so the seam a test has to fake is one method.
 */
export interface TemplateLoaderEngine {
  find(object: string, query: Record<string, unknown>): Promise<unknown>;
}

/** Sort node shape as the engine spells it (`orderBy`, never the wire `sort`). */
interface TemplateSort { field: string; order: 'asc' | 'desc' }

/**
 * Tie-break for a query that already pins `(name, locale)`: duplicates of one
 * locale (an org overlay row landing beside the platform one) must still
 * resolve the same way on every boot.
 */
const BY_ID: readonly TemplateSort[] = [{ field: 'id', order: 'asc' }];

/** Deterministic order for the unpinned last resort — lowest locale tag wins. */
const BY_LOCALE: readonly TemplateSort[] = [
  { field: 'locale', order: 'asc' },
  { field: 'id', order: 'asc' },
];

/** Options for {@link createSysEmailTemplateLoader}. */
export interface CreateTemplateLoaderOptions {
  /** Backing object name; overridable for tests. */
  object?: string;
}

/**
 * Build the `sys_email_template` loader `EmailService` resolves templates
 * through. See the module doc for the resolution rule it implements.
 */
export function createSysEmailTemplateLoader(
  engine: TemplateLoaderEngine,
  options: CreateTemplateLoaderOptions = {},
): TemplateLoader {
  const object = options.object ?? EMAIL_TEMPLATE_OBJECT;

  const first = async (
    where: Record<string, unknown>,
    orderBy: readonly TemplateSort[],
  ): Promise<EmailTemplateRow | null> => {
    const rows = await engine.find(object, {
      where,
      orderBy: orderBy.map((s) => ({ ...s })),
      limit: 1,
      context: SYSTEM_CTX,
    });
    const row = Array.isArray(rows) ? rows[0] : (rows as any)?.data?.[0];
    return (row as EmailTemplateRow) || null;
  };

  return {
    async load(name, locale) {
      if (locale) return first({ name, locale }, BY_ID);
      const preferred = await first({ name, locale: DEFAULT_TEMPLATE_LOCALE }, BY_ID);
      if (preferred) return preferred;
      // No en-US row in this bundle — rule 3 in the module doc.
      return first({ name }, BY_LOCALE);
    },
  };
}

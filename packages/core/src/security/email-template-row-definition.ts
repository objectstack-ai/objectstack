// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D6/D10, ruling C on §6 Q1] A `sys_email_template` row, turned into
 * the `email_template` DEFINITION it carries.
 *
 * Templates resolve from the registry (`email_template` metadata); the rows are
 * no longer read on the send path. A row an organization customized before
 * that door closed is the one copy of the customer's edit, and ruling C
 * promotes it to an environment template before the row is deleted. The
 * upgrade ceremony (`os migrate`, C7b) reads the row, calls this function and
 * saves the answer through the metadata door. ⛔ Never at boot.
 *
 * The function is pure: one row in, one body out — no engine, no I/O, and no
 * import, so the lean entry carries it as it stands. The mapping is the
 * inverse of the row shape the retired projector wrote, which is also the
 * render input the email service reads (`EmailTemplateRow`):
 *
 *  - `name` → `name`; `label` → `label`, falling back to the name when the
 *    column is empty or absent;
 *  - `locale` → `locale`, falling back to `en-US` (the schema's default and
 *    the bundle floor) when empty or absent;
 *  - `subject` → `subject` and `body_html` → `bodyHtml`, each `''` when empty
 *    or absent (both are required strings);
 *  - `body_text` → `bodyText`, `reply_to` → `replyTo` and `description` →
 *    `description`, each only when a non-empty string;
 *  - `from_address` → `fromOverride.address`, with `from_name` →
 *    `fromOverride.name` when non-empty; no `fromOverride` without an address;
 *  - `variables_json` → `variables` when it is JSON text (or an already
 *    parsed value) holding an array, else `[]`;
 *  - `active` → `active`: `false` for a stored `false`, `0`, `'0'` or
 *    `'false'`, `true` for anything else, an absent column included (the
 *    schema's default).
 *
 * The retired keys (`category`, `is_system`) and every state or provenance
 * column (`managed_by`, `customized`, `organization_id`, the timestamps) are
 * not a definition and never travel into one.
 *
 * ⛔ It is not validation. A name outside the schema's dotted snake_case still
 * answers a body; the metadata door refuses it, and reporting that refusal is
 * the ceremony's.
 */

/**
 * One `sys_email_template` row, as the mapping reads it. Every other column a
 * row carries is accepted and ignored.
 */
export interface EmailTemplateRowForDefinition {
  readonly name?: unknown;
  readonly label?: unknown;
  readonly locale?: unknown;
  readonly description?: unknown;
  readonly subject?: unknown;
  readonly body_html?: unknown;
  readonly body_text?: unknown;
  readonly from_name?: unknown;
  readonly from_address?: unknown;
  readonly reply_to?: unknown;
  readonly active?: unknown;
  readonly variables_json?: unknown;
  readonly [column: string]: unknown;
}

const filled = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

const variablesOf = (value: unknown): unknown[] => {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed) ? parsed : [];
};

/**
 * The `email_template` definition one `sys_email_template` row carries (module
 * doc). Deterministic: the same row answers the same body, key for key and in
 * the same key order.
 */
export function emailTemplateDefinitionFromRow(row: EmailTemplateRowForDefinition): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: row.name,
    label: filled(row.label) ?? row.name,
    locale: filled(row.locale) ?? 'en-US',
    subject: filled(row.subject) ?? '',
    bodyHtml: filled(row.body_html) ?? '',
  };
  const bodyText = filled(row.body_text);
  if (bodyText !== undefined) body.bodyText = bodyText;
  body.variables = variablesOf(row.variables_json);
  const address = filled(row.from_address);
  if (address !== undefined) {
    const name = filled(row.from_name);
    body.fromOverride = name === undefined ? { address } : { name, address };
  }
  const replyTo = filled(row.reply_to);
  if (replyTo !== undefined) body.replyTo = replyTo;
  body.active = !(row.active === false || row.active === 0 || row.active === '0' || row.active === 'false');
  const description = filled(row.description);
  if (description !== undefined) body.description = description;
  return body;
}

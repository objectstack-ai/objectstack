// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Build-time lint for `autonumber` field formats. An `autonumberFormat` may
 * interpolate other fields of the same record (`{plan_no}{000}`,
 * `{section}{island_zone}{000}`). That field value forms the counter SCOPE, so
 * if it is missing at create time the record number silently collapses into the
 * wrong scope — and the runtime now throws rather than emit a wrong number
 * (see sql-driver / engine `missingFieldValues`). This lint catches the two
 * ways an author (very often an AI generating templates) gets that wrong,
 * BEFORE it ships:
 *
 *   - ERROR: `{field}` names a field that does not exist on the object — the
 *     generation will always throw. This is broken, so it fails the build.
 *   - WARNING: `{field}` names an OPTIONAL field — generation throws on any
 *     record left blank. The robust shape marks the referenced field
 *     `required: true` (mirroring ERPNext/Odoo, where a field that drives the
 *     naming series must be mandatory). Advisory; does not fail the build.
 *
 * A self-reference (`{self}` on the autonumber field itself) is always an
 * ERROR — the value does not exist yet when the format renders.
 */

import { parseAutonumberFormat, referencedFields } from '@objectstack/spec/data';

export interface AutonumberLintFinding {
  where: string;
  message: string;
  hint: string;
  rule: string;
  severity: 'error' | 'warning';
}

type AnyRec = Record<string, unknown>;

export const AUTONUMBER_UNKNOWN_FIELD = 'autonumber-references-unknown-field';
export const AUTONUMBER_OPTIONAL_FIELD = 'autonumber-references-optional-field';
export const AUTONUMBER_SELF_REFERENCE = 'autonumber-references-self';
export const AUTONUMBER_LITERAL_TOKEN = 'autonumber-unrecognized-token';

function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

/**
 * Lint every `autonumber` field's format for unresolvable / fragile `{field}`
 * interpolation. Returns a (possibly empty) list of findings; never throws.
 */
export function lintAutonumberFormats(stack: AnyRec): AutonumberLintFinding[] {
  const findings: AutonumberLintFinding[] = [];
  for (const obj of asArray(stack.objects)) {
    const objectName = typeof obj.name === 'string' ? obj.name : '(unnamed object)';
    const fields = asArray(obj.fields);
    // name → required?, for schema-aware reference checks.
    const fieldMeta = new Map<string, { required: boolean }>();
    for (const f of fields) {
      if (typeof f.name === 'string') fieldMeta.set(f.name, { required: f.required === true });
    }

    for (const f of fields) {
      if (f.type !== 'autonumber') continue;
      const name = typeof f.name === 'string' ? f.name : '(unnamed field)';
      const fmt = typeof f.autonumberFormat === 'string'
        ? f.autonumberFormat
        : (typeof f.format === 'string' ? f.format : '');
      if (!fmt) continue;
      const tokens = parseAutonumberFormat(fmt);
      const refs = referencedFields(tokens);
      const where = `object '${objectName}' · field '${name}' (autonumber "${fmt}")`;

      // An unrecognized `{...}` group is kept as literal text by the parser, so
      // it ships VERBATIM in the record number. This catches case/spacing/typo
      // mistakes the field-reference checks miss — date tokens are exact
      // (`{YYYY}`, not `{yyyy}` or `{ YYYY }`), and only one `{0..0}` slot counts.
      for (const t of tokens) {
        if (t.kind !== 'literal') continue;
        const braced = t.text.match(/\{[^{}]*\}/g);
        if (!braced) continue;
        for (const tok of braced) {
          const body = tok.slice(1, -1);
          const isExtraSeq = /^0+$/.test(body);
          findings.push({
            where,
            message: isExtraSeq
              ? `format has a second sequence slot \`${tok}\` — only the first \`{0..0}\` counts; this one renders literally as "${tok}".`
              : `format has an unrecognized token \`${tok}\` — it is not a counter/date/{field} token, so it renders literally as "${tok}" in every record number.`,
            hint: isExtraSeq
              ? `Use a single \`{0000}\` slot; fold any second number into a literal or a {field} token.`
              : `Date tokens are case-sensitive and exact: {YYYY} {YY} {MM} {DD} {YYYYMMDD} (no spaces/punctuation inside). For a field value use {field_name}.`,
            rule: AUTONUMBER_LITERAL_TOKEN,
            severity: 'warning',
          });
        }
      }
      for (const ref of refs) {
        if (ref === name) {
          findings.push({
            where,
            message: `format interpolates \`{${ref}}\` — its own value, which does not exist yet when the number is generated.`,
            hint: `Reference a DIFFERENT field that is set before create (e.g. \`{plan_no}{000}\`), or drop the token.`,
            rule: AUTONUMBER_SELF_REFERENCE,
            severity: 'error',
          });
          continue;
        }
        const meta = fieldMeta.get(ref);
        if (!meta) {
          findings.push({
            where,
            message: `format interpolates \`{${ref}}\`, but object '${objectName}' has no field named '${ref}' — generation will always throw.`,
            hint: `Reference an existing field, or remove the \`{${ref}}\` token from the format.`,
            rule: AUTONUMBER_UNKNOWN_FIELD,
            severity: 'error',
          });
        } else if (!meta.required) {
          findings.push({
            where,
            message: `format interpolates \`{${ref}}\`, but '${ref}' is optional — any record left blank fails autonumber generation at create time.`,
            hint: `Mark '${ref}' as \`required: true\` so it is always set before the record number is rendered.`,
            rule: AUTONUMBER_OPTIONAL_FIELD,
            severity: 'warning',
          });
        }
      }
    }
  }
  return findings;
}

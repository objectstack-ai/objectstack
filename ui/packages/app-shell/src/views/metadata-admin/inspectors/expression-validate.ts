// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Author-time expression validation for the metadata inspectors (ADR-0032).
 *
 * The GUI is a first-class author surface, so the same rule the build and the
 * `validate_expression` agent tool enforce must surface *here, as you type* —
 * not only on save/build. The #1 mistake (human or AI) is wrapping a field
 * reference in single `{…}` braces inside a CEL condition: `{x}` parses as a
 * CEL map literal and silently fails (issue #1491). We catch that and a couple
 * of other obvious shape errors, with the **same corrective message** the
 * server-side validator emits.
 *
 * The messages read the designer catalogue (`engine.flowExpr.*`) in the
 * `locale` the caller passes (objectui#10748); the en rows are the server's
 * words, and an absent locale reads them. The code spans inside a message are
 * code and read the same in every locale.
 *
 * NOTE: this is an intentionally small client-side check (no CEL parser in the
 * browser). Once `@objectstack/formula` is published, swap the body of
 * {@link validateExpressionClient} for a call to its shared `validateExpression`
 * so the GUI, SDK, and CLI share one validator verbatim.
 */

import { tFormat } from '../i18n.js';

export type ExprFieldRole = 'predicate' | 'value' | 'template';

export interface ExprClientIssue {
  /** Self-correcting message: what is wrong + the correct form. */
  message: string;
}

/** A bare `{x}` that is NOT part of a `{{x}}` mustache hole. */
const SINGLE_BRACE_RE = /(?:^|[^{])\{\s*([A-Za-z_$][\w.$]*)\s*\}(?!\})/;

function balanced(src: string, open: string, close: string): boolean {
  let depth = 0;
  for (const ch of src) {
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth < 0) return false; }
  }
  return depth === 0;
}

/**
 * Validate one expression for a field role. Returns `null` when clean, or an
 * issue with a corrective message. Empty/absent input is always clean.
 */
export function validateExpressionClient(role: ExprFieldRole, raw: unknown, locale?: string): ExprClientIssue | null {
  // Accept a bare string or an Expression envelope ({ dialect, source }).
  let source = '';
  let dialect: string | undefined;
  if (typeof raw === 'string') source = raw;
  else if (raw && typeof raw === 'object') {
    const env = raw as { dialect?: string; source?: string };
    dialect = env.dialect;
    source = env.source ?? '';
  }
  if (!source.trim()) return null;

  if (role === 'template') {
    if (dialect && dialect !== 'template') {
      return { message: tFormat('engine.flowExpr.templateDialect', locale, { dialect }) };
    }
    if (!balanced(source.replace(/\{\{/g, '').replace(/\}\}/g, ''), '{', '}')) {
      // crude: only flag obviously single-brace mustache misuse below
    }
    const m = SINGLE_BRACE_RE.exec(source);
    if (m) {
      return { message: tFormat('engine.flowExpr.singleBraceTemplate', locale, { ref: m[1] }) };
    }
    return null;
  }

  // predicate | value → CEL
  if (dialect && dialect !== 'cel') {
    return { message: tFormat('engine.flowExpr.celDialect', locale, { dialect }) };
  }
  const m = SINGLE_BRACE_RE.exec(source);
  if (m) {
    return { message: tFormat('engine.flowExpr.braceInCondition', locale, { ref: m[1] }) };
  }
  if (!balanced(source, '(', ')')) {
    return { message: tFormat('engine.flowExpr.unbalancedParens', locale, { source }) };
  }
  if (!balanced(source, '[', ']')) {
    return { message: tFormat('engine.flowExpr.unbalancedBrackets', locale, { source }) };
  }
  return null;
}

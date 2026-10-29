// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The mail template hole grammar — ONE copy, read by every reader of a mail
 * template's holes:
 *
 * - `@objectstack/plugin-email`'s renderer (`template-engine.ts`), which
 *   substitutes the holes of every face (`subject`, `bodyText`, `bodyHtml`);
 * - this package's placement judge (`mail-html-hole-placement.ts`), which
 *   classifies where each hole of `bodyHtml` sits;
 * - `@objectstack/lint`'s `email-template-hole-grammar` authoring rule, which
 *   refuses a hole the grammar refuses at `os validate`, `os build`, `os lint`
 *   and the metadata publish door.
 *
 * A hole is `{{path}}`, `{{{path}}}` or either with one formatter from the
 * shared whitelist, `{{ path | formatter[:arg] }}`. The path is a dotted path
 * of word characters. Text between braces whose part before any `|` is not
 * a path (`{{ not a path }}`, `{{}}`, `{{ | upper }}`) is not a hole: the
 * renderer leaves it as written. A path followed by `|` is a formatter use,
 * and is judged.
 *
 * What follows the first `|` is split by `splitHoleFormatter` and judged by
 * `judgeHoleFormatter` (`template-engine.ts`), the two functions the in-app
 * template dialect reads its holes with too, so the two dialects accept the
 * same formatter parts (`currency :EUR` is `currency` with `EUR` in both) and
 * refuse the rest with the same sentence: a formatter name of one word
 * (`{{ due | date-long }}` is refused, never printed as written), one
 * formatter per hole, a formatter the whitelist names (`TEMPLATE_FORMATTERS`),
 * and a `currency` argument that is a literal ISO 4217 code. A refused hole is a hole — it is found, located and
 * named — and the renderer refuses to render it rather than print a wrong
 * value or formatter syntax.
 *
 * One argument form is the mail dialect's own: `currency:@path` reads the
 * ISO 4217 code from the send's data (`CURRENCY_ARGUMENT_RULE`), so one
 * template formats each record's amount in that record's currency. The path
 * after the `@` is the same dotted path a hole names. Here it is parsed
 * ({@link ParsedMailHole}.`codePath`), checked against the template's declared
 * `variables` when it declares any ({@link judgeMailHoleGrammar}), and the
 * renderer resolves it and refuses a value that is not a code
 * (`currencyCodeValueRefusal`) — it never formats the amount in a default
 * currency in its place.
 */

import {
  CURRENCY_ARGUMENT_RULE,
  currencyCodePath,
  judgeHoleFormatter,
  splitHoleFormatter,
  type TemplateHoleGrammarRefusal,
} from './template-engine';

/** 1=open (`{{` or `{{{`), 2=brace-free inner body, 3=close (`}}` or `}}}`). */
const MAIL_HOLE_SOURCE = String.raw`(\{\{\{?)([^{}]*)(\}\}\}?)`;

/**
 * A fresh global matcher for mail template holes. Capturing the inner body
 * with `[^{}]*` (one star over a negated class, no nested quantifier) keeps
 * the match linear — no polynomial-ReDoS shape; the body is then parsed with
 * plain string operations ({@link parseMailHole}). A new instance per caller,
 * so no two scans share a `lastIndex`.
 */
export function mailHolePattern(): RegExp {
  return new RegExp(MAIL_HOLE_SOURCE, 'g');
}

// Validated against small, already-extracted strings (bounded input → no ReDoS).
const PATH_RE = /^[\w.]+$/;

/** A mail hole's inner body, parsed. */
export interface ParsedMailHole {
  path: string;
  formatter?: string;
  /** The formatter's argument, quotes removed; absent when none was written. */
  arg?: string;
  /**
   * Set for `currency:@path`: the path into the send's data the currency code is
   * read from (`currency_code`). The renderer resolves it; `arg` keeps the text
   * as written (`@currency_code`).
   */
  codePath?: string;
  /** Set when the grammar refuses the hole: it is not rendered, and authoring refuses it. */
  refusal?: TemplateHoleGrammarRefusal;
}

/**
 * Parse a hole's inner body (the text between the braces). `null` when the
 * part before any `|` is not a path — text the renderer leaves verbatim, and
 * that no reader treats as a hole. A path followed by `|` always parses: a
 * formatter part the grammar refuses is carried as the hole's `refusal`.
 */
export function parseMailHole(inner: string, hole = `{{${inner}}}`): ParsedMailHole | null {
  const pipe = inner.indexOf('|');
  if (pipe === -1) {
    const path = inner.trim();
    return PATH_RE.test(path) ? { path } : null;
  }
  const path = inner.slice(0, pipe).trim();
  if (!PATH_RE.test(path)) return null;
  const formatterPart = inner.slice(pipe + 1).trim();
  const { name, arg } = splitHoleFormatter(formatterPart);
  const refusal = judgeHoleFormatter(hole, formatterPart, name, arg, 'mail');
  if (refusal?.rule === 'one-formatter') {
    // `{{ x | upper | lower }}`: the renderer used to leave it on the page as
    // written. Its formatter is the name before the second `|`.
    return { path, formatter: formatterPart.split(/[:|]/, 1)[0].trim(), refusal };
  }
  const formatter = name;
  const codePath = refusal ? undefined : currencyCodePath(formatterPart);
  return {
    path,
    formatter,
    ...(arg !== undefined ? { arg } : {}),
    ...(codePath !== undefined ? { codePath } : {}),
    ...(refusal ? { refusal } : {}),
  };
}

/**
 * True when a `currency:@path` path is one the template declares: a declared
 * variable names the path itself, or a root it lies under (`contract`
 * declares `contract.currency_code`).
 */
function isDeclaredPath(path: string, variables: readonly string[]): boolean {
  return variables.some((name) => name === path || path.startsWith(`${name}.`));
}

/** What {@link judgeMailHoleGrammar} judges a face against, beyond its own text. */
export interface MailHoleGrammarOptions {
  /**
   * The names of the template's declared `variables`. When the template
   * declares any, a `currency:@path` hole whose path none of them declares is
   * refused (`currency-code-path-undeclared`). Absent or empty, the path is
   * judged at render, where a code that does not resolve is refused.
   */
  variables?: readonly string[];
}

/** One hole of a mail template face that the grammar refuses. */
export interface MailHoleGrammarFinding {
  /** Offset of the hole's first brace in the face. */
  start: number;
  /** The hole as written, braces included. */
  text: string;
  refusal: TemplateHoleGrammarRefusal;
}

/** Every hole in one mail template face (`subject`, `bodyText` or `bodyHtml`) the grammar refuses, in order. */
export function judgeMailHoleGrammar(face: string, options: MailHoleGrammarOptions = {}): MailHoleGrammarFinding[] {
  if (typeof face !== 'string' || face === '') return [];
  const variables = options.variables ?? [];
  const findings: MailHoleGrammarFinding[] = [];
  for (const m of face.matchAll(mailHolePattern())) {
    const parsed = parseMailHole(m[2], m[0]);
    if (parsed?.refusal) {
      findings.push({ start: m.index ?? 0, text: m[0], refusal: parsed.refusal });
    } else if (parsed?.codePath !== undefined && variables.length > 0 && !isDeclaredPath(parsed.codePath, variables)) {
      findings.push({
        start: m.index ?? 0,
        text: m[0],
        refusal: {
          rule: 'currency-code-path-undeclared',
          message:
            `the hole ${m[0]} reads its currency code from \`${parsed.codePath}\`, which this template's `
            + `\`variables\` do not declare (it declares ${variables.map((v) => `\`${v}\``).join(', ')}). `
            + `${CURRENCY_ARGUMENT_RULE} Declare \`${parsed.codePath}\` beside them, or read the code from a path `
            + 'they declare.',
        },
      });
    }
  }
  return findings;
}

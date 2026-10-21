// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every outlet in this package that renders a text field into HTML escapes it
 * by context — ruling 3C on #25040.
 *
 * ## The rule
 *
 * A text field is stored as the person typed it: a display name may contain
 * any character, so nothing is stripped or refused at the write. The burden
 * sits on the OUTLET — the code that places a value into markup — and an
 * outlet escapes by default, for the context the value lands in.
 *
 * ## The list, and the pin on the list itself
 *
 * {@link OUTLETS} names every file of this package that renders a value into
 * HTML, each with pins that drive the real render path. A per-entry pin cannot
 * see an outlet nobody listed, so the LIST is pinned too: the census walks this
 * package's source and finds every file that touches HTML at all — an
 * identifier or a string naming `html`, or a string carrying an HTML tag — and
 * requires each one to be on {@link OUTLETS} or on {@link NOT_OUTLETS} with the
 * reason it renders nothing. A new file that touches HTML fails here until its
 * author says which it is.
 *
 * ## When the census fires
 *
 * ⛔ Not by adding the file to {@link NOT_OUTLETS} because it is in the way. If
 * the file places a value into markup it is an outlet: escape the value for its
 * context, add the entry to {@link OUTLETS} and give it a pin that renders a
 * text field carrying markup characters through the real path. Only a file that
 * moves already-rendered HTML, or names HTML as vocabulary, is a non-outlet,
 * and its entry says which.
 *
 * ⚠️ LIMIT, stated so it is not read as more: the census reads source text of
 * THIS package. It proves no unlisted file here touches HTML; it does not see
 * another package (each package holding an outlet carries its own list), and it
 * does not prove a listed outlet escapes — that is what the per-entry pins are
 * for.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, it, expect } from 'vitest';
import type { ApprovalRequestRow } from '@objectstack/spec/contracts';

import { renderConfirmPage, renderResultPage } from './action-link-pages.js';

/** …/packages/plugins/plugin-approvals/src — this package's whole source tree. */
const SRC = dirname(fileURLToPath(import.meta.url));

/** A file that renders a value into HTML, and the pin that holds it to the rule. */
interface OutletEntry {
  /** What it renders. */
  readonly renders: string;
  /** Registers the pins that drive its real render path — an outlet cannot be listed without one. */
  readonly pin: () => void;
}

/** A file that touches HTML without rendering a value into it. */
interface NotOutletEntry {
  readonly why: string;
}

const OUTLETS: Readonly<Record<string, OutletEntry>> = {
  'action-link-pages.ts': {
    renders: 'the session-less confirm and result pages an approval link opens',
    pin: pinActionLinkPages,
  },
};

const NOT_OUTLETS: Readonly<Record<string, NotOutletEntry>> = {
  'approval-service.ts': {
    why: 'wraps a page action-link-pages.ts rendered in a text/html Response; renders no value itself',
  },
  'approvals-plugin.ts': {
    why: 'serves a page action-link-pages.ts rendered with a text/html content type; renders no value itself',
  },
};

// ── The census ──────────────────────────────────────────────────────────────

const HTML_WORD = /html/i;
/** An HTML element opening or closing tag inside a string. */
const HTML_TAG =
  /<(?:!doctype|\/?(?:html|head|body|title|meta|style|script|link|p|a|b|i|u|em|strong|small|span|div|br|hr|img|table|thead|tbody|tfoot|tr|td|th|ul|ol|li|h[1-6]|form|input|button|textarea|select|option|label|pre|code|blockquote|section|article|header|footer|nav|main|center|font|iframe|svg|mj-[a-z-]+))(?=[\s>/])/i;

/** Does this source touch HTML in CODE — comments never count. */
function touchesHtml(fileName: string, text: string): boolean {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  let hit = false;
  const visit = (node: ts.Node): void => {
    if (hit) return;
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      if (HTML_WORD.test(node.text)) hit = true;
    } else if (
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
    ) {
      if (HTML_WORD.test(node.text) || HTML_TAG.test(node.text)) hit = true;
    }
    if (!hit) ts.forEachChild(node, visit);
  };
  visit(source);
  return hit;
}

/**
 * Every shipped source file, package-relative. Tests and test kits ship
 * nothing; the generated translation bundles are projections of the object
 * declarations (`check:i18n` owns them) and render nothing.
 */
function shippedSources(dir = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...shippedSources(full));
      continue;
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.d.ts')) continue;
    if (entry.endsWith('.test.ts') || entry.endsWith('.testkit.ts')) continue;
    const rel = relative(SRC, full).split(sep).join('/');
    if (rel.startsWith('translations/') && entry.endsWith('.generated.ts')) continue;
    out.push(rel);
  }
  return out.sort();
}

describe('the outlet list — every file here that touches HTML is classified', () => {
  it('the census reads code, not comments (control)', () => {
    expect(touchesHtml('a.ts', '// renders html\nexport const x = 1;')).toBe(false);
    expect(touchesHtml('a.ts', 'export const x = `<p>${1}</p>`;')).toBe(true);
    expect(touchesHtml('a.ts', 'export const html = 1;')).toBe(true);
    expect(touchesHtml('a.ts', "export const t = 'text/html';")).toBe(true);
  });

  it('the files that touch HTML are exactly the listed outlets and non-outlets', () => {
    const touching = shippedSources().filter((rel) => touchesHtml(rel, readFileSync(join(SRC, rel), 'utf8')));
    const listed = [...Object.keys(OUTLETS), ...Object.keys(NOT_OUTLETS)].sort();
    expect(touching).toEqual(listed);
  });

  it('no file is both an outlet and a non-outlet', () => {
    expect(Object.keys(OUTLETS).filter((f) => f in NOT_OUTLETS)).toEqual([]);
  });
});

// ── The per-entry pins ──────────────────────────────────────────────────────

/** A text field as a person may type it: markup characters, kept as typed. */
const PERSON = 'Ada <b>Lovelace</b> & "Co" it\'s';
const PERSON_IN_HTML = 'Ada &lt;b&gt;Lovelace&lt;/b&gt; &amp; &quot;Co&quot; it&#39;s';
/** The fixture's markup as it would appear had a value passed through unescaped. */
const PERSON_MARKUP = '<b>Lovelace</b>';

const REQUEST: ApprovalRequestRow = {
  id: 'apr_1',
  process_name: 'expense_approval',
  process_label: PERSON,
  object_name: 'expense',
  object_label: PERSON,
  record_id: 'exp_1',
  status: 'pending',
  current_step: 'manager',
  step_label: PERSON,
  submitter_id: 'usr_1',
  submitter_name: PERSON,
};

function pinActionLinkPages(): void {
  it('the confirm page escapes every request text field, the acting address and the form attributes', () => {
    const page = renderConfirmPage({
      request: REQUEST,
      action: 'approve',
      approverId: PERSON,
      token: PERSON,
      actPath: '/api/v1/approvals/act',
    });

    // Four request fields, the acting address, and the hidden token's value attribute.
    expect(page.split(PERSON_IN_HTML).length - 1).toBe(6);
    expect(page).toContain(`value="${PERSON_IN_HTML}"`);
    expect(page).not.toContain(PERSON_MARKUP);
  });

  it('the result page escapes every request text field', () => {
    const page = renderResultPage('approved', REQUEST);

    expect(page.split(PERSON_IN_HTML).length - 1).toBe(4);
    expect(page).not.toContain(PERSON_MARKUP);
  });
}

// Registered last, so every fixture above is initialised before a pin reads it.
for (const [file, entry] of Object.entries(OUTLETS)) {
  describe(`${file} — ${entry.renders}`, entry.pin);
}

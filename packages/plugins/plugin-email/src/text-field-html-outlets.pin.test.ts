// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every outlet in this package that renders a text field into HTML escapes it
 * by context, and the mail template engine does so by DEFAULT — ruling 3C on
 * #25040.
 *
 * ## The rule
 *
 * A text field is stored as the person typed it: a display name may contain
 * any character, so nothing is stripped or refused at the write. The burden
 * sits on the OUTLET — the code that places a value into markup. Here that is
 * the template engine, and its default is the escaping form: a `{{x}}` hole in
 * `body_html` is HTML-escaped (element text and quoted attribute alike), and
 * the same hole in the subject or `body_text` renders as typed, because an
 * entity in plain text is a corrupted character.
 *
 * The one unescaped form is the triple-braced hole, an author's explicit opt
 * out. The built-in templates use it for exactly one thing — a link the
 * platform minted, placed inside an `href` attribute.
 *
 * ## Where a hole may sit — the shared judge (#25189)
 *
 * The escaping is right only where the placement needs exactly that encoding:
 * element text, and a quoted plain-text attribute value. Every other
 * placement, and an unescaped hole anywhere but a declared url variable
 * forming a whole double-quoted `href`, is refused at authoring time by
 * `@objectstack/lint`'s `validateEmailTemplateHolePlacements` (ruling
 * `6335348115` on #25082). Which placement is which is `@objectstack/formula`'s
 * `judgeMailHtmlHoles`, and the pin on `templates/auth-templates.ts` below
 * holds the built-ins to that SAME judge, so a built-in can never sit where an
 * author's template would be refused.
 *
 * That judge spells this package's hole grammar again, because the two share
 * no module that could hold it, so the grammar is pinned here too, against the
 * real renderer: on a grammar corpus and on every built-in body, the spans the
 * judge finds are exactly the spans the renderer replaces, and the escaped and
 * unescaped forms are the ones it encodes and does not.
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
 * the file places a value into markup it is an outlet: render it through the
 * engine's HTML face (or escape it for its context), add the entry to
 * {@link OUTLETS} and give it a pin that renders a text field carrying markup
 * characters through the real path. Only a file that moves already-rendered
 * HTML, or names HTML as vocabulary, is a non-outlet, and its entry says which.
 *
 * ⚠️ LIMIT, stated so it is not read as more: the census reads source text of
 * THIS package. It proves no unlisted file here touches HTML; it does not see
 * another package (each package holding an outlet carries its own list), and it
 * does not prove a listed outlet escapes — that is what the per-entry pins are
 * for.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import ts from 'typescript';
import { describe, it, expect } from 'vitest';
import type {
  IEmailTransport,
  NormalizedEmailMessage,
  TransportSendResult,
} from '@objectstack/spec/contracts';
import type { EmailTemplateDefinition } from '@objectstack/spec/system';

import { judgeMailHtmlHoles, type MailHtmlHole } from '@objectstack/formula';

import { renderTemplate, renderPlainTextTemplate } from './template-engine.js';
import { EmailService, type EmailTemplateRow, type TemplateLoader } from './email-service.js';
import { BUILTIN_AUTH_TEMPLATES } from './templates/auth-templates.js';

/**
 * …/packages/plugins/plugin-email/src — this package's whole source tree.
 *
 * Seeded from `__dirname`, not from the module URL: this package is CJS-typed
 * and its tsconfig reaches its tests, so the module-URL meta-property is a
 * type error here however well it runs under vitest.
 */
const SRC = __dirname;

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
  'template-engine.ts': {
    renders: 'renderTemplate, the HTML face, and renderPlainTextTemplate, the plain-text faces',
    pin: pinTemplateEngine,
  },
  'email-service.ts': {
    renders: 'resolveAndRenderTemplate: a template row\'s body_html, subject and body_text, behind sendTemplate and renderTemplate',
    pin: pinEmailService,
  },
  'templates/auth-templates.ts': {
    renders: 'the built-in auth templates every deployment sends',
    pin: pinBuiltInTemplates,
  },
};

const NOT_OUTLETS: Readonly<Record<string, NotOutletEntry>> = {
  'index.ts': { why: 're-exports the engine\'s functions; renders nothing' },
  'template-loader.ts': { why: 'maps a declared template\'s bodyHtml onto the body_html column the service renders; renders nothing' },
  'transports/postmark.ts': { why: 'hands the already-rendered html part to the provider unchanged' },
  'transports/resend.ts': { why: 'hands the already-rendered html part to the provider unchanged' },
  'transports/smtp.ts': { why: 'hands the already-rendered html part to the provider unchanged' },
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

/** Every shipped source file, package-relative. Tests and test kits ship nothing. */
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
    out.push(relative(SRC, full).split(sep).join('/'));
  }
  return out.sort();
}

describe('the outlet list — every file here that touches HTML is classified', () => {
  it('the census reads code, not comments (control)', () => {
    expect(touchesHtml('a.ts', '// renders html\nexport const x = 1;')).toBe(false);
    expect(touchesHtml('a.ts', 'export const x = `<p>${1}</p>`;')).toBe(true);
    expect(touchesHtml('a.ts', 'export const bodyHtml = 1;')).toBe(true);
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
/** The fixture's markup as it would appear had a hole passed it through unescaped. */
const PERSON_MARKUP = '<b>Lovelace</b>';
/** That markup as an escaping hole renders it. */
const PERSON_MARKUP_IN_HTML = '&lt;b&gt;Lovelace&lt;/b&gt;';
/** A platform-minted link with a query string. */
const LINK = 'https://acme.test/act?token=T1&next=%2Fhome';

class CaptureTransport implements IEmailTransport {
  public sent: NormalizedEmailMessage[] = [];
  async send(message: NormalizedEmailMessage): Promise<TransportSendResult> {
    this.sent.push(message);
    return { messageId: `msg-${this.sent.length}` };
  }
}

/** A built-in definition as the service reads it — what `EmailServicePlugin` registers. */
function rowOf(t: EmailTemplateDefinition): EmailTemplateRow {
  return {
    name: t.name,
    locale: t.locale ?? 'en-US',
    subject: t.subject,
    body_html: t.bodyHtml ?? '',
    body_text: t.bodyText ?? null,
    active: t.active !== false,
    variables_json: JSON.stringify(t.variables ?? []),
  };
}

function service(rows: EmailTemplateRow[]) {
  const transport = new CaptureTransport();
  const templateLoader: TemplateLoader = {
    async load(name, locale) {
      return rows.find((r) => r.name === name && (locale === undefined || r.locale === locale)) ?? null;
    },
  };
  const svc = new EmailService({ transport, defaultFrom: { address: 'no-reply@acme.test' }, templateLoader });
  return { svc, transport };
}

function pinTemplateEngine(): void {
  it('the HTML face escapes a double-braced hole by default, in element text and in a quoted attribute', () => {
    expect(renderTemplate('<p title="{{ who }}"><b>{{who}}</b></p>', { who: PERSON }))
      .toBe(`<p title="${PERSON_IN_HTML}"><b>${PERSON_IN_HTML}</b></p>`);
  });

  it('a formatted hole is escaped too', () => {
    expect(renderTemplate('<b>{{ who | upper }}</b>', { who: 'a<b>' })).toBe('<b>A&lt;B&gt;</b>');
  });

  it('the triple-braced hole is the one unescaped form', () => {
    expect(renderTemplate('<a href="{{{url}}}">go</a>', { url: LINK })).toBe(`<a href="${LINK}">go</a>`);
  });

  it('the plain-text faces render every hole as typed', () => {
    expect(renderPlainTextTemplate('{{who}} / {{{who}}}', { who: PERSON })).toBe(`${PERSON} / ${PERSON}`);
  });

  it('the shared placement judge reads this renderer\'s hole grammar: the same spans, the same two forms', () => {
    const bodies = [...GRAMMAR_CORPUS, ...BUILTIN_AUTH_TEMPLATES.map((t) => t.bodyHtml ?? '')];
    let judged = 0;
    for (const body of bodies) {
      const holes = judgeMailHtmlHoles(body);
      judged += holes.length;
      // Spans: with no data every hole renders empty, so what the renderer
      // leaves is the body minus exactly the spans the judge found.
      expect(renderTemplate(body, {}), body).toBe(splice(body, holes, () => ''));
      // Forms: where no hole carries a formatter, a marked value comes out
      // escaped from every hole the judge calls escaped, and as typed from
      // every hole it calls unescaped.
      if (holes.some((h) => h.text.includes('|'))) continue;
      expect(renderTemplate(body, everyPath(PERSON_MARKUP)), body)
        .toBe(splice(body, holes, (h) => (h.raw ? PERSON_MARKUP : PERSON_MARKUP_IN_HTML)));
    }
    expect(judged, 'the corpus carries holes to compare').toBeGreaterThan(200);
  });
}

/**
 * The grammar's edges, beside the built-ins' ordinary holes: spacing, dotted
 * paths, formatters with and without an argument, mismatched and stacked
 * braces, and brace pairs the renderer leaves verbatim. No `default`
 * formatter, which renders text for a missing value.
 */
const GRAMMAR_CORPUS = [
  '<p>{{a}} {{ a.b }} {{a_b.c1}}{{  spaced  }}</p>',
  '<p>{{ x | upper }} {{ total | currency:EUR }} {{ t | currency: \'USD\' }} {{ d | date }}</p>',
  '<p>{{{a}}} {{{a}} {{a}}} {{{{a}}}} {{{ a }}}</p>',
  '<p>{{ not a path }} {{}} {{ | upper }} {{ x | two words }} {{a{b}} {x}</p>',
  '<p title="{{a}}">{{ <b }}{{b}}</p><a href="{{{u}}}">{{u}}</a>',
];

/** `body` with each hole's span replaced by `by(hole)`. */
function splice(body: string, holes: readonly MailHtmlHole[], by: (h: MailHtmlHole) => string): string {
  let out = '';
  let at = 0;
  for (const h of holes) {
    out += body.slice(at, h.start) + by(h);
    at = h.end;
  }
  return out + body.slice(at);
}

/** Data under which every dotted path resolves to `value`. */
function everyPath(value: string): Record<string, unknown> {
  const leaf: object = new Proxy({}, {
    get: (_target, key) => (key === Symbol.toPrimitive ? () => value : typeof key === 'string' ? leaf : undefined),
  });
  return leaf as Record<string, unknown>;
}

function pinEmailService(): void {
  const AUTHORED: EmailTemplateRow = {
    name: 'crm.mention',
    locale: 'en-US',
    subject: '{{actor.name}} mentioned you',
    body_html: '<p><b>{{actor.name}}</b> wrote on {{record.title}}</p>',
    body_text: '{{actor.name}} wrote on {{record.title}}',
    active: true,
  };
  const DATA = { actor: { name: PERSON }, record: { title: PERSON } };

  it('sendTemplate: the transport receives the text field escaped in the html part, as typed in the subject and text part', async () => {
    const { svc, transport } = service([AUTHORED]);

    await svc.sendTemplate({ template: 'crm.mention', to: 'ada@acme.test', data: DATA });

    expect(transport.sent).toHaveLength(1);
    const sent = transport.sent[0];
    expect(sent.html).toBe(`<p><b>${PERSON_IN_HTML}</b> wrote on ${PERSON_IN_HTML}</p>`);
    expect(sent.subject).toBe(`${PERSON} mentioned you`);
    expect(sent.text).toBe(`${PERSON} wrote on ${PERSON}`);
  });

  it('renderTemplate (render only): the same three faces', async () => {
    const { svc, transport } = service([AUTHORED]);

    const out = await svc.renderTemplate({ template: 'crm.mention', data: DATA });

    expect(out.html).toBe(`<p><b>${PERSON_IN_HTML}</b> wrote on ${PERSON_IN_HTML}</p>`);
    expect(out.subject).toBe(`${PERSON} mentioned you`);
    expect(out.text).toBe(`${PERSON} wrote on ${PERSON}`);
    expect(transport.sent).toHaveLength(0);
  });

  it('a stored row the authoring rule would refuse still renders and sends: it is judged at its next publish, never at send', async () => {
    const STORED: EmailTemplateRow = { ...AUTHORED, name: 'crm.stored', body_html: '<p><a href="{{record.title}}">{{actor.name}}</a></p>' };
    expect(judgeMailHtmlHoles(STORED.body_html).filter((h) => !h.supported).map((h) => h.placement)).toEqual(['url-attribute']);
    const { svc, transport } = service([STORED]);

    await svc.sendTemplate({ template: 'crm.stored', to: 'ada@acme.test', data: DATA });

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0].html).toContain(PERSON_IN_HTML);
  });
}

/** `{ 'user.name': v }` → `{ user: { name: v } }`. */
function dataFor(variables: NonNullable<EmailTemplateDefinition['variables']>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const v of variables) {
    const value = v.type === 'url' ? LINK : v.type === 'number' ? 15 : PERSON;
    const parts = v.name.split('.');
    let cur = data;
    for (const p of parts.slice(0, -1)) {
      cur[p] = (cur[p] as Record<string, unknown> | undefined) ?? {};
      cur = cur[p] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = value;
  }
  return data;
}

/** The variables a built-in declares with `type: 'url'` — the paths its unescaped href holes may read. */
const urlVariablesOf = (t: EmailTemplateDefinition) =>
  (t.variables ?? []).filter((v) => v.type === 'url').map((v) => v.name);

function pinBuiltInTemplates(): void {
  it('there are built-in templates to judge (control)', () => {
    expect(BUILTIN_AUTH_TEMPLATES.length).toBeGreaterThan(0);
  });

  it('the built-ins carry unescaped holes, and each is admitted by its url declaration and by nothing else (control)', () => {
    const judged = (urlVariables: (t: EmailTemplateDefinition) => string[]) =>
      BUILTIN_AUTH_TEMPLATES.flatMap((t) => judgeMailHtmlHoles(t.bodyHtml ?? '', { urlVariables: urlVariables(t) }))
        .filter((h) => h.raw);
    expect(judged(urlVariablesOf).length).toBeGreaterThan(0);
    expect(judged(urlVariablesOf).every((h) => h.supported && h.placement === 'url-attribute')).toBe(true);
    expect(judged(() => []).filter((h) => h.supported)).toEqual([]);
  });

  for (const t of BUILTIN_AUTH_TEMPLATES) {
    const label = `${t.name} [${t.locale ?? 'en-US'}]`;

    it(`${label}: every hole in the html body sits where an author's would be admitted (the shared judge)`, () => {
      const refused = judgeMailHtmlHoles(t.bodyHtml ?? '', { urlVariables: urlVariablesOf(t) })
        .filter((h) => !h.supported)
        .map((h) => `${h.text} in ${h.placement}`);
      expect(refused).toEqual([]);
    });

    it(`${label}: every text variable renders escaped into the html part`, async () => {
      const { svc, transport } = service([rowOf(t)]);

      await svc.sendTemplate({
        template: t.name,
        to: 'ada@acme.test',
        locale: t.locale ?? 'en-US',
        data: dataFor(t.variables ?? []),
      });

      const html = String(transport.sent[0]?.html);
      expect(html).toContain(PERSON_IN_HTML);
      expect(html).not.toContain(PERSON_MARKUP);
    });
  }
}

// Registered last, so every fixture above is initialised before a pin reads it.
for (const [file, entry] of Object.entries(OUTLETS)) {
  describe(`${file} — ${entry.renders}`, entry.pin);
}

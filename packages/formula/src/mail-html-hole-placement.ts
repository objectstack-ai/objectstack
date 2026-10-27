// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where a hole may sit in the HTML face of a mail template — the one judge
 * `@objectstack/lint`'s authoring rule and `@objectstack/plugin-email`'s
 * built-in template pin both read (ruling `6335348115` on #25082, letters
 * F1 A2 and F3 C2).
 *
 * ## What the renderer does, and what that decides
 *
 * `plugin-email`'s `renderTemplate` encodes a double-braced hole ONE way: the
 * five characters an HTML parser reads as markup in text and in a quoted
 * attribute value (`&`, `<`, `>`, `"`, `'`) become character references. A
 * triple-braced hole is not encoded at all. The template's author decides
 * where each hole sits, so the encoding is only right where the placement
 * needs exactly that encoding and nothing more:
 *
 * - **element text** — the text content of an element, and of the two
 *   elements whose text the parser reads with references decoded and no
 *   markup inside (`title`, `textarea`);
 * - **a quoted attribute value** whose content is plain text: double- or
 *   single-quoted, on an attribute that is not read as a URL, a script, a
 *   style sheet or markup.
 *
 * Every other placement needs an encoding the renderer does not apply, so a
 * hole there is refused — context-strict, by the placement the hole occupies
 * in the parsed template, never by a search for a syntax pattern.
 *
 * The one unencoded form keeps the shape the built-in auth templates already
 * use, for every author: a triple-braced hole is accepted only as a variable
 * the template declares with `type: 'url'`, forming the WHOLE value of a
 * double-quoted `href`. Anywhere else a triple-braced hole is refused.
 *
 * ## Where it runs, and where it does not
 *
 * The verdict is the author-time door's: `os validate`, `os build`, `os lint`
 * and the runtime publish gate refuse a refused hole. Nothing here runs at
 * send — a stored template keeps rendering until its next publish judges it
 * (ruling item 4) — and nothing here encodes a value.
 *
 * ## Grammar parity with the renderer
 *
 * The hole grammar is not spelled here: {@link mailHolePattern} and
 * {@link parseMailHole} (`mail-hole-grammar.ts`) are the renderer's own,
 * imported by `plugin-email`'s renderer from this package, so the spans this
 * judge finds are the spans the renderer substitutes by construction.
 * `plugin-email`'s `text-field-html-outlets.pin.test.ts` still renders a
 * grammar corpus and every built-in body through the real renderer and holds
 * the two to the same spans.
 *
 * ## Limits, stated so they are not read as more
 *
 * - The judge classifies the TEMPLATE, with each hole standing for a value the
 *   renderer encoded. It says nothing about a value's content and does not
 *   replace the renderer's encoding.
 * - Foreign content (`svg`, `math`) is refused whole rather than classified:
 *   the parser leaves it on rules of its own, and over-refusing there is the
 *   direction that cannot let a misjudged hole through.
 * - A hole whose placement depends on a value outside the template — an
 *   attribute another hole names, an element another hole opens — is refused
 *   with the placement the template gives it.
 */

import { mailHolePattern, parseMailHole } from './mail-hole-grammar';

// ─── Placement classes ──────────────────────────────────────────────

/**
 * Every placement a hole can occupy in an HTML body, as a closed set. Two are
 * supported for an encoded hole ({@link MAIL_HTML_SUPPORTED_PLACEMENTS}); a
 * triple-braced hole is supported only in the `href` shape described above,
 * which is a `url-attribute` placement.
 */
export type MailHtmlHolePlacement =
  | 'element-text'
  | 'quoted-attribute'
  | 'url-attribute'
  | 'event-handler-attribute'
  | 'style-attribute'
  | 'markup-attribute'
  | 'unquoted-attribute'
  | 'tag'
  | 'raw-text-element'
  | 'comment'
  | 'foreign-content';

/** The placements whose encoding the renderer applies to a double-braced hole. */
export const MAIL_HTML_SUPPORTED_PLACEMENTS: readonly MailHtmlHolePlacement[] = [
  'element-text',
  'quoted-attribute',
];

/** How each placement is named to an author — one noun phrase, the finding's vocabulary. */
export const MAIL_HTML_PLACEMENT_LABELS: Readonly<Record<MailHtmlHolePlacement, string>> = {
  'element-text': 'element text',
  'quoted-attribute': 'a quoted plain-text attribute value',
  'url-attribute': 'the value of an attribute read as a URL',
  'event-handler-attribute': 'the value of an event-handler attribute',
  'style-attribute': 'the value of a style attribute',
  'markup-attribute': 'the value of an attribute read as markup',
  'unquoted-attribute': 'an unquoted attribute value',
  tag: 'a tag, outside any attribute value',
  'raw-text-element': 'the content of an element whose text is not parsed as HTML text (script, style and their kind)',
  comment: 'a comment or markup declaration',
  'foreign-content': 'SVG or MathML content',
};

/** The supported set, as the sentence a refusal names it with. */
export const MAIL_HTML_SUPPORTED_SHAPES =
  'a double-braced hole in element text or in a quoted plain-text attribute value, and a triple-braced '
  + "hole only as a variable declared with type 'url' forming the whole value of a double-quoted href";

/** One hole the renderer substitutes, with the placement the template gives it. */
export interface MailHtmlHole {
  /** Offset of the hole's first brace in the body. */
  start: number;
  /** Offset one past the hole's last brace. */
  end: number;
  /** The hole as written, braces included. */
  text: string;
  /** The dotted path the hole reads. */
  path: string;
  /** True for the triple-braced form, which the renderer does not encode. */
  raw: boolean;
  placement: MailHtmlHolePlacement;
  /** Whether the renderer's handling of this hole is right for its placement. */
  supported: boolean;
}

export interface MailHtmlHoleJudgeOptions {
  /** The template's variables declared with `type: 'url'` — the paths a triple-braced `href` hole may read. */
  urlVariables?: Iterable<string>;
}

/**
 * Every hole the renderer substitutes in `html`, in body order, each with its
 * placement and verdict. Text the renderer leaves verbatim (a brace pair whose
 * body is not a path) is not a hole and is read as the template's own markup.
 */
export function judgeMailHtmlHoles(html: string, options: MailHtmlHoleJudgeOptions = {}): MailHtmlHole[] {
  if (typeof html !== 'string' || html === '') return [];
  const urlVariables = new Set(options.urlVariables ?? []);
  const found: Array<Omit<MailHtmlHole, 'placement' | 'supported'> & { formatter?: string }> = [];
  for (const m of html.matchAll(mailHolePattern())) {
    const parsed = parseMailHole(m[2], m[0]);
    if (!parsed) continue;
    const start = m.index ?? 0;
    found.push({
      start,
      end: start + m[0].length,
      text: m[0],
      path: parsed.path,
      raw: m[1] === '{{{' && m[3] === '}}}',
      ...(parsed.formatter !== undefined ? { formatter: parsed.formatter } : {}),
    });
  }
  if (found.length === 0) return [];

  const contexts = classifyHolePositions(html, found);
  return found.map((hole, i) => {
    const context = contexts[i];
    const supported = hole.raw
      ? context.wholeDoubleQuotedHref && hole.formatter === undefined && urlVariables.has(hole.path)
      : MAIL_HTML_SUPPORTED_PLACEMENTS.includes(context.placement);
    return {
      start: hole.start,
      end: hole.end,
      text: hole.text,
      path: hole.path,
      raw: hole.raw,
      placement: context.placement,
      supported,
    };
  });
}

// ─── The placement scan ─────────────────────────────────────────────

/** Elements whose content the parser reads as raw text: no references decoded, no markup, never HTML text. */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext']);
/** Elements whose content is text with references decoded and no markup inside. */
const ESCAPABLE_TEXT_ELEMENTS = new Set(['title', 'textarea']);
/** Roots of foreign content. */
const FOREIGN_ROOTS = new Set(['svg', 'math']);
/**
 * Attributes read as a URL (or a list of URLs), current and legacy, on any
 * element. A namespaced attribute (`xlink:href`, `xml:base`, `xmlns:…`) is
 * read as one too.
 */
const URL_ATTRIBUTES = new Set([
  'href', 'src', 'srcset', 'imagesrcset', 'action', 'formaction', 'cite', 'data', 'poster',
  'background', 'longdesc', 'usemap', 'codebase', 'classid', 'archive', 'code', 'profile',
  'manifest', 'icon', 'ping', 'lowsrc', 'dynsrc', 'datasrc', 'itemtype', 'itemid', 'xmlns',
]);
/** Element-specific attributes read as a URL: a meta refresh directive, a plugin parameter. */
const ELEMENT_URL_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  meta: new Set(['content']),
  param: new Set(['value']),
};
/** Attributes whose value is parsed as a document. */
const MARKUP_ATTRIBUTES = new Set(['srcdoc']);

function attributePlacement(element: string, attribute: string): MailHtmlHolePlacement {
  if (attribute.startsWith('on')) return 'event-handler-attribute';
  if (attribute === 'style') return 'style-attribute';
  if (MARKUP_ATTRIBUTES.has(attribute)) return 'markup-attribute';
  if (URL_ATTRIBUTES.has(attribute) || attribute.includes(':')) return 'url-attribute';
  if (ELEMENT_URL_ATTRIBUTES[element]?.has(attribute)) return 'url-attribute';
  return 'quoted-attribute';
}

type State =
  | 'data'
  | 'tag-open'
  | 'end-tag-open'
  | 'tag-name'
  | 'before-attr-name'
  | 'attr-name'
  | 'after-attr-name'
  | 'before-attr-value'
  | 'attr-value-dq'
  | 'attr-value-sq'
  | 'attr-value-uq'
  | 'after-attr-value'
  | 'self-closing'
  | 'markup-declaration'
  | 'comment'
  | 'bogus-comment'
  | 'raw-text'
  | 'escapable-text'
  | 'plaintext';

interface HoleContext {
  placement: MailHtmlHolePlacement;
  /** The hole is the whole value of a double-quoted `href`. */
  wholeDoubleQuotedHref: boolean;
}

const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
const isAlpha = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');

/**
 * Walk the body as an HTML tokenizer would, with every hole standing for
 * one inert character (what an encoded value is in the two supported
 * placements), and record the placement at each hole's offset.
 */
function classifyHolePositions(html: string, holes: ReadonlyArray<{ start: number; end: number }>): HoleContext[] {
  const contexts: HoleContext[] = [];
  let state: State = 'data';
  let tagName = '';
  let endTag = false;
  let attrName = '';
  let attrValueStart = -1;
  let declaration = '';
  let textElement = '';
  /** Inside a script's text, past a comment opener and not yet past a closer. */
  let scriptEscaped = false;
  let foreignDepth = 0;

  const emitTag = (selfClosing: boolean) => {
    if (endTag) {
      if (FOREIGN_ROOTS.has(tagName) && foreignDepth > 0) foreignDepth -= 1;
      return 'data' as State;
    }
    if (FOREIGN_ROOTS.has(tagName)) {
      if (!selfClosing) foreignDepth += 1;
      return 'data' as State;
    }
    if (foreignDepth > 0) return 'data' as State;
    textElement = tagName;
    scriptEscaped = false;
    if (tagName === 'plaintext') return 'plaintext' as State;
    if (RAW_TEXT_ELEMENTS.has(tagName)) return 'raw-text' as State;
    if (ESCAPABLE_TEXT_ELEMENTS.has(tagName)) return 'escapable-text' as State;
    return 'data' as State;
  };

  /** True when `html` at `i` closes the current raw or escapable text element. */
  const closesTextElement = (i: number) => {
    if (html[i] !== '<' || html[i + 1] !== '/') return false;
    const name = html.slice(i + 2, i + 2 + textElement.length);
    if (name.toLowerCase() !== textElement) return false;
    const after = html[i + 2 + textElement.length];
    return after === undefined || isSpace(after) || after === '/' || after === '>';
  };

  const contextAt = (start: number, end: number): HoleContext => {
    const plain = (placement: MailHtmlHolePlacement): HoleContext => ({ placement, wholeDoubleQuotedHref: false });
    const inForeign = foreignDepth > 0 || (FOREIGN_ROOTS.has(tagName) && !endTag && isTagState(state));
    if (inForeign) return plain('foreign-content');
    switch (state) {
      case 'data':
      case 'escapable-text':
        return plain('element-text');
      case 'raw-text':
      case 'plaintext':
        return plain('raw-text-element');
      case 'markup-declaration':
      case 'comment':
      case 'bogus-comment':
        return plain('comment');
      case 'attr-value-dq':
      case 'attr-value-sq': {
        if (endTag) return plain('tag');
        const placement = attributePlacement(tagName, attrName);
        const whole = state === 'attr-value-dq' && attrName === 'href'
          && attrValueStart === start && html[end] === '"';
        return { placement, wholeDoubleQuotedHref: whole };
      }
      case 'before-attr-value':
      case 'attr-value-uq':
        return plain(endTag ? 'tag' : 'unquoted-attribute');
      default:
        return plain('tag');
    }
  };

  let h = 0;
  let i = 0;
  while (i < html.length) {
    // Every jump below moves over literal characters only, so no hole start is
    // ever stepped over; were one to be, it is refused rather than misaligned.
    while (h < holes.length && holes[h].start < i) {
      contexts.push({ placement: 'tag', wholeDoubleQuotedHref: false });
      h += 1;
    }
    if (h < holes.length && i === holes[h].start) {
      contexts.push(contextAt(holes[h].start, holes[h].end));
      i = holes[h].end;
      h += 1;
      // The hole stands for one inert character from here on.
      state = step(state, 'x');
      continue;
    }
    const c = html[i];
    // A script's text has escape states of its own, in which an end tag may
    // not end the element. They are not modelled: from a comment opener on,
    // the scan stays in raw text until an end tag that follows a comment
    // closer, which can only refuse more than the parser would.
    if (state === 'raw-text' && textElement === 'script') {
      if (html.startsWith('<!--', i)) scriptEscaped = true;
      else if (html.startsWith('-->', i)) scriptEscaped = false;
    }
    // States that read more than one character at a time.
    if ((state === 'raw-text' || state === 'escapable-text') && !scriptEscaped && closesTextElement(i)) {
      state = 'end-tag-open';
      tagName = '';
      endTag = true;
      i += 2;
      continue;
    }
    if (state === 'comment') {
      if (html.startsWith('-->', i)) { state = 'data'; i += 3; continue; }
      if (html.startsWith('--!>', i)) { state = 'data'; i += 4; continue; }
      i += 1;
      continue;
    }
    if (state === 'markup-declaration') {
      declaration += c;
      i += 1;
      if (declaration === '--') {
        // `<!-->` and `<!--->` close at once.
        if (html[i] === '>') { state = 'data'; i += 1; }
        else if (html.startsWith('->', i)) { state = 'data'; i += 2; }
        else state = 'comment';
      } else if (declaration !== '-') {
        state = c === '>' ? 'data' : 'bogus-comment';
      }
      continue;
    }
    state = step(state, c);
    i += 1;
  }
  while (contexts.length < holes.length) contexts.push({ placement: 'tag', wholeDoubleQuotedHref: false });
  return contexts;

  /** One character of tokenizer state for the states that read a character at a time. */
  function step(s: State, c: string): State {
    switch (s) {
      case 'data':
        if (c === '<') return 'tag-open';
        return 'data';
      case 'tag-open':
        if (c === '!') { declaration = ''; return 'markup-declaration'; }
        if (c === '/') return 'end-tag-open';
        if (c === '?') return 'bogus-comment';
        if (isAlpha(c)) { tagName = c.toLowerCase(); endTag = false; return 'tag-name'; }
        // A character that opens no tag is reconsumed in the data state, where
        // only another `<` means anything.
        return step('data', c);
      case 'end-tag-open':
        if (isAlpha(c)) { tagName = c.toLowerCase(); endTag = true; return 'tag-name'; }
        if (c === '>') return 'data';
        return 'bogus-comment';
      case 'tag-name':
        if (isSpace(c)) return 'before-attr-name';
        if (c === '/') return 'self-closing';
        if (c === '>') return emitTag(false);
        tagName += c.toLowerCase();
        return 'tag-name';
      case 'before-attr-name':
        if (isSpace(c)) return 'before-attr-name';
        if (c === '/') return 'self-closing';
        if (c === '>') return emitTag(false);
        attrName = c.toLowerCase();
        return 'attr-name';
      case 'attr-name':
        if (isSpace(c)) return 'after-attr-name';
        if (c === '/') return 'self-closing';
        if (c === '=') return 'before-attr-value';
        if (c === '>') return emitTag(false);
        attrName += c.toLowerCase();
        return 'attr-name';
      case 'after-attr-name':
        if (isSpace(c)) return 'after-attr-name';
        if (c === '/') return 'self-closing';
        if (c === '=') return 'before-attr-value';
        if (c === '>') return emitTag(false);
        attrName = c.toLowerCase();
        return 'attr-name';
      case 'before-attr-value':
        if (isSpace(c)) return 'before-attr-value';
        if (c === '"') { attrValueStart = i + 1; return 'attr-value-dq'; }
        if (c === "'") { attrValueStart = i + 1; return 'attr-value-sq'; }
        if (c === '>') return emitTag(false);
        return 'attr-value-uq';
      case 'attr-value-dq':
        return c === '"' ? 'after-attr-value' : 'attr-value-dq';
      case 'attr-value-sq':
        return c === "'" ? 'after-attr-value' : 'attr-value-sq';
      case 'attr-value-uq':
        if (isSpace(c)) return 'before-attr-name';
        if (c === '>') return emitTag(false);
        return 'attr-value-uq';
      case 'after-attr-value':
        if (isSpace(c)) return 'before-attr-name';
        if (c === '/') return 'self-closing';
        if (c === '>') return emitTag(false);
        attrName = c.toLowerCase();
        return 'attr-name';
      case 'self-closing':
        if (c === '>') return emitTag(true);
        return step('before-attr-name', c);
      case 'bogus-comment':
        return c === '>' ? 'data' : 'bogus-comment';
      default:
        // raw-text, escapable-text and plaintext hold until a closing tag (read above).
        return s;
    }
  }
}

function isTagState(s: State): boolean {
  return s !== 'data' && s !== 'raw-text' && s !== 'escapable-text' && s !== 'plaintext'
    && s !== 'comment' && s !== 'bogus-comment' && s !== 'markup-declaration';
}

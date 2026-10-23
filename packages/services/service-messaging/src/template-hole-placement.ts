// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where a hole may sit in the HTML face of a notification template — the judge
 * the `sys_notification_template` save hooks read
 * (`notification-template-placement.ts`; ruling `6335348115` on #25082, items 2
 * and 3).
 *
 * ## Derived from the encoder, not from a list of bad patterns
 *
 * `renderNotification` encodes a hole on the `html` / `mjml` face ONE way
 * (`escapeHtml` in `template-renderer.ts`): the five characters an HTML parser
 * reads as markup in element text and in a quoted attribute value — `&`, `<`,
 * `>`, `"`, `'` — become character references, and nothing else changes. That
 * is exactly the encoding two placements need, so those two are supported:
 *
 * - **element text** — the text content of an element, including the two
 *   elements whose text is read with references decoded and no markup inside
 *   (`title`, `textarea`);
 * - **a quoted attribute value** whose content the client reads as plain text:
 *   double- or single-quoted, on an attribute that is not read as a URL, a
 *   script, a style sheet, markup or a setting of the document.
 *
 * Every other placement needs an encoding the renderer does not apply, so a
 * hole there is refused — context-strict, by the placement the hole occupies
 * in the parsed template. There is no unencoded hole form on this face (the
 * renderer has none), so there is no exception to the two.
 *
 * ## Every reading a parser can give the template
 *
 * A tokenizer scan reads most of a template exactly as a mail client's parser
 * does. Two things it cannot read from the template alone, because the
 * parser's tree builder decides them from the elements around them:
 *
 * - **whether an element's text is raw.** `script`, `style` and their kind
 *   switch the parser to raw text (`title` and `textarea` to escapable text) —
 *   but `noscript` only with scripting enabled, which a mail client has off,
 *   and none of them inside a `select` or after a `frameset`, where the tree
 *   builder ignores the start tag. So at a `noscript` start tag, and at every
 *   such start tag once a `select` or `frameset` has been opened, the scan
 *   FORKS: one reading enters the element's text, the other reads on as
 *   markup. A hole is supported only when it is supported under EVERY reading,
 *   so markup that straddles such an element's end tag cannot move a hole out
 *   of one reading's view.
 * - **where foreign content ends.** After an `svg` or `math` start tag the
 *   parser leaves HTML rules (it recognises CDATA sections and switches no
 *   element to raw text), and where it returns depends on breakout tags,
 *   integration points and unmatched end tags. The scan does not model that:
 *   from the root's start tag on, every hole is refused as foreign content.
 *
 * Both rules only ever refuse more than the parser would; neither can accept a
 * hole the parser places elsewhere.
 *
 * ## The same vocabulary as the email half
 *
 * The email half of this ruling (`plugin-email`'s renderer, judged by
 * `@objectstack/lint`'s authoring rule) names placements with the same class
 * names and author-facing labels, so an administrator meets one vocabulary on
 * both template kinds. This half keeps its own judge (ruling item 2): the
 * renderers' hole grammars differ, and this one reads `template-renderer.ts`'s
 * grammar through {@link templateHoles}.
 *
 * ## Limits, stated so they are not read as more
 *
 * - The judge classifies the TEMPLATE, with each hole standing for a value the
 *   renderer encoded. It says nothing about a value's content and does not
 *   replace the renderer's encoding.
 * - It runs when a row is saved. A row stored before the rule keeps rendering
 *   until an edit judges it (ruling item 4).
 */

import { templateHoles } from './template-renderer.js';

// ─── Placement classes ──────────────────────────────────────────────

/** Every placement a hole can occupy in an HTML body, as a closed set. */
export type TemplateHolePlacement =
    | 'element-text'
    | 'quoted-attribute'
    | 'url-attribute'
    | 'event-handler-attribute'
    | 'style-attribute'
    | 'markup-attribute'
    | 'meta-attribute'
    | 'unquoted-attribute'
    | 'tag'
    | 'raw-text-element'
    | 'comment'
    | 'foreign-content';

/** The placements whose encoding the renderer applies to a hole. */
export const SUPPORTED_HOLE_PLACEMENTS: readonly TemplateHolePlacement[] = ['element-text', 'quoted-attribute'];

/** How each placement is named to an author — one noun phrase, the refusal's vocabulary. */
export const HOLE_PLACEMENT_LABELS: Readonly<Record<TemplateHolePlacement, string>> = {
    'element-text': 'element text',
    'quoted-attribute': 'a quoted plain-text attribute value',
    'url-attribute': 'the value of an attribute read as a URL',
    'event-handler-attribute': 'the value of an event-handler attribute',
    'style-attribute': 'the value of a style attribute',
    'markup-attribute': 'the value of an attribute read as markup',
    'meta-attribute': 'the value of a meta element attribute, read as a setting of the document',
    'unquoted-attribute': 'an unquoted attribute value',
    tag: 'a tag, outside any attribute value',
    'raw-text-element': 'the content of an element whose text is not parsed as HTML text (script, style and their kind)',
    comment: 'a comment or markup declaration',
    'foreign-content': 'SVG or MathML content',
};

/** One hole the renderer substitutes, with the placement the template gives it. */
export interface TemplateHtmlHole {
    /** Offset of the hole's first brace in the body. */
    start: number;
    /** Offset one past the hole's last brace. */
    end: number;
    /** The hole as written, braces included. */
    text: string;
    /** The dotted path the hole reads. */
    path: string;
    /**
     * The placement the template gives the hole. When the readings disagree,
     * the first refused reading's placement: the one the author has to move.
     */
    placement: TemplateHolePlacement;
    /** Whether the renderer's encoding is right for the hole under every reading. */
    supported: boolean;
}

/**
 * Every hole the renderer substitutes in `html`, in body order, each with its
 * placement and verdict. Text the renderer leaves verbatim (a brace pair that
 * is not a hole) is the template's own markup and is read as such.
 */
export function judgeTemplateHtmlHoles(html: string): TemplateHtmlHole[] {
    if (typeof html !== 'string' || html === '') return [];
    const holes = templateHoles(html);
    if (holes.length === 0) return [];
    const verdicts = classifyHoles(html, holes);
    return holes.map((hole, i) => ({ ...hole, ...verdicts[i] }));
}

// ─── The placement tables ───────────────────────────────────────────

/** Elements whose text the parser reads raw: no references decoded, no markup, never HTML text. */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript']);
/** Elements whose text is read with references decoded and no markup inside. */
const ESCAPABLE_TEXT_ELEMENTS = new Set(['title', 'textarea']);
/** Roots of foreign content. */
const FOREIGN_ROOTS = new Set(['svg', 'math']);
/**
 * Attributes read as a URL (or a list of URLs), current and legacy, on any
 * element. A namespaced attribute (`xlink:href`, `xml:base`, `xmlns:…`) is read
 * as one too.
 */
const URL_ATTRIBUTES = new Set([
    'href', 'src', 'srcset', 'imagesrcset', 'action', 'formaction', 'cite', 'data', 'poster',
    'background', 'longdesc', 'usemap', 'codebase', 'classid', 'archive', 'code', 'profile',
    'manifest', 'icon', 'ping', 'lowsrc', 'dynsrc', 'datasrc', 'itemtype', 'itemid', 'xmlns',
]);
/** Element-specific attributes read as a URL: a plugin parameter. */
const ELEMENT_URL_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
    param: new Set(['value']),
};
/** Attributes whose value is parsed as a document. */
const MARKUP_ATTRIBUTES = new Set(['srcdoc']);

function attributePlacement(element: string, attribute: string): TemplateHolePlacement {
    // A meta element's every attribute configures the document — its content
    // can be a refresh directive's URL, its charset the decoding of the whole
    // body — so none of them is plain text.
    if (element === 'meta') return 'meta-attribute';
    if (attribute.startsWith('on')) return 'event-handler-attribute';
    if (attribute === 'style') return 'style-attribute';
    if (MARKUP_ATTRIBUTES.has(attribute)) return 'markup-attribute';
    if (URL_ATTRIBUTES.has(attribute) || attribute.includes(':')) return 'url-attribute';
    if (ELEMENT_URL_ATTRIBUTES[element]?.has(attribute)) return 'url-attribute';
    return 'quoted-attribute';
}

// ─── The scan ───────────────────────────────────────────────────────

/**
 * The tokenizer states the scan distinguishes — the HTML tokenizer's own,
 * merged where the difference never moves a hole.
 */
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
    | 'declaration-open'
    | 'declaration-dash'
    | 'comment-start'
    | 'comment-start-dash'
    | 'comment'
    | 'comment-end-dash'
    | 'comment-end'
    | 'comment-end-bang'
    | 'bogus-comment'
    | 'text'
    | 'text-lt'
    | 'text-end-open'
    | 'text-end-name'
    | 'plaintext';

/** One way a parser can read the template, as tokenizer state. */
interface Reading {
    state: State;
    /** The tag being read (lower-cased), and whether it is an end tag. */
    tagName: string;
    endTag: boolean;
    /** The attribute whose name or value is being read (lower-cased). */
    attrName: string;
    /** In `text*` states: the element whose end tag closes the text, and whether it is escapable (RCDATA). */
    textElement: string;
    escapable: boolean;
    /** In `text-end-name`: the end tag name read so far. */
    buffer: string;
    /** In a script's text: past a comment opener and not yet past a closer. */
    scriptEscaped: boolean;
    /** The last three characters of a script's text, for the opener and closer. */
    recent: string;
    /** Past an `svg` / `math` start tag: never left (module note). */
    foreign: boolean;
    /** Past a `select` / `frameset` start tag: a text element's start tag may be ignored from here on. */
    textStartsMayBeIgnored: boolean;
}

/**
 * Readings above this many are not tracked; every later hole is refused. A
 * fork's text reading rejoins the markup reading at the element's end tag, so
 * real markup holds a handful at most.
 */
const MAX_READINGS = 64;

const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
const isAlpha = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');

/** The data state, carrying only what outlives a token. */
function dataReading(from?: Reading): Reading {
    return {
        state: 'data', tagName: '', endTag: false, attrName: '', textElement: '', escapable: false,
        buffer: '', scriptEscaped: false, recent: '',
        foreign: from?.foreign ?? false,
        textStartsMayBeIgnored: from?.textStartsMayBeIgnored ?? false,
    };
}

function readingKey(r: Reading): string {
    return [
        r.state, r.tagName, r.endTag, r.attrName, r.textElement, r.escapable, r.buffer,
        r.scriptEscaped, r.recent, r.foreign, r.textStartsMayBeIgnored,
    ].join('\u0000');
}

/**
 * Walk the body under every reading, with each hole standing for one inert
 * character — what an encoded value is in the two supported placements — and
 * record each hole's verdict.
 */
function classifyHoles(
    html: string,
    holes: ReadonlyArray<{ start: number; end: number }>,
): Array<{ placement: TemplateHolePlacement; supported: boolean }> {
    const verdicts: Array<{ placement: TemplateHolePlacement; supported: boolean }> = [];
    let readings: Reading[] = [dataReading()];
    let untracked = false;

    let h = 0;
    let i = 0;
    while (i < html.length) {
        if (h < holes.length && i === holes[h].start) {
            if (untracked) {
                verdicts.push({ placement: 'tag', supported: false });
            } else {
                const placements = readings.map(placementOf);
                const refused = placements.find((p) => !SUPPORTED_HOLE_PLACEMENTS.includes(p));
                verdicts.push(refused ? { placement: refused, supported: false } : { placement: placements[0], supported: true });
            }
            readings = advance(readings, 'x');
            i = holes[h].end;
            h += 1;
            continue;
        }
        readings = advance(readings, html[i]);
        i += 1;
    }
    return verdicts;

    function advance(current: Reading[], c: string): Reading[] {
        if (untracked) return current;
        const next: Reading[] = [];
        const seen = new Set<string>();
        for (const reading of current) {
            for (const stepped of step(reading, c)) {
                const key = readingKey(stepped);
                if (seen.has(key)) continue;
                seen.add(key);
                next.push(stepped);
            }
        }
        if (next.length > MAX_READINGS) {
            untracked = true;
            return [];
        }
        return next;
    }
}

/** The placement a hole has under one reading. */
function placementOf(r: Reading): TemplateHolePlacement {
    if (r.foreign) return 'foreign-content';
    switch (r.state) {
        case 'data':
            return 'element-text';
        case 'text':
            return r.escapable ? 'element-text' : 'raw-text-element';
        case 'text-lt':
        case 'text-end-open':
        case 'text-end-name':
        case 'plaintext':
            // A hole that could complete the closing tag, or a text the parser
            // never leaves: refused with the element's own class.
            return r.escapable ? 'tag' : 'raw-text-element';
        case 'declaration-open':
        case 'declaration-dash':
        case 'comment-start':
        case 'comment-start-dash':
        case 'comment':
        case 'comment-end-dash':
        case 'comment-end':
        case 'comment-end-bang':
        case 'bogus-comment':
            return 'comment';
        case 'attr-value-dq':
        case 'attr-value-sq':
            if (r.endTag) return 'tag';
            if (FOREIGN_ROOTS.has(r.tagName)) return 'foreign-content';
            return attributePlacement(r.tagName, r.attrName);
        case 'before-attr-value':
        case 'attr-value-uq':
            if (r.endTag) return 'tag';
            if (FOREIGN_ROOTS.has(r.tagName)) return 'foreign-content';
            return 'unquoted-attribute';
        default:
            if (!r.endTag && FOREIGN_ROOTS.has(r.tagName)) return 'foreign-content';
            return 'tag';
    }
}

/**
 * One character under one reading: the readings it leads to — one, or two
 * where a start tag forks the reading (module note).
 */
function step(r: Reading, c: string): Reading[] {
    const s = { ...r };
    switch (s.state) {
        case 'data':
            if (c === '<') s.state = 'tag-open';
            return [s];
        case 'tag-open':
            if (c === '!') { s.state = 'declaration-open'; return [s]; }
            if (c === '/') { s.state = 'end-tag-open'; return [s]; }
            if (c === '?') { s.state = 'bogus-comment'; return [s]; }
            if (isAlpha(c)) { s.state = 'tag-name'; s.tagName = c.toLowerCase(); s.endTag = false; return [s]; }
            // A character that opens no tag is reconsumed in the data state.
            return step({ ...s, state: 'data' }, c);
        case 'end-tag-open':
            if (isAlpha(c)) { s.state = 'tag-name'; s.tagName = c.toLowerCase(); s.endTag = true; return [s]; }
            if (c === '>') return [settle(s)];
            s.state = 'bogus-comment';
            return [s];
        case 'tag-name':
            if (isSpace(c)) { s.state = 'before-attr-name'; return [s]; }
            if (c === '/') { s.state = 'self-closing'; return [s]; }
            if (c === '>') return emitTag(s, false);
            s.tagName += c.toLowerCase();
            return [s];
        case 'before-attr-name':
            if (isSpace(c)) return [s];
            if (c === '/') { s.state = 'self-closing'; return [s]; }
            if (c === '>') return emitTag(s, false);
            s.state = 'attr-name';
            s.attrName = c.toLowerCase();
            return [s];
        case 'attr-name':
            if (isSpace(c)) { s.state = 'after-attr-name'; return [s]; }
            if (c === '/') { s.state = 'self-closing'; return [s]; }
            if (c === '=') { s.state = 'before-attr-value'; return [s]; }
            if (c === '>') return emitTag(s, false);
            s.attrName += c.toLowerCase();
            return [s];
        case 'after-attr-name':
            if (isSpace(c)) return [s];
            if (c === '/') { s.state = 'self-closing'; return [s]; }
            if (c === '=') { s.state = 'before-attr-value'; return [s]; }
            if (c === '>') return emitTag(s, false);
            s.state = 'attr-name';
            s.attrName = c.toLowerCase();
            return [s];
        case 'before-attr-value':
            if (isSpace(c)) return [s];
            if (c === '"') { s.state = 'attr-value-dq'; return [s]; }
            if (c === "'") { s.state = 'attr-value-sq'; return [s]; }
            if (c === '>') return emitTag(s, false);
            s.state = 'attr-value-uq';
            return [s];
        case 'attr-value-dq':
            if (c === '"') s.state = 'after-attr-value';
            return [s];
        case 'attr-value-sq':
            if (c === "'") s.state = 'after-attr-value';
            return [s];
        case 'attr-value-uq':
            if (isSpace(c)) { s.state = 'before-attr-name'; return [s]; }
            if (c === '>') return emitTag(s, false);
            return [s];
        case 'after-attr-value':
            if (isSpace(c)) { s.state = 'before-attr-name'; return [s]; }
            if (c === '/') { s.state = 'self-closing'; return [s]; }
            if (c === '>') return emitTag(s, false);
            // A missing space between attributes: the character starts the next name.
            return step({ ...s, state: 'before-attr-name' }, c);
        case 'self-closing':
            if (c === '>') return emitTag(s, true);
            return step({ ...s, state: 'before-attr-name' }, c);

        // Markup declarations: `<!--` opens a comment; anything else after `<!`
        // (a doctype, a CDATA opener outside foreign content, a conditional
        // comment's downlevel form) is a bogus comment the next `>` ends.
        case 'declaration-open':
            if (c === '-') { s.state = 'declaration-dash'; return [s]; }
            if (c === '>') return [settle(s)];
            s.state = 'bogus-comment';
            return [s];
        case 'declaration-dash':
            if (c === '-') { s.state = 'comment-start'; return [s]; }
            if (c === '>') return [settle(s)];
            s.state = 'bogus-comment';
            return [s];
        case 'comment-start':
            if (c === '>') return [settle(s)];
            s.state = c === '-' ? 'comment-start-dash' : 'comment';
            return [s];
        case 'comment-start-dash':
            if (c === '>') return [settle(s)];
            s.state = c === '-' ? 'comment-end' : 'comment';
            return [s];
        case 'comment':
            if (c === '-') s.state = 'comment-end-dash';
            return [s];
        case 'comment-end-dash':
            s.state = c === '-' ? 'comment-end' : 'comment';
            return [s];
        case 'comment-end':
            if (c === '>') return [settle(s)];
            if (c === '!') { s.state = 'comment-end-bang'; return [s]; }
            if (c !== '-') s.state = 'comment';
            return [s];
        case 'comment-end-bang':
            if (c === '>') return [settle(s)];
            s.state = c === '-' ? 'comment-end-dash' : 'comment';
            return [s];
        case 'bogus-comment':
            if (c === '>') return [settle(s)];
            return [s];

        // Raw and escapable text: held until the element's own end tag. In a
        // script's text past a comment opener the parser has escape states in
        // which an end tag may not close the element; they are not modelled —
        // until the comment closer, no end tag closes it, which only refuses
        // more than the parser would.
        case 'text':
        case 'text-lt':
        case 'text-end-open':
        case 'text-end-name':
            return [textStep(s, c)];
        case 'plaintext':
            return [s];
    }
}

/** One character of raw or escapable text, the closing end tag included. */
function textStep(s: Reading, c: string): Reading {
    if (s.textElement === 'script') {
        const seen = s.recent + c;
        if (seen.endsWith('<!--')) s.scriptEscaped = true;
        else if (seen.endsWith('-->')) s.scriptEscaped = false;
        s.recent = seen.slice(-3);
    }
    switch (s.state) {
        case 'text-lt':
            if (c === '/') { s.state = 'text-end-open'; return s; }
            s.state = 'text';
            return c === '<' ? { ...s, state: 'text-lt' } : s;
        case 'text-end-open':
            if (isAlpha(c)) { s.state = 'text-end-name'; s.buffer = c.toLowerCase(); return s; }
            s.state = 'text';
            return c === '<' ? { ...s, state: 'text-lt' } : s;
        case 'text-end-name': {
            const closes = s.buffer === s.textElement && !s.scriptEscaped;
            if (closes && (isSpace(c) || c === '/' || c === '>')) {
                const tag: Reading = { ...s, tagName: s.textElement, endTag: true, buffer: '', textElement: '', escapable: false, recent: '', scriptEscaped: false };
                if (isSpace(c)) return { ...tag, state: 'before-attr-name' };
                if (c === '/') return { ...tag, state: 'self-closing' };
                return settle(tag);
            }
            if (isAlpha(c)) { s.buffer += c.toLowerCase(); return s; }
            s.state = 'text';
            s.buffer = '';
            return c === '<' ? { ...s, state: 'text-lt' } : s;
        }
        default:
            if (c === '<') s.state = 'text-lt';
            return s;
    }
}

/** Back to the data state, with nothing of the finished token carried along. */
function settle(s: Reading): Reading {
    return dataReading(s);
}

/**
 * A tag's end. An end tag returns to data. A start tag of a foreign root
 * enters foreign content for good. A start tag of a raw-text, escapable-text or
 * `plaintext` element switches to that element's text — and FORKS the reading
 * where the parser may not switch (module note): the other reading reads on
 * as markup, as a parser that ignored the start tag or ran with scripting off
 * would.
 */
function emitTag(s: Reading, selfClosing: boolean): Reading[] {
    const data = settle(s);
    if (s.endTag || s.foreign) return [data];
    if (FOREIGN_ROOTS.has(s.tagName)) return [selfClosing ? data : { ...data, foreign: true }];
    if (s.tagName === 'select' || s.tagName === 'frameset') return [{ ...data, textStartsMayBeIgnored: true }];
    let text: Reading;
    if (s.tagName === 'plaintext') text = { ...data, state: 'plaintext', textElement: 'plaintext' };
    else if (RAW_TEXT_ELEMENTS.has(s.tagName)) text = { ...data, state: 'text', textElement: s.tagName, escapable: false };
    else if (ESCAPABLE_TEXT_ELEMENTS.has(s.tagName)) text = { ...data, state: 'text', textElement: s.tagName, escapable: true };
    else return [data];
    const forks = s.tagName === 'noscript' || s.textStartsMayBeIgnored;
    return forks ? [text, data] : [text];
}

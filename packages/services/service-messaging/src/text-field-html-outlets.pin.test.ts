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
 * outlet escapes by default, for the context the value lands in: HTML-escaped
 * in an HTML face, verbatim in a plain-text face (a subject, a text body, an
 * SMS), where an entity would be a corrupted character instead.
 *
 * ## The list, and the pin on the list itself
 *
 * {@link OUTLETS} names every file of this package that renders a value into
 * HTML, each with a pin below that drives the real render path. A per-entry pin
 * cannot see an outlet nobody listed, so the LIST is pinned too: the census
 * walks this package's source and finds every file that touches HTML at all —
 * an identifier or a string naming `html`, or a string carrying an HTML tag —
 * and requires each one to be on {@link OUTLETS} or on {@link NOT_OUTLETS} with
 * the reason it renders nothing. A new file that touches HTML fails here until
 * its author says which it is.
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

import { renderNotification, NotificationTemplateStore, type NotificationTemplateRow } from './template-renderer.js';
import { createEmailChannel } from './email-channel.js';
import type { Delivery } from './channel.js';

/** …/packages/services/service-messaging/src — this package's whole source tree. */
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
    'template-renderer.ts': {
        renders: 'renderNotification: a sys_notification_template body of format html or mjml',
        pin: pinTemplateRenderer,
    },
};

const NOT_OUTLETS: Readonly<Record<string, NotOutletEntry>> = {
    'email-channel.ts': {
        why: 'hands renderNotification\'s html face to the email service unchanged, and the template arm delegates rendering to the email service\'s own engine',
    },
    'objects/notification-template.object.ts': {
        why: 'declares the `format` vocabulary (markdown, html, text, mjml); renders nothing',
    },
    'template-hole-placement.ts': {
        why: 'reads an html / mjml template body to say where each hole sits; places no value into markup (#25082)',
    },
    'notification-template-placement.ts': {
        why: 'refuses a template save whose html / mjml body places a hole outside the placements template-renderer.ts encodes for; renders nothing (#25082)',
    },
};

// ── The census ──────────────────────────────────────────────────────────────

const HTML_WORD = /html/i;
/** An HTML element (or MJML component) opening or closing tag inside a string. */
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
        const touching = shippedSources().filter((rel) =>
            touchesHtml(rel, readFileSync(join(SRC, rel), 'utf8')),
        );
        const listed = [...Object.keys(OUTLETS), ...Object.keys(NOT_OUTLETS)].sort();
        expect(touching).toEqual(listed);
    });

    it('no file is both an outlet and a non-outlet', () => {
        expect(Object.keys(OUTLETS).filter((f) => f in NOT_OUTLETS)).toEqual([]);
    });
});

// ── The per-entry pins ──────────────────────────────────────────────────────

/** Text fields as a person may type them: markup characters, kept as typed. */
const PERSON = 'Ada <b>Lovelace</b> & "Co"';
const PERSON_IN_HTML = 'Ada &lt;b&gt;Lovelace&lt;/b&gt; &amp; &quot;Co&quot;';
const TITLE = "R&D <i>review</i> it's due";
const TITLE_IN_HTML = 'R&amp;D &lt;i&gt;review&lt;/i&gt; it&#39;s due';

const INPUT = { topic: 'collab.mention', payload: { actorName: PERSON, title: TITLE } };

function pinTemplateRenderer(): void {
    it('html: element text and a quoted attribute both receive the escaped value; the template markup is kept', () => {
        const r = renderNotification(
            {
                subject: '{{ actorName }} mentioned you',
                body: '<p title="{{ actorName }}"><b>{{ actorName }}</b>: {{ payload.title }}</p>',
                format: 'html',
            },
            INPUT,
        );
        expect(r.html).toBe(`<p title="${PERSON_IN_HTML}"><b>${PERSON_IN_HTML}</b>: ${TITLE_IN_HTML}</p>`);
        expect(r.text).toBeUndefined();
    });

    it('mjml: the same escaping', () => {
        const r = renderNotification(
            { subject: 'x', body: '<mj-text>{{ actorName }}</mj-text>', format: 'mjml' },
            INPUT,
        );
        expect(r.html).toBe(`<mj-text>${PERSON_IN_HTML}</mj-text>`);
    });

    it('the subject is plain text: the value renders as typed, beside an html body', () => {
        const r = renderNotification(
            { subject: '{{ actorName }} mentioned you', body: '<p>{{ title }}</p>', format: 'html' },
            INPUT,
        );
        expect(r.subject).toBe(`${PERSON} mentioned you`);
    });

    it('a markdown or text body is plain text: the value renders as typed', () => {
        for (const format of ['markdown', 'text'] as const) {
            const r = renderNotification({ subject: 's', body: '{{ actorName }}: {{ title }}', format }, INPUT);
            expect(r).toEqual({ subject: 's', text: `${PERSON}: ${TITLE}` });
        }
    });

    it('through the email channel: a stored html row sends the text field escaped in the html, as typed in the subject', async () => {
        const row: NotificationTemplateRow = {
            subject: '{{ actorName }} mentioned you', body: '<p><b>{{ actorName }}</b></p>', format: 'html',
        };
        // The stored row, handed straight to the channel: the store's own
        // organization-keyed read is pinned in template-renderer.test.ts, and
        // this pin is about what the channel sends once the row is in hand.
        class StoredRow extends NotificationTemplateStore {
            override async load(): Promise<NotificationTemplateRow | null> {
                return row;
            }
        }
        const sent: any[] = [];
        const email = { async send(input: any) { sent.push(input); return { id: 'email_1' }; } };
        const channel = createEmailChannel({
            getEmail: () => email,
            getData: () => undefined,
            store: new StoredRow({ getData: () => undefined }),
        });
        const delivery: Delivery = {
            channel: 'email',
            // A literal address: the channel reads no sys_user row for it.
            recipient: 'ada@example.com',
            notification: {
                notificationId: 'evt_1',
                topic: 'collab.mention',
                title: 'mention',
                body: '',
                severity: 'info',
                recipients: ['ada@example.com'],
                organizationId: 'org_1',
                payload: { actorName: PERSON },
            },
        };

        const result = await channel.send({ logger: { info: () => {}, warn: () => {}, error: () => {} } } as any, delivery);

        expect(result.ok).toBe(true);
        expect(sent).toHaveLength(1);
        expect(sent[0].html).toBe(`<p><b>${PERSON_IN_HTML}</b></p>`);
        expect(sent[0].subject).toBe(`${PERSON} mentioned you`);
    });
}

// Registered last, so every fixture above is initialised before a pin reads it.
for (const [file, entry] of Object.entries(OUTLETS)) {
    describe(`${file} — ${entry.renders}`, entry.pin);
}

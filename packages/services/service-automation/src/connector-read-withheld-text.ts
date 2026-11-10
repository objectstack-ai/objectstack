// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # A connector's failure text carries nothing its metadata read withholds
 *
 * Rule: a credential part the connector metadata read withholds never comes
 * back in any other text the platform stores, serves or logs. A provider's
 * failure text (the message a factory throws while an instance materializes,
 * the message a handler throws on a call, an upstream's refusal words) is
 * foreign text: it may name the stored URL whole. So it is rewritten here,
 * once, where it enters the platform, before any reader sees it:
 * `degradedReason` (`GET /automation/connectors`, the credential-reference
 * listing, a `connector_action` refusal), the log records of the degrade and
 * fail paths, a stored credential row's `status_reason`, and a flow run's step
 * error.
 *
 * ## One predicate
 *
 * What is withheld is never judged here. The judge is the connector redactor
 * every metadata read exit runs — `getMetadataTypeRedactor('connector')`, the
 * built-in `connector` entry of the redactor registry, or the one a plugin
 * registered in its place — applied twice:
 *
 *  1. **To the stored entry.** Every string under the entry's credential
 *     positions (`providerConfig`, `auth`, `authentication`) that the read
 *     does not serve as stored is replaced wherever it appears in the text:
 *     by the form the read serves when the read rewrote it (a URL with its
 *     credential parts removed), and by {@link CONNECTOR_TEXT_WITHHELD} when
 *     the read withheld it whole (a header or environment map, an inline
 *     `auth` secret, an array holding a credential URL). The stored entry's
 *     other keys are not credential positions, and are left to the text.
 *  2. **To every URL in the text.** A provider can render a stored URL in a
 *     form of its own — `new URL(url).href` lowercases the host and adds a
 *     path — that no stored string equals. Each piece of the text that can
 *     start a URL (a scheme, a `//`, or the start of a whitespace-delimited
 *     run) is judged by the same redactor, as a URL kept under
 *     `providerConfig` beside the entry's own `auth` (whose `api-key`
 *     `paramName` the read judges too), and replaced by the form it serves.
 *     A run holding neither `@` nor `?` is skipped: the read's credential
 *     parts are a userinfo, which ends at an `@`, and query pairs, which
 *     start after a `?`, so such a run has nothing the read would change.
 *
 * Text holding no URL and no withheld string comes back unchanged, and so does
 * a URL the read serves as it is.
 */

import { getMetadataTypeRedactor } from '@objectstack/spec/kernel';

/** What a string the read withholds whole is replaced by in a failure text. */
export const CONNECTOR_TEXT_WITHHELD = '[credential withheld]';

/** A failure text rewritten so it carries nothing the connector read withholds. */
export type ConnectorFailureTextRewrite = (text: string) => string;

/** The entry keys that hold the connector read's credential positions. */
const CREDENTIAL_ROOTS = ['providerConfig', 'auth', 'authentication'] as const;

/** The shortest stored string replaced by value — a shorter one would blank ordinary words. */
const MIN_REPLACED_LENGTH = 4;

/** Where a URL can start inside a run: a scheme followed by `:`, or `//`. */
const URL_START_RE = /[A-Za-z][A-Za-z0-9+.-]*:|\/\//y;

/** A character that may sit inside a scheme, so a scheme cannot start after it. */
const SCHEME_CHAR_RE = /[A-Za-z0-9+.-]/;

/** The runs judged as URLs: everything between whitespace and the characters a serialized URL never holds raw. */
const RUN_RE = /[^\s"<>`]+/g;

const isPlainRecord = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);

const unchanged: ConnectorFailureTextRewrite = (text) => text;

/**
 * Every string at or under `stored` that `served` does not hold at the same
 * position, paired with what replaces it in a text: the served string when the
 * read rewrote it, {@link CONNECTOR_TEXT_WITHHELD} when the read withheld it.
 */
function withheldStrings(stored: unknown, served: unknown, out: Map<string, string>): void {
    if (typeof stored === 'string') {
        if (served === stored || stored.length < MIN_REPLACED_LENGTH) return;
        out.set(stored, typeof served === 'string' ? served : CONNECTOR_TEXT_WITHHELD);
    } else if (Array.isArray(stored)) {
        stored.forEach((element, i) => withheldStrings(element, Array.isArray(served) ? served[i] : undefined, out));
    } else if (isPlainRecord(stored)) {
        for (const [key, child] of Object.entries(stored)) {
            withheldStrings(child, isPlainRecord(served) ? served[key] : undefined, out);
        }
    }
}

/** The next offset at or after `from` where a URL can start in `run` (`0` always can). */
function nextUrlStart(run: string, from: number): number {
    for (let i = from; i < run.length; i += 1) {
        if (i === 0) return 0;
        URL_START_RE.lastIndex = i;
        if (!URL_START_RE.test(run)) continue;
        // A scheme starts only where the character before it cannot belong to one.
        if (run[i] !== '/' && SCHEME_CHAR_RE.test(run[i - 1]!)) continue;
        return i;
    }
    return -1;
}

/**
 * The rewrite for one stored connector `entry`: what the connector metadata
 * read withholds from it, and every URL the same read would rewrite, never
 * appear in the text it returns (see the module note).
 */
export function connectorReadWithheldText(entry: unknown): ConnectorFailureTextRewrite {
    const redact = getMetadataTypeRedactor('connector');
    if (redact === undefined || !isPlainRecord(entry)) return unchanged;

    const replacements = new Map<string, string>();
    const served = redact(entry).item;
    for (const root of CREDENTIAL_ROOTS) withheldStrings(entry[root], served[root], replacements);
    // Longest first, so a whole stored string is replaced before any string it holds.
    const ordered = [...replacements.entries()].sort(([a], [b]) => b.length - a.length);

    const auth = isPlainRecord(entry.auth) ? { auth: entry.auth } : {};
    const judgeUrl = (value: string): string => {
        const judged = redact({ providerConfig: { url: value }, ...auth }).item.providerConfig;
        const url = isPlainRecord(judged) ? judged.url : undefined;
        return typeof url === 'string' ? url : CONNECTOR_TEXT_WITHHELD;
    };
    const judgeRun = (run: string): string => {
        if (!run.includes('@') && !run.includes('?')) return run;
        let out = run;
        for (let start = nextUrlStart(out, 0); start !== -1; start = nextUrlStart(out, start + 1)) {
            const tail = out.slice(start);
            const judged = judgeUrl(tail);
            if (judged !== tail) out = `${out.slice(0, start)}${judged}`;
        }
        return out;
    };

    return (text: string): string => {
        let out = text;
        for (const [stored, replacement] of ordered) out = out.split(stored).join(replacement);
        return out.replace(RUN_RE, judgeRun);
    };
}

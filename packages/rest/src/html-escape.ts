// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25077] The HTML escaper this package's HTML outlets call — ruling 3C on
 * #25040: every outlet that renders a value into HTML escapes it by the context
 * it lands in.
 *
 * It covers the two contexts an outlet here may place a value into: element
 * text and a QUOTED attribute value (single or double quotes). The five
 * characters those contexts interpret become their entities, and every other
 * character passes through untouched, so a value carrying none of the five
 * renders byte for byte as it did unescaped. A browser decodes each entity back
 * to its character, so what the page's script reads from the DOM is the
 * original value.
 *
 * ⛔ Not for an unquoted attribute, a `<script>` or `<style>` body, a URL scheme
 * decision or an event-handler attribute: each of those contexts interprets
 * other characters and needs its own encoder. Place a value only into one of
 * the two contexts above.
 *
 * Why a local module rather than a shared one: no package this one depends on
 * exports an HTML escaper, and the repo's other escaper is private to the mail
 * template engine, which this package does not import. It is not re-exported
 * from the package entry, so it adds nothing to the published surface.
 *
 * The census in `html-outlets.pin.test.ts` lists this file as a non-outlet: it
 * renders nothing itself.
 */

const HTML_ENTITY: Readonly<Record<string, string>> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

const HTML_SPECIAL = /[&<>"']/g;

/** Escape `value` for HTML element text or a quoted HTML attribute value. */
export function escapeHtml(value: string): string {
    return value.replace(HTML_SPECIAL, (ch) => HTML_ENTITY[ch]);
}

---
'@objectstack/lint': patch
'@objectstack/formula': patch
'@objectstack/spec': patch
---

fix(lint)!: `os build`, `os validate`, `os lint` and the email template publish door refuse a hole in an HTML body that sits where the mail renderer's encoding does not suit it (#25189)

Clause-②: no (narrowing: an email template whose `bodyHtml` places a hole outside the supported placements is refused at the three CLI commands and at the publish door, where it passed)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no stored row is read, rewritten or converted, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the verdict the authoring doors give an email template whose HTML body places a hole outside the supported placements. A stored template keeps rendering and is judged at its next publish, and the remedy is the author moving the hole, which no ledger entry can derive. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this verdict (not already-registered); and the change is a lint verdict, not a declaration (not runtime-interface-only or type-surface-only). -->

**BREAKING** (an authoring accept set narrows), shipped as `patch` because the change is not to the metadata protocol (maintainer ruling A on #25105).

The mail renderer encodes a double-braced hole for HTML text and leaves a triple-braced hole unencoded. The template's author decides where each hole sits, and that one encoding is right for some placements and not for others. A new gating authoring rule, `email-template-hole-placement` (`validateEmailTemplateHolePlacements`), classifies every hole in a template's `bodyHtml` by where it sits in the markup and refuses each one outside the supported placements.

- **Supported:** a double-braced hole in element text, or in a quoted attribute value that is read as plain text; and a triple-braced hole only when it reads a variable the template declares with `type: 'url'` and forms the whole value of a double-quoted `href`.
- **Refused:** every other placement, by class. These are attributes read as a URL, event-handler attributes, `style` attributes, attributes read as markup, unquoted attribute values, holes inside a tag, script- and style-like elements, comments, and SVG or MathML content. A triple-braced hole outside the one supported shape is refused as well.
- **FROM:** such a template passed `os build`, `os validate` and `os lint`, and an active `email_template` write answered 200.
- **TO:** the CLI commands report an `error` finding at `emailTemplates[i].bodyHtml`, and the write answers the existing `422 INVALID_METADATA` with the same issue. The message names the hole, its offset and its placement, and the hint names the supported placements. No new error code is added.
- **Unchanged:** `subject` and `bodyText` are not judged, because the renderer writes them as plain text. A draft save is not judged. A stored template is not migrated, not refused on read and not judged at send or at boot. It keeps rendering until its next publish, and that publish is judged.
- **Measured before crossing:** none of the 76 HTML bodies in the HotCRM reference application, and none of the templates this repository ships, is refused. The five bodies the rule did refuse were documentation examples and test fixtures, and each now uses the supported link shape.
- **`@objectstack/formula` (patch):** the classifier the rule reads, `judgeMailHtmlHoles`, is exported with its supported-placement list and labels. `@objectstack/plugin-email`'s built-in template pin reads the same classifier and holds its hole grammar to the renderer's.
- **`@objectstack/spec` (patch):** one conversion's example templates now declare their link variable with `type: 'url'` and place it in an `href`. No schema, conversion behaviour or export changes.
- **The fix for an author:** move the hole into element text or a quoted plain-text attribute. For a link, declare the variable with `type: 'url'` and write it triple-braced as the whole double-quoted `href` value.

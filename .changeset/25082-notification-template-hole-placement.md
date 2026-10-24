---
'@objectstack/service-messaging': patch
---

fix(service-messaging)!: `sys_notification_template` refuses an html or mjml body that places a hole where the renderer's encoding is not right for it

An html or mjml notification template body HTML-escapes every hole's value. That encoding is right in two placements only: element text, and a quoted plain-text attribute value. A hole anywhere else (an attribute read as a URL, an event handler, a style, an attribute holding markup, a meta element attribute, an unquoted attribute value, inside a tag, a raw-text element, a comment, or SVG / MathML content) received an encoding that does not fit where it lands. Such a body is now refused when it is saved. A hole counts as supported only when every way an HTML parser can read the body places it in element text or a quoted plain-text attribute value. The check is the template object's own save hooks, judged over the stored row overlaid with the write, so a row stored before this change that breaks the rule is refused on any edit that leaves it breaking it: frozen, not bricked. It is still read, listed and deleted, and it keeps rendering and delivering as before. No stored row is rewritten.

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is the write accept set of `sys_notification_template` rows, a platform object this package ships and owns, whose rows are admin-authored data rather than metadata: no ADR-0087 conversion reaches a stored data row. The remedy is an author's edit of the row, moving a hole or changing the format, never a rewrite of a metadata source, and this change rewrites or deletes no stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (a platform object's write accept set narrows, stored rows included). It ships as `patch` because the metadata protocol does not move.

- **FROM:** a create, update, import row or bulk-update row that left a `sys_notification_template` row with format `html` or `mjml` and a hole outside element text and quoted plain-text attribute values was accepted and stored. A row already stored that way took every edit.
- **TO:** that write is refused. The REST data door answers `400` with `code: 'VALIDATION_FAILED'` and one finding at `body` (`code: 'invalid_value'`) that names each refused hole and its placement. An import commit fails that row with `field: 'body'` and `code: 'invalid_value'`. A bulk update fails that row with `code: 'VALIDATION_FAILED'` and `httpStatus: 400`, and a predicate update over a set holding such a row writes no row. Every writer is judged, system context included.
- **Unchanged:** `markdown` and `text` bodies, whose holes render verbatim; html and mjml bodies whose every hole sits in element text or a quoted plain-text attribute value; reading, listing and deleting any row; and how every row renders and is delivered. No error code is added.
- **The fix for an author:** move each refused hole into element text or a quoted plain-text attribute value, or set the format to `text` or `markdown`. A link whose address comes from a value belongs in an email template (`email_template`), which declares that variable as a URL; name it in the notify step's `template`.

---
"@objectstack/spec": minor
---

fix(spec): `PageHeaderProps.title` is optional — matches the platform's own synthesized header (#7702)

`PageHeaderProps.title` was declared **required**, but the platform's own
synthesizer (objectui `buildDefaultHeader`) emits every seeded `page:header`
with **no `title` at all** — `{ type: 'page:header', recordChrome, …actions }`.
`PageHeaderRenderer` (`containers.tsx`) reads
`schema?.title ?? schema?.properties?.title` and, finding neither, falls
through to the record chip's own record-derived heading: a static authored
title would be wrong on every record but one. `PageHeaderProps.safeParse`
therefore rejected the platform's own canonical output with `title: Invalid
input` — invisible on the write path today (`PageComponent.properties` is an
opaque `z.record`), but a standing contradiction that surfaces the moment any
props-level validation runs against a header node (`validateComponentProps`,
#5068, is exactly that consumer).

Maintainer ruling 2026-08-11 (accepting the spec lane's A/B recommendation,
rejecting a sentinel-value option C): `title` becomes optional, and its
describe states the sanctioned spelling — **title omitted ⇒ the renderer
derives the heading from the record**. Authors still set it explicitly on
non-record pages (dashboards, landing pages) where there is no record to
derive a heading from.

This is a widening change: every payload that validated before (with `title`)
still validates identically, and `title`, when present, still parses as
`I18nLabelSchema` exactly as before. The only newly-accepted shape is a
`page:header` with `title` omitted — the platform's own default. Minor, not
patch, because the accepted-input surface grows.

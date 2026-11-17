---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': patch
'@objectstack/lint': patch
---

feat(metadata-protocol, spec, lint)!: a post-publish probe finding carries the sentence for the person who published, in their language

Clause-②: yes (narrowing) — narrowed: `PublishPackageDraftsResponseSchema.probes` FROM `z.unknown()` (any value parses; input and output type `unknown`) → TO `BuildProbeReportSchema` (only the report parses; type `BuildProbeReport`). Widened: the optional `RuntimeBuildIssue.userMessage`, the new `RuntimeBuildIssueSchema` / `BuildProbeReportSchema` exports, and `userTextLocaleOf` / `renderUserText` / `UserTextEntry` from `@objectstack/lint`.
Metadata-protocol: added
Skills-docs: follow-up #34552

<!-- adr-0087: not-required (no-migration-prescription) No key a metadata author writes is removed, renamed or re-shaped and no stored row changes shape: `probes` is a field of the publish-drafts RESPONSE, written by the platform's own probe pass, which emits only the report. Nothing exists for `objectstack migrate meta` to rewrite; the code that meets the narrowing is a hand-written producer or test double of that response, and the TypeScript compiler names it at its call site. -->

**BREAKING** for code that builds a `PublishPackageDraftsResponse` by hand (another protocol host, a test double) with a `probes` value that is not the report, or that parses such a value through `PublishPackageDraftsResponseSchema`: it used to parse, and it is now refused at `probes`. The fix: write `probes` as `{ issues: RuntimeBuildIssue[], checked: { seeds, views, widgets, objects } }`, or leave it out. A reader of `probes` loses nothing: the type moves from `unknown` to the report, so a cast is no longer needed.

`POST /packages/:id/publish-drafts` answers with `probes`, the report of the checks that run after a publish (ADR-0038 L3). Each finding in `probes.issues[]` now carries `userMessage`: one sentence for the person who asked for the app, composed by the probe in the request's language. The language is the request's locale, else the workspace default, else English, over the eleven platform locales. A sentence names a dashboard, widget, dataset, view or object by its label where the probe can read one, and by its API name otherwise. An object the publishing account was refused, or whose read access the server could not decide, is named by the API name the refusal carries, and the probe reads nothing of it.

`message` and `fix` are unchanged: they stay the English text written for the agent that published, and `code` stays the stable id. A client shows `userMessage` to a person and no longer needs a per-code translation table; when the field is absent it shows its own generic sentence. All eight probe codes have sentences: `seed_not_applied`, `view_read_failed`, `object_field_ref_unknown`, `object_field_ref_rule_failed`, `widget_not_probed`, `empty_query`, `widget_query_failed` and `probes_unavailable`.

`@objectstack/spec`: `probes` on `PublishPackageDraftsResponseSchema` is modeled. It was `z.unknown()`; it is now `BuildProbeReportSchema` (`issues[]` of `RuntimeBuildIssueSchema`, and `checked` with the `seeds`, `views`, `widgets` and `objects` counts), member for member what the probe pass returns. The inferred type of `probes` changes from `unknown` to the report, so code that reads it no longer needs a cast. A `probes` value that is not the report no longer parses through the schema; the platform's own producer emits nothing else.

`@objectstack/metadata-protocol`: `RuntimeBuildIssue` and `BuildProbeReport` are now re-exports of the spec types, and `runBuildProbes` takes `userTextLocales`, which `publishPackageDrafts` fills from the request.

`@objectstack/lint`: `userTextLocaleOf` and `renderUserText`, the locale ladder behind `findingUserMessage`, are exported (also from `@objectstack/lint/runtime`) with the `UserTextEntry` type, so a producer that keeps its own sentences uses the same ladder.

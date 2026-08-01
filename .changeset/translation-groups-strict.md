---
'@objectstack/spec': minor
---

Translation bundles and `translation` items reject unknown keys, at both doors — and a bespoke guard that only covered one of them retires into the rejection message.

Translation data has the cruellest version of the silent-strip failure in the spec. A misspelled group is dropped, the bundle loads without complaint, and the string renders in the source language — **indistinguishable from a translation nobody has written yet.** There is no wrong output to notice, so the bug looks like a coverage gap forever.

**#3778 already knew this, and fixed it for ten keys.** Retiring the object-first (`o.<object>`) dialect meant old-shape items saved cleanly and resolved to nothing, so it added a `z.preprocess` that scanned for the ten retired keys and raised a 422 naming the right destination for each.

That guard has the shape every workaround for `.strip` has:

- **It could only catch mistakes someone had already thought of.** `object` for `objects`, `message` for `messages`, an invented group — still dropped in silence.
- **It ran on one of the two doors.** Only `TranslationItemSchema` (Studio / the metadata API). The same ten keys in a file-authored bundle — the path the examples and the platform apps actually use — were stripped with no complaint at all. The same asymmetry #4522 found in #1535's object guard, two authors solving the problem in front of them.

With the shape closed the guard is redundant, so it is gone and its ten prescriptions ride the rejection as `guidance`. **What was worth keeping was never the detection — it was the prose.** Detection generalizes for free once the default flips; the sentence telling an author where their content goes does not.

Closed across every authorable group: object/field/view/action/section translations, apps and navigation, dashboards and widgets, pages, settings, metadata forms, and the i18n config. Aliases carry the near-misses edit distance cannot: `views` → `_views`, `help` → `helpText` on an action param (`help` is correct one surface over), `label` → `title` on a widget (a dashboard's headline is `label`, its widget's is `title` — one level apart, opposite spellings).

**The i18n config's four removed knobs get tombstones.** #3494 deleted `fileOrganization`, `messageFormat`, `lazyLoad` and `cache` because no runtime read them. Removing a key that was already a no-op leaves the author with the same silence and one more reason for it; the rejection now says which issue removed it and why.

**Two gates were found doing half their job.**

`translation` was on the ADR-0010 envelope debt list — the loader stamps `_packageId`/`_provenance` and the schema could not hold them, so `authored-translation-sync` strips them by hand on the read side. Declared; the list is down to four.

And `metadata-create-seeds.test.ts` — the canonical guard against a designer's create shape drifting from the spec — asserts every seed parses. The `translation` seed ships `{ name, label, locale, objects }` and the type declared neither `name` nor `label`, so **two thirds of the authoritative create shape was being stripped while the gate that exists to catch that reported green.** A gate built on a `.strip` schema catches a missing required key and can never catch an extra undeclared one. `name`/`label` are now declared (`translation` was the only registered type of 25 without a `name`), classified in the liveness ledger as dead *body* keys with the row column as the live one.

Registered types closed at the top level: **17 of 25**. Still open: `action`, `agent`, `dashboard`, `field`, `mapping`, `page`, `view`.

Authoring impact: a key none of these shapes declares is now rejected instead of silently discarded — it was already being ignored, so no working translation changes. Verified against the real bundles in `examples/app-crm`, `examples/app-todo` and `platform-objects`, all of which `.parse()` at module load, and against the live `GET /translations/:locale` body.

---
"@objectstack/spec": patch
---

docs: make the root README's example-app size claim and package-directory count agree with what they describe (#10320)

Two numbers on the front door of the repo restated a fact that lived somewhere else, and had already drifted from it:

- The `examples/app-crm` size blurb hard-coded **31 files, 1,792 lines, roughly 16k tokens**, then handed the reader the exact `find examples/app-crm/src -name '*.ts' -not -name '*.test.ts' | xargs cat | wc -l` command and invited them to verify it under "Count it yourself:". Running that command against `origin/main` returns **1,930 lines**, not 1,792 — a reader who took the invitation got a different number than the one two lines above it.
- The Package Directory's `<details>` summary claimed **72 published packages**; the table beneath it actually lists **45** rows (a curated set of highlights, not every package — three of those rows are the example apps, whose `package.json` is `"private": true` and never published at all), while the repo's true count of non-private `package.json` files is **69**.

Rather than re-hardcoding a fresh pair of numbers that will silently drift again at the next merge to `examples/app-crm` or the next row added to the table, both passages now name their own source of truth explicitly and defer to it instead of duplicating it: the CRM blurb states its numbers "as of this writing" and says outright that the command below it, not the sentence, is authoritative; the package-directory summary's count is now the table's actual row count and says the table itself is the source of truth for that count.

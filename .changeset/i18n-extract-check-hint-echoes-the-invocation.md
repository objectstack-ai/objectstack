---
"@objectstack/cli": patch
---

`os i18n extract --check` now prints the invocation it was given, minus `--check`, as its "Regenerate and commit" hint — instead of a command assembled from four of the flags.

The hint used to be built at the print site from the config argument, the emitted locales minus the default one, `--fill` and `--out`. Everything else was absent from the expression, so it was absent from the advice. Driven on the reported invocation against a stack whose `i18n.defaultLocale` is `zh-CN`:

```
$ os i18n extract objectstack.config.ts --locales=zh-CN --no-metadata-forms \
    --no-objects-only --filter=kpi_ --out=OUT --check
  ✗ missing:    ../../../../../tmp/os-i18n-repro/zh-CN.objects.generated.ts
  ✗ Translation bundles have drifted from the schema. Regenerate and commit:
  os i18n extract objectstack.config.ts --locales= --fill=empty --out=OUT
```

`--locales=` came out empty because the only locale asked for was the default one, and the echo dropped the default locale on the grounds that `--locales` always re-adds it; `--no-metadata-forms`, `--no-objects-only` and `--filter=kpi_` were never candidates for the line. Running what it printed wrote 775 keys across two files where the operator's own command writes 2 across one — a `metadata-forms` companion they had explicitly switched off, and an unfiltered key set. The next `--check` then failed again, on `out of date:` instead of `missing:`, and printed the same wrong command. A failure that heals itself in one step became a loop, and the loop was the printed advice.

The hint is now a deletion rather than an assembly: this run's own argv with the `--check` token removed, shell-quoted so it can be copied, `--` honoured so a positional `--check` is left alone. Nothing enumerates flags, so a flag added to this command later is echoed without anyone remembering this print site. When `--check` is not in the argv the command cannot say what it removed, and prints "re-run the same command without `--check`" rather than guessing.

Diagnostic paths are also no longer walks. `missing:`, `out of date:` and `Wrote` printed a bare path relative to the working directory, which for an `--out` outside the project produced `../../../../../tmp/i18n-out/zh-CN.objects.generated.ts` for a directory the operator had just typed in full. A path the working directory cannot reach downwards is now printed absolute; an in-tree `--out` — what all nine of this repo's extract configs use — keeps the short relative form it has always had.

---
"@objectstack/driver-sql": patch
---

refactor(driver-sql): read the autonumber default from the contract instead of a hardcoded fallback (#7263)

Execution half 3/3 of the maintainer's route-3 ruling on #6555. `{0000}` is now a
declared contract default (`DEFAULT_AUTONUMBER_FORMAT`, landed with
`resolveAutonumberFormat` in `@objectstack/spec/data`), so this driver stops
writing the default down for itself.

Two sites in `sql-driver.ts` — `initObjects` and the external-object
registration path — each spelled the same four lines by hand:

```ts
const rawFmt = (typeof field.autonumberFormat === 'string' && field.autonumberFormat)
  ? field.autonumberFormat
  : (typeof field.format === 'string' && field.format ? field.format : '');
const fmt = rawFmt || '{0000}';
```

Both are now `const fmt = resolveAutonumberFormat(field);`. That is the whole
change: one symbol added to an import this file already had, no new dependency,
and the `#1603` comment about honouring both spellings retired to the resolver's
own docstring, which carries it.

**Behaviour-neutral, by construction and by measurement.** `resolveAutonumberFormat`'s
precedence — canonical `autonumberFormat`, then the `format` shorthand, then the
declared default, with anything that is not a **non-empty string** counting as
undeclared — was deliberately taken from these very lines, including their
truthiness rule (not the engine's `??`). A differential check over 484 field
documents, spanning both spellings across 22 value shapes (absent key,
`undefined`, `null`, `''`, non-empty strings, numbers, booleans, `NaN`, arrays,
objects, a boxed `String`, `Symbol`, function, `BigInt`), found the old
expressions and the resolver returning the identical string in every case —
`format: ''`, `autonumberFormat: ''` and the non-string values included, not just
the happy path.

Compatibility note, per the ruling: choosing {0000} keeps stored driver-sql data
undisturbed; engine-fallback deployments flip from bare 1 to 0001 for newly
issued numbers. Counter continuity itself is unaffected (#6468 pinned it).

The engine half of the same ruling is #7262; #6555 stays open until it lands, so
a format-less field still renders `0001` on SQL and a bare `1` on the engine's
in-memory fallback until then. This half moves neither.

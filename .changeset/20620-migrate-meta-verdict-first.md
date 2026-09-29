---
'@objectstack/cli': patch
---

fix(cli): `os migrate meta --from N` prints the schema verdict and the refusals first, then the applied mechanical edits, then the manual changes

Clause-②: no

`os migrate meta --from N` prints every semantic entry of every protocol major the
chain crosses, whatever the stack uses: a `--from 17` run prints 242 manual changes.
Those used to come before the schema verdict, which was the last line of the report
and said "resolve the manual changes above". The refusals that keep the migrated
stack from parsing were not listed at all. The only refusal list was the one printed
while the config loaded, and that list names the stack as authored, including the
keys the chain goes on to convert.

The human-readable report now prints three groups, each opened by one header line
that counts it:

1. the verdict: `Migrated stack is schema-valid`, or
   `Migrated stack does not yet pass schema validation — N refusals left after the chain`
   followed by one `✗ path: message` line per refusal of the migrated stack;
2. `Applied N mechanical change(s):`;
3. `N manual change(s) require your judgment:`.

No manual change is dropped, merged or reworded. Every applied edit and every
manual change prints byte for byte as before, in the same order within its group.
The data-migration advice is still the last thing printed. A range that holds no
migration step also leads with the verdict, which now lists the source's refusals,
and the note naming the range to use follows it.

`--json` is unchanged: same keys, same values, same array order. The exit code is
unchanged too: a run whose migrated stack does not parse still exits 0.

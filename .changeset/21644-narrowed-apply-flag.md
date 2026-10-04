---
'@objectstack/cli': patch
'@objectstack/service-storage': patch
---

`os migrate value-shapes` and `os migrate files-to-references` record the deployment-level ADR-0104 flag only from a run over every object, and every command in the `os migrate` data-migration family refuses an `--object` name the deployment does not declare (#21644).

Clause-②: no

- **A narrowed `--apply` records no deployment flag.** The flag attests the stored data of every object and turns strict enforcement on, but a run narrowed by `--object` reads only the named objects. Such a run still applies its fixes: `files-to-references` converts the named objects' values. It records no flag, whether it passes or fails, and leaves a flag that an earlier full-scope run recorded exactly as it was. Its output says why and names the run that records the flag: the same command without `--object`. The `--json` document carries `filter: { objects }`, which is `null` on a full-scope run, so a narrowed run is never mistaken for a full one. Any `--object` narrows, even a list that names every object. A full-scope `--apply` records the flag as before.
- **`runFilesToReferencesMigration`** (`@objectstack/service-storage`) skips the flag write when it is given `objects`. That includes `[]`, which walks nothing. Its `flag` result is `null` on a narrowed run.
- **The column step of `files-to-references` does not run on a narrowed run.** It retypes every single-value media column in the database on the authority of the gate, and a narrowed gate vouches only for the named objects. Before this change, a narrowed `--apply` or a misspelled one moved those columns and stamped `columns_moved_at`.
- **An unknown `--object` is an error.** This applies to `value-shapes`, `files-to-references`, `summary-nulls` and `duplicates`. A name the booted registry does not declare exits 1 with `OBJECT_NOT_FOUND`, and the error names that name and the declared objects. The check runs before anything is read or written. Until now, such a name was filtered out of the scan without a word, so a typo scanned nothing and read as a clean run. `duplicates` reports the refusal as `{ error: 'report_failed', detail, code }`. A declared object that the command has nothing to check on is still accepted.

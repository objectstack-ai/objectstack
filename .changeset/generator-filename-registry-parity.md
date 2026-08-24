---
'@objectstack/cli': patch
---

`os generate` writes every scaffold as `NAME.TYPE.ts`, with the infix read from
the metadata type registry instead of the harness

`os g object customer` wrote `src/objects/customer.ts`. The metadata loader
discovers files by globbing each type's own `filePatterns` from
`DEFAULT_METADATA_TYPE_REGISTRY` — `MetadataPlugin._loadFromFileSystem` does
this for **every** registered type, and it is the default `eager` bootstrap
whenever no compiled artifact is configured. Measured across the seven
generators: the bare `NAME.ts` the harness wrote matched **zero** of those
patterns for all seven, while `NAME.TYPE.ts` matched exactly one, every time.
A scaffold that matches nothing still type-checks, still passes `os validate`
and still publishes, and is then never loaded, with no diagnostic at any step
— the silent-strip shape ADR-0063's retirement of `os g agent` closed.

The previous release closed this for `skill` alone, through an optional
per-generator filename override, on the belief that the other six types were
not filesystem-discovered. The loader says otherwise, so the override is
retired rather than copied five more times: the filename is now derived from
the type's declared pattern, which is also why it reads the pattern rather than
interpolating the type key — `email_template` declares `*.email-template.ts`
and `external_catalog` declares `*.external-catalog.ts`, so an interpolated
infix would re-create the same invisibility for the next generator added.

Now written: `customer.object.ts`, `customer.view.ts`, `approve.action.ts`,
`customer.flow.ts`, `sales.dashboard.ts`, `crm.app.ts`,
`lead_qualification.skill.ts`. The barrel `index.ts` line is derived from the
filename that was actually written, so it names the real module.

**Existing files are not renamed and keep working.** A `NAME.ts` file already
on disk matched no `filePatterns` entry before this change either, so nothing
it relies on moves: if your app loads it through the barrel `index.ts` the
generator wrote, that import is untouched. Rename it to its type's pattern if
you also want the loader's own glob to find it.

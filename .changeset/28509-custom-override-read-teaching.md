---
'@objectstack/skills': patch
---

docs(skills): objectstack-platform teaches the one effective read of a `.custom` declared override (ADR-0146 D8)

Clause-②: no
Metadata-protocol: none

- **Before.** The `overrides: { package, basedOn }` declaration takes effect on every read of a name an installed package ships (ADR-0146 D8), but no published skill mentioned `.custom`, `overrides` or `basedOn`. An agent customizing an installed package (HotCRM) was still taught the Setup overlay row as the only path, which the read now treats as a package-unbound row awaiting migration, or wrote an undeclared same-name item that the layered read reports as an orphan.
- **Now.** `objectstack-platform`'s Manifest Reference says where a customization lives (the paired `<base>.custom` package), what an author writes (the same-named item with `overrides: { package, basedOn }`, the base's `manifest.id` / `manifest.version`), where the declaration is honoured (only from the pair; today only for a view, dashboard, report, email_template or translation, the other overridable types waiting for their doors; `basedOn` never judged; any other package's declaration ignored) and what the read serves (every read agrees; one item per name in the environment-wide list; orphans in the layered read's `overlay`; a withdrawn public form never re-opened; the pair's export carries the declaration). One eval asserts the declared shape and refuses the Setup-write alternative.
- The file stays under its token ceiling: the new text is paid for by deleting restatement in the same file (the CLI cheat sheet `references/operations.md` already holds, the seed `object`-is-derived sentence `objectstack-data`'s `seeds.md` holds, a table restating its own paragraph, two doubled rules). The `os migrate` row of `references/operations.md` takes back the `apply` rule the cheat sheet carried (loosens only; `--allow-destructive` for drops/tightenings). The SKILL.md ceiling lowers to its new measurement; no ceiling rises, no frontmatter, schema or behaviour change. The docs site gains the same facts on the metadata-lifecycle page and one sentence on the forms page.

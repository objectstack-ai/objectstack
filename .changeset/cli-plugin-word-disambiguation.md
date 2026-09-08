---
"@objectstack/cli": patch
---

docs(cli): give the two `plugin` artifacts their own nouns, and rewrite "Which scaffolder?" as a two-question decision (#16484, #15531)

`plugin` names two different artifacts in this CLI, and neither the help text
nor the docs said which one a reader was about to get:

- `os init <name> -t plugin` scaffolds a **metadata package** — declarative
  objects another stack loads, built by `objectstack compile`, emitted
  `private: true`.
- `os create plugin <name>` scaffolds a **kernel code plugin** — TypeScript
  implementing the kernel `Plugin` contract, built by `tsc`, publishable as
  `@objectstack/plugin-<name>`.

Someone who wanted a "plugin skeleton" and reached for the nearer of the two got
the wrong artifact, with no failure anywhere to tell them so — the metadata
package has no `Plugin` to implement, and the kernel code plugin has no
declarative objects to compile.

**No flag and no subcommand is renamed.** `-t plugin` and `os create plugin` are
published surface and are spelled exactly as before; renaming them is a separate
decision, not this change. What moved is the NOUN each surface uses for the
artifact, so the two shapes stop sharing one word:

- `os init --help` now reads `Template: app, plugin (a metadata package), empty`,
  and the `plugin` template describes itself as
  `Metadata package: declarative objects another stack loads` rather than
  `Reusable plugin with objects`.
- `os create`'s `plugin` template describes itself as a **kernel code** plugin.

The "Which scaffolder?" guidance in `content/docs/deployment/cli.mdx` is now a
two-question decision — *metadata or kernel code?* then *a new project, or an
addition to a directory you already have?* — landing on exactly one of the four
entry points, each with the reason to pick it: `npm create objectstack@latest`
(equivalently `npx create-objectstack`), `os init`, `os init <name> -t plugin`,
and `os create plugin <name>`. `os create example` is deliberately absent: it was
retired in #16483.

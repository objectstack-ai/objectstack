---
title: Documentation Guide
description: The authoring rules every package doc must follow — flat directory, namespace prefix, links, and the Markdown subset.
---

# Writing package docs

Rules this very file follows (each one is enforced by `os build`):

- **Flat directory** — every doc lives directly in `src/docs/`;
  subdirectories fail the build. Flatness is what keeps references
  stable: a link is resolved by basename, never by path.
- **Namespace-prefixed filename** — the stem becomes the doc name
  (`showcase_docs_guide.md` → `showcase_docs_guide`), globally unique
  inside a running instance, so the console URL needs no package
  coordinate.
- **Title** — frontmatter `title:` wins (this file uses it); otherwise
  the first `#` heading; otherwise the name.
- **Pure Markdown** — CommonMark + GFM only. MDX and image references
  are rejected at build time (trust boundary + version immutability).

## Cross-references

Link to a sibling doc with a plain relative link:

```md
See the [overview](./showcase_index.md).
```

The console rewrites it to `/docs/showcase_index`; in an editor or on
GitHub the same link just works. Broken same-package links fail the
build. Back to the [overview](./showcase_index.md).

---
title: Showcase
description: Overview of the showcase package and the docs-as-metadata feature it demonstrates.
---

# Showcase

The living conformance fixture for the ObjectStack protocol: every field
type, view type, chart type, report type, and action location appears at
least once, and the coverage test fails when the platform gains a
feature this package does not yet demonstrate.

This manual itself demonstrates one of those features — **package docs
as metadata** (ADR-0046). Every Markdown file in the flat `src/docs/`
directory compiles into a `doc` metadata item at build time, ships
inside the package artifact, and renders in the console at
`/docs/<name>`.

For the authoring rules this page must itself obey, see the
[documentation guide](./showcase_docs_guide.md) — or jump straight to
its [cross-reference section](./showcase_docs_guide.md#cross-references).

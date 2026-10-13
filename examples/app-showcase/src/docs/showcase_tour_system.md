---
title: "Tour · System"
description: Guided tour of the system domain — datasources & federation, i18n, email templates, docs-as-metadata, and the declared HTTP endpoints.
---

# Guided tour — System

Everything in this domain lives under `src/system/` (plus the pinned flat
`src/docs/` directory this page is part of).

## Datasources & federation

`src/system/datasources/` declares a second, read-only SQLite file as an
**external datasource** (ADR-0015 / ADR-0062). It auto-connects at boot with
no driver wiring; its federated objects (External Customer / External
Order) are queryable via REST and visible in **Setup → Datasources**. The
`external_catalog` snapshot is produced at runtime by the Sync wizard —
there is no declarative artifact, so the coverage manifest waives that kind
with the tracking issue.

## i18n & email

- `src/system/translations/` — the `en` + `zh-CN` bundles; switch locale in
  the console and the navigation follows.
- `src/system/emails/` — outbound email templates used by the automation
  chain.

## Docs & books — this manual is metadata

Every Markdown file in flat `src/docs/` compiles to a `doc` item
(ADR-0046); `src/system/books/` curates them into the spine you are
reading, exposed publicly through the library portal. The
[documentation guide](./showcase_docs_guide.md) states the authoring rules
this very page obeys.

## HTTP endpoints

`src/system/apis/` declares every endpoint this app serves, under its own
`/api/v1/apps/showcase/` namespace. None has handler code: each one names
a pipeline the platform already runs, a data operation or a flow. The
**Recalculate Estimate** and **Recalculate Selection** buttons on a task
call `POST /api/v1/apps/showcase/recalc`, whose flow recomputes the
estimate from the task's schedule window and writes it as the person who
clicked. Someone who may not edit the task is refused, and nothing is
written.

Continue with the [Security tour](./showcase_tour_security.md), or go back
to the [overview](./showcase_index.md).

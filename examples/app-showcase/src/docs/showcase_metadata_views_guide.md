---
title: Live Metadata Views in Docs
description: Embed live, read-only views of state machines, flows, and permissions directly in the prose.
---

# Live Metadata Views in Docs

Documentation is for the reader who can't — or shouldn't — open Studio: a
business analyst, a project manager, an auditor. For them a running screen only
ever shows *their own slice* of the system. It never shows the whole shape of a
process, the full set of legal state transitions, or who can do what across an
object.

This page embeds those **live, read-only views** straight into the prose with a
` ```metadata ` fenced block. Each view is **resolved at read time** from the
current metadata — change the underlying state machine and the diagram below
changes with it. Nothing here is a screenshot (ADR-0051).

## A record lifecycle — state machine

A Task moves across a board. Which moves are legal is governed by the
`task_status_flow` state machine on the `showcase_task` object. Here it is,
rendered live from that rule:

```metadata
type: state_machine
object: showcase_task
name: task_status_flow
```

Projects have their own lifecycle, including terminal (dead-end) states:

```metadata
type: state_machine
object: showcase_project
name: project_status_flow
```

## A process — flow

The reassignment wizard, shown at the **business altitude** — purely technical
steps (scripts, record I/O) are folded away so the reader sees the process, not
the plumbing:

```metadata
type: flow
name: showcase_reassign_wizard
detail: business
```

## Who can do what — permission

The `showcase_contributor` permission set, as an object-access matrix:

```metadata
type: permission
name: showcase_contributor
```

---

> These four views are not authored prose — they are the live metadata,
> projected read-only into the document. See
> [the showcase overview](./showcase_index.md) for the rest of the workspace.

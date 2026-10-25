---
title: "Flow Designer"
description: "Authoring automation flows on the visual canvas — nodes, edges, the searchable add-node palette, the node inspector, validation, and simulation."
---

# Flow Designer

The **Flow Designer** is the visual editor for `flow` metadata in the console's
metadata admin. It renders a flow's nodes and edges on a pan/zoom canvas so you
can assemble automation — create/update records, branch on conditions, wait for
events, call APIs, route for approval — without hand-editing JSON. The designer
is a thin, **spec-driven** view over `flow` metadata: everything you drop on the
canvas is a node in the flow's schema, so the same document runs unchanged on
the automation engine.

Open it from a `flow` record's **Design** tab. The **Form** tab holds the same
flow as an editable tree; the two stay in sync.

## The canvas

Each node is a card showing its icon, label, `type`, and a one-line summary of
its config. Edges are the arrows between them.

| Gesture | Result |
|---|---|
| Click a card | Select it (opens the node inspector) |
| Drag a card | Reposition it |
| Hover a card → click the bottom **+** | Append a connected child node |
| Drag a card's connect handle (the dot beside its bottom **+**) onto another node | Connect the two nodes. Refused, with the reason shown, for the node itself, a (source, target) pair another connection already joins, or a node the flow does not have |
| Zoom controls / **Fit** | Scale and re-center the graph |

A selected connection's **From** and **To**, in its inspector, re-point it to
other nodes of the flow, under the same refusals.

Structural problems (an undeclared cycle, an unreachable node) surface three
ways at once: a red ring on the offending card, a badge in its corner, and an
inline banner at the top-left of the canvas. Clicking a banner row selects and
pans to the element it refers to.

## Adding nodes — the palette

The **Add node** button (top-right, edit mode only) opens the node palette: a
searchable, grouped list of every node type the flow can use.

### Search and keyboard

Type in the box at the top to filter across **all** categories at once — the
match is a case-insensitive substring test over each node's **label**, **hint**,
and **type**, so `scr` finds *Screen*, `http` finds *HTTP request*, and a word
that only appears in a hint (`concurrently` → *Parallel*) still surfaces the
node. Clearing the box restores the full grouped list.

The palette is keyboard-navigable end to end:

| Key | Action |
|---|---|
| `↑` / `↓` | Move the highlight (wraps around) |
| `Enter` | Insert the highlighted node |
| `Esc` | Close the palette |

The search box autofocuses when the palette opens, so you can open, type a few
letters, and press `Enter` without touching the mouse.

### Categories

Nodes are grouped into five sections, in this order:

| Category | Node types |
|---|---|
| **Data** | Create / Update / Get / Delete record |
| **Logic** | Decision, Loop, Set variables, Parallel, Try / Catch |
| **Human** | Approval, Screen |
| **Integration** | HTTP request, Connector, Script |
| **Flow** | Subflow, Wait, End |

Section headings are localized to the active console language (e.g. *数据 /
逻辑 / 人工 / 集成 / 流程* in Chinese); the underlying node types are unchanged.

### Recently used

When the search box is empty, a **Recently used** group tops the list with the
node types you inserted most recently (up to five, most-recent first) — so the
nodes you reach for repeatedly stop needing a scroll or a search. The list is
per-user and, when the console is connected to a backend, syncs across devices
(see [User-Scoped State Persistence](/docs/guide/user-state-persistence)); it
falls back to browser-local storage when offline. Types from a plugin that was
since uninstalled drop out of the list automatically.

### Server-merged, plugin-extensible

The palette is **server-driven**. Beyond the built-in node types, the running
engine publishes its registered actions at `GET /api/v1/automation/actions`, and
plugins contribute their own node types there (for example an `approval` node
from an approvals plugin, or third-party `connector_action` providers). The
designer overlays those descriptors onto the built-in list — adopting the
engine's labels and descriptions and appending engine-only types — so the
palette always matches what the connected backend actually supports. Plugin
nodes are searchable exactly like built-ins, including by their registered
`type`. When the endpoint is unreachable the designer falls back to its
built-in defaults, so authoring still works offline.

## The node inspector

Selecting a node opens its inspector: **ID**, **Label**, **Node Type**, and a
**Configuration** section. New nodes start with defaults where the spec allows
one: a *Wait* node already carries a timer config, and an *HTTP* node defaults to
`GET`. What the author must still supply is marked with a red `*`, the same
required marker the other metadata forms use. That covers an *HTTP* node's URL, a
record node's object, a decision branch's label and expression, and a screen
field's name. The marker follows the installed spec, so a key required only in
some configurations (a *Notify* node's title while it has no template) is marked
only while it applies. Until the value is supplied, the spec's error is shown on
that node and listed in the **Problems** panel.

For node types whose engine executor publishes a `configSchema` (ADR-0018), the
inspector renders a **server-driven property form** from that schema — so a
plugin's node gets a real config UI without the designer hardcoding its fields.
The mapping covers scalars, enums (→ select), typed references (→ picker),
free-form maps (→ key/value), and array/object shapes: an array of objects
becomes a **repeater**, and a repeater column that is itself an array (of
strings, numbers, or objects) becomes a **nested repeater** — so an
engine-published nested-array config is editable inline rather than dropping to
the Advanced JSON block.

An *Approval* node's approver **Value** cell takes its candidates from where the
schema's published binding for the row's **Type** says they live (`xRef.sources`):
a directory kind (`user`, `team`, `department`) is a lookup over its directory
object's records, and a kind bound to the metadata registry
(`{ source: 'registry', type }`, which is how `position` is bound on a server
carrying objectstack#22710) is a select over that type's declared items that
stores the item's name. Both offer a pencil toggle for typing a value by hand.

A **Decision** node's Branches editor defines each branch's label, CEL
expression, **and target node** in one table: the **Target** column picks the
downstream node, wiring (creating, retargeting, or detaching) the branch's
outgoing edge with its condition, label, and default flag. The same binding can
also be edited from the edge side — select a connector and use its **Branch**
picker — and the two stay in sync, because the routing always lives on the
edges.

An **Assignment** node's Assignments editor sets one variable per row. Each
value is either text or a CEL expression, chosen with the row's *Write as a CEL
expression* toggle. The node's `config` then reads:

```json
{
  "assignments": {
    "label": "{record.name}",
    "digest": { "dialect": "cel", "source": "joinNonEmpty(names, \", \")" }
  }
}
```

Text (`label`) is `{token}` interpolation and is stored exactly as typed. An
expression (`digest`) is stored as the `{ dialect: 'cel', source }` envelope and
evaluated by the expression engine, so the CEL stdlib is available. A malformed
envelope shows the spec's refusal under the cell. The toggle appears only on maps
whose values the spec declares may be an expression; other key/value editors
(field values, headers, inputs) have none.

## Validate, simulate, inspect runs

The toolbar toggles four side panels:

| Panel | What it shows |
|---|---|
| **Variables** | The flow's declared variables |
| **Problems** | Structural + server validation issues, each clickable to reveal on canvas |
| **Debug** | A step-through **simulator** that walks the graph and highlights the active / visited nodes |
| **Runs** | Execution history for the published flow, fetched from the engine |

## See also

- [User-Scoped State Persistence](/docs/guide/user-state-persistence) — how the
  "Recently used" list is stored and synced.
- [Console App](/docs/guide/console) — the reference app that hosts the metadata
  admin and its designers.

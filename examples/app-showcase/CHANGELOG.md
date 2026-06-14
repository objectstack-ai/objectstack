# @objectstack/example-showcase

## 0.1.16

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
- Updated dependencies [08a11f7]
  - @objectstack/spec@9.5.0
  - @objectstack/cloud-connection@9.5.0
  - @objectstack/connector-rest@9.5.0
  - @objectstack/connector-slack@9.5.0
  - @objectstack/runtime@9.5.0

## 0.1.15

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/runtime@9.4.0
  - @objectstack/cloud-connection@9.4.0
  - @objectstack/connector-rest@9.4.0
  - @objectstack/connector-slack@9.4.0

## 0.1.14

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [998c4e4]
- Updated dependencies [b8e4232]
- Updated dependencies [9fea621]
- Updated dependencies [3786f15]
- Updated dependencies [8950204]
- Updated dependencies [9b4e870]
- Updated dependencies [17ffc74]
- Updated dependencies [c802327]
- Updated dependencies [b4765be]
- Updated dependencies [48051ff]
- Updated dependencies [d01c427]
  - @objectstack/spec@9.3.0
  - @objectstack/runtime@9.3.0
  - @objectstack/cloud-connection@9.3.0
  - @objectstack/connector-rest@9.3.0
  - @objectstack/connector-slack@9.3.0

## 0.1.13

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/connector-rest@9.2.0
  - @objectstack/connector-slack@9.2.0
  - @objectstack/runtime@9.2.0

## 0.1.12

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/connector-rest@9.1.0
  - @objectstack/connector-slack@9.1.0
  - @objectstack/runtime@9.1.0

## 0.1.11

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/connector-rest@9.0.1
  - @objectstack/connector-slack@9.0.1
  - @objectstack/runtime@9.0.1

## 0.1.10

### Patch Changes

- 4b0fdba: The showcase Chart Gallery now shows one widget per chart family the renderer
  draws DISTINCTLY (27 → 17 widgets). Families that fell back to a near-relative
  (grouped/stacked/bi-polar bars, stacked-area, step-line, spline, pyramid,
  bubble) and the dial-less performance variants (kpi/gauge/solid-gauge/bullet,
  identical to `metric`) were removed — advertising a type that renders as
  something else is misleading. Bundles the objectui console build that routes
  each widget to its true chart renderer (pie/donut/funnel/line/area/scatter/
  radar/treemap/sankey/table/pivot).
- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/connector-rest@9.0.0
  - @objectstack/connector-slack@9.0.0
  - @objectstack/runtime@9.0.0

## 0.1.9

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/runtime@8.0.1
- @objectstack/connector-rest@8.0.1
- @objectstack/connector-slack@8.0.1

## 0.1.8

### Patch Changes

- Updated dependencies [a46c017]
- Updated dependencies [f68be58]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [bc0d85b]
- Updated dependencies [2537e28]
- Updated dependencies [0ec7717]
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0
  - @objectstack/runtime@8.0.0
  - @objectstack/connector-rest@8.0.0
  - @objectstack/connector-slack@8.0.0

## 0.1.7

### Patch Changes

- Updated dependencies [ac1fc4c]
- Updated dependencies [ac1fc4c]
  - @objectstack/runtime@7.9.0
  - @objectstack/spec@7.9.0
  - @objectstack/connector-rest@7.9.0
  - @objectstack/connector-slack@7.9.0

## 0.1.6

### Patch Changes

- 6b60068: fix(cli): `objectstack dev` persists data by default (no more `:memory:` wipe on restart)

  `objectstack dev` historically fell back to a `:memory:` SQLite database when no `--database` / `OS_DATABASE_URL` was given, so **every restart silently wiped all data and AI-authored metadata** — you'd build an app, restart, and it would be gone, which makes local app-building unusable.

  `dev` now defaults to a persistent, project-anchored SQLite file at `<cwd>/.objectstack/data/dev.db` (gitignored, per-project). Existing opt-outs are unchanged and take precedence: `--fresh` (ephemeral temp DB), `--database <url>`, `OS_DATABASE_URL`/`DATABASE_URL`, or an explicit in-memory driver (`--database-driver memory` / `OS_DATABASE_DRIVER=memory`). Resolution is extracted into the testable `resolveDefaultDevDbUrl()` helper.

  The **app-showcase** example drops its explicit `:memory:` datasource override (which would otherwise route data back to memory and defeat the new default), so it persists across restarts out of the box.

- Updated dependencies [06f2bbb]
- Updated dependencies [a75823a]
- Updated dependencies [4fbb86a]
- Updated dependencies [e631f1e]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/runtime@7.8.0
  - @objectstack/connector-rest@7.8.0
  - @objectstack/connector-slack@7.8.0

## 0.1.5

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0
  - @objectstack/connector-rest@7.7.0
  - @objectstack/connector-slack@7.7.0
  - @objectstack/runtime@7.7.0

## 0.1.4

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [55866f5]
- Updated dependencies [8e539cc]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/runtime@7.6.0
  - @objectstack/connector-rest@7.6.0
  - @objectstack/connector-slack@7.6.0

## 0.1.3

### Patch Changes

- @objectstack/connector-rest@7.5.0
- @objectstack/connector-slack@7.5.0
- @objectstack/spec@7.5.0
- @objectstack/runtime@7.5.0

## 0.1.2

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/runtime@7.4.1
- @objectstack/connector-rest@7.4.1
- @objectstack/connector-slack@7.4.1

## 0.1.1

### Patch Changes

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [13632b1]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [394d34f]
- Updated dependencies [82eb6cf]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/runtime@7.4.0
  - @objectstack/connector-rest@7.4.0
  - @objectstack/connector-slack@7.4.0

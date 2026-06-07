# @objectstack/example-showcase

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

# create-objectstack

## 10.1.0

### Minor Changes

- 7cf283a: Make `os validate` the author-time verification gate and steer scaffolds toward it.

  - **`os validate`** now runs the same CEL/predicate gate as `os build`/`os compile`
    (ADR-0032): every `visible`/`disabled`/`requiredWhen`/validation/flow/sharing
    predicate is checked for CEL syntax and `record.<field>` existence on the target
    object. It already ran the protocol schema and widget-binding checks; the
    expression gate closes the gap so a bare field ref (`done` instead of
    `record.done`) — which silently hides an action on every record at runtime
    (#2183/#2185) — fails validation instead of shipping. `os validate` is now a
    read-only superset of the build's checks (no artifact emitted).
  - **`create-objectstack`** now emits an `AGENTS.md` (and `.github/copilot-instructions.md`)
    into every generated project instructing coding agents to run `npm run validate`
    after editing metadata, aligns the blank template's `dev`/`start` scripts with the
    example apps (`objectstack dev`/`objectstack start`), and sharpens the post-create
    "Next steps" output.

## 10.0.0

## 9.11.0

## 9.10.0

## 9.9.1

## 9.9.0

## 9.8.0

## 9.7.0

## 9.6.0

## 9.5.1

## 9.5.0

## 9.4.0

## 9.3.0

## 9.2.0

## 9.1.0

## 9.0.1

## 9.0.0

## 8.0.1

## 8.0.0

## 7.9.0

## 7.8.0

## 7.7.0

## 7.6.0

## 7.5.0

## 7.4.1

## 7.4.0

## 7.3.0

## 7.2.1

## 7.2.0

## 7.1.0

## 7.0.0

## 6.9.0

## 6.8.1

## 6.8.0

## 6.7.1

## 6.7.0

## 6.6.0

## 6.5.1

## 6.5.0

## 6.4.0

### Patch Changes

- 15fc484: Upgrade `@object-ui/*` packages to **v6.0**.

  - `@objectstack/cli`: `@object-ui/console` and `@object-ui/studio` from `^5.4.2` → `^6.0.0` — bundled Studio + Console assets now ship the v6 UI shell (new design language, refreshed sidebar, redesigned record header).
  - `@objectstack/account`: `@object-ui/i18n` from `^5.4.2` → `^6.0.0` — i18n runtime now matches the v6 console/studio API.
  - Root devDependency `@object-ui/console` from `^5.4.2` → `^6.0.0` so workspace scripts and the docs build pick up v6.
  - `create-objectstack`: `tar` from `^7.4.3` → `^7.5.15` (security + perf fixes when unpacking remote templates).

  **Heads-up for consumers:** `@object-ui/*` v6 is a major release of the bundled UI; pages rendered through the CLI's `studio` / `console` mounts may look different from v5. The protocol surface is unchanged.

## 6.3.0

## 6.2.0

## 6.1.1

## 6.1.0

## 6.0.0

## 5.2.0

## 5.1.0

## 5.0.0

## 4.2.0

## 4.1.1

## 4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release

## 4.0.4

## 4.0.3

## 4.0.2

## 4.0.0

## 3.3.1

## 3.3.0

## 3.2.9

## 3.2.8

## 3.2.7

## 3.2.6

## 3.2.5

## 3.2.4

## 3.2.3

## 3.2.2

## 3.2.1

## 3.2.0

## 3.1.1

## 3.1.0

## 3.0.11

## 3.0.10

## 3.0.9

## 3.0.8

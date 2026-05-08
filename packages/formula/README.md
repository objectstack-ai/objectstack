# @objectstack/formula

Canonical expression engine for ObjectStack.

- **Dialect: `cel`** — [Common Expression Language](https://github.com/google/cel-spec) via [`@marcbachmann/cel-js`](https://github.com/marcbachmann/cel-js). Used for formulas, predicates (`condition` / `criteria` / `visible`), and seed dynamic values.
- **Dialect: `js`** — sandboxed L2 hook bodies (delegated).
- **Dialect: `cron`** — job schedules (delegated).

See `content/docs/concepts/north-star.mdx` §8 "No private expression DSL" and `ROADMAP.md` M9.

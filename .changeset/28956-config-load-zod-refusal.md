---
'@objectstack/cli': patch
---

fix(cli): a `define*` helper that refuses its input while the config loads is reported as one located refusal (file, line, helper, path, the issue in words), not a raw JSON array

Clause-②: no — CLI output text only. No schema, export or accepted input changes; a refused config is refused with the same exit code as before.
Metadata-protocol: none

`defineView`, `defineAction` and the other strict helpers call `Schema.parse` and throw the `ZodError` as is. `os validate`, `os build`, `os lint`, `os dev` and `os serve` printed that error's message, which is its issues as a JSON array, with no file and no helper. The config module now loads through one seam that turns such an error into a refusal rendered by `formatZodError`:

```text
✗ src/views/ticket.view.ts:5:28 · defineView validation failed (1 issue):

  ✗ list.columns: Invalid input
    ✗ list.columns.0: Invalid input: expected string, received object
```

The file and line come from the evaluated bundle's source map. When the stack cannot tell which module threw, the refusal names the config entry and says so. The `--json` envelope's `error` carries the same text. Every other load failure (a syntax error, a missing import, a helper's own prose refusal, `defineStack`'s formatted refusal) is unchanged.

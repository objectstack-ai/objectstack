---
"@objectstack/spec": major
---

**BREAKING (theme):** retire the nine theme token groups that were emitted and read by nobody (#5021, ADR-0049 enforce-or-remove).

`ThemeSchema` declared a full design-token vocabulary — a type scale, a weight
scale, line-height and letter-spacing scales, a motion scale and a z-index scale.
objectui's theme engine turned every one of them into CSS custom properties,
faithfully and for years. What never existed was a **reader**: measured against
objectui `main` on 2026-08-04, `--font-size-*`, `--font-weight-*`,
`--line-height-*`, `--letter-spacing-*`, `--duration-*`, `--timing-*`, `--z-*`,
`--font-heading` and `--font-mono` have **zero** consumers across objectui's
components and stylesheets, while `--font-sans`, `--radius*`, `--shadow*` and the
colour variables come back live in the same run. So a declared type scale was
real CSS that styled nothing, and an overlay you "lifted" with `zIndex` still
stacked by document order.

This is why the earlier theme sweep (#3494) left them standing: its criterion was
*"the engine never emits it"*, and these are emitted. ADR-0049's criterion —
emitted, but consumed by nobody — is what reaches them.

FROM → TO:

| Removed | Replace with |
|---|---|
| `theme.typography.fontSize` | `theme.customVars: { "font-size-lg": "1.125rem" }` |
| `theme.typography.fontWeight` | `theme.customVars: { "font-weight-semibold": "600" }` |
| `theme.typography.lineHeight` | `theme.customVars: { "line-height-relaxed": "1.75" }` |
| `theme.typography.letterSpacing` | `theme.customVars: { "letter-spacing-wide": "0.025em" }` |
| `theme.typography.fontFamily.heading` | `theme.customVars: { "font-heading": "Georgia, serif" }` |
| `theme.typography.fontFamily.mono` | `theme.customVars: { "font-mono": "ui-monospace, monospace" }` |
| `theme.animation` | `theme.customVars: { "duration-fast": "150ms", "timing-ease": "ease" }` |
| `theme.zIndex` | `theme.customVars: { "z-modal": "1050" }` |

The one-line fix: **delete the key; re-declare under `customVars` only the
variables your own stylesheets actually read.** `customVars` emits each entry
verbatim as `--<key>: <value>`, so every retired variable is reproducible byte
for byte — no capability is lost. Run `os migrate meta --from 16` to strip the
keys automatically; it emits one notice per key so you can see what you were
declaring before deciding what to keep.

`colors`, `borderRadius`, `shadows` and `typography.fontFamily.base` have live
consumers and are **unchanged**.

The retirement kit:

- **Schema** — each key is a `retiredKey()` tombstone, so authoring one is both
  a `tsc` error (the input type is `never`) and a parse error carrying the
  prescription above. `AnimationSchema` and `ZIndexSchema` were deleted outright
  along with the `Animation` / `ZIndex` types: each had exactly one consumer —
  the key now tombstoned — and an exported schema with no consumer reads as a
  capability to whoever finds it (#3950).
- **Aliases** — the five that pointed at `animation`/`zIndex` and the seven that
  pointed into the retired typography scales were deleted with their targets
  rather than re-pointed. Keeping them would answer an author with *"did you mean
  `zIndex`?"* and then reject `zIndex` — a rename into a second rejection.
- **Migration** — `theme-inert-token-scales-removed` (ADR-0087 D2), wired into
  the protocol-17 chain step and retired from the load path, so a live parse
  rejects loudly and only `os migrate meta` rewrites sources. It **deletes** the
  keys rather than auto-populating `customVars`: a rewrite would hand back two
  dozen variables that still nothing reads, turning a dead semantic slot into a
  dead literal one.
- **Baselines** — `authorable-surface.json` gains eight `[RETIRED]` markers and
  loses the ten `ui/Animation:*` / `ui/ZIndex:*` lines under the #4650 deletion
  check's whole-def proof; `json-schema.manifest.json` drops the two defs.

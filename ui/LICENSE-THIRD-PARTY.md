# Third-Party Notices

ObjectUI redistributes a small amount of code from other open-source
projects. The following list tracks those components, their upstream
sources, and the licenses they ship under. All entries are MIT-compatible.

---

## Vercel AI Elements

- **Upstream:** <https://elements.ai-sdk.dev/> · <https://registry.ai-sdk.dev>
- **License:** MIT © Vercel, Inc.
- **Vendored into:** `packages/plugin-chatbot/src/elements/*.tsx`
- **Components:** `conversation`, `message`, `prompt-input`, `reasoning`,
  `tool`, `sources`, `suggestion`, `code-block`, `loader`, `shimmer`.
- **Local modifications:**
  - Import paths rewritten from `@/components/ui/*` / `@/lib/utils` /
    `@/registry/new-york-v4/ui/*` → `@object-ui/components`.
  - `Slot.Root` (Radix v2 umbrella) normalised to the v1 `Slot` import.
  - `Array.prototype.at(-1)` replaced with index access for ES2020 lib
    compatibility.
  - Size variant `icon-sm` swapped for `icon` on plain `Button` consumers.
- **Re-sync command:** fetch from `https://registry.ai-sdk.dev/<name>.json`,
  copy the `files[].content` payloads, re-apply the import rewrites above.

## shadcn/ui

- **Upstream:** <https://ui.shadcn.com> · <https://github.com/shadcn-ui/ui>
- **License:** MIT © shadcn.
- **Vendored into:** `packages/plugin-chatbot/src/elements/ui/`
  - `button-group.tsx`
  - `input-group.tsx`
- **Rationale:** these two primitives are not yet shipped under
  `packages/components/src/ui/` but are required by the AI Elements layer.
- **Local modifications:** import path rewrites only (see above).

## github-slugger

- **Upstream:** <https://github.com/Flet/github-slugger>
- **License:** ISC (c) Dan Flettre. MIT-compatible.
- **Vendored into:** `scripts/github-slug.mjs`
- **What:** the generated character table `slug()` strips, plus the `slug()` and
  duplicate-suffix (`-1`/`-2`) logic built on it.
- **Rationale:** `scripts/check-doc-links.mjs` resolves heading anchors, so it
  needs the exact rule both renderers use — and it is one of the gates a
  workflow runs BEFORE `pnpm install`, so it may not import a package. The
  table is copied rather than re-derived because a Unicode property escape is
  not equivalent to it; the vendored file's header has the measurement.
- **Local modifications:** ESM export shape only — the class is a named export
  and drops the unused `maintainCase` / `reset()` surface. The character table
  is byte-for-byte upstream.
- **Re-sync command:** copy the `regex` export out of the installed
  `github-slugger/regex.js` (already a dependency of `@object-ui/plugin-markdown`
  and of `fumadocs-core`), then run
  `pnpm exec vitest run scripts/__tests__/check-doc-links.test.ts` — it pins this
  copy against the real package over every code point.

---

If you add another upstream-sourced file under `packages/`, append it to this
list with the same shape: upstream link, license, files affected, and any
local edits. The same applies to repo tooling under `scripts/`.

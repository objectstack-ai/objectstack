---
'@objectstack/cli': patch
---

fix(cli): `os validate` / `os build` / `os lint` now say when the JSX page gate ran at parse level only, and refuse a project `sdui.manifest.json` they cannot use (#20113)

Clause-②: no

The gate that checks `kind: 'html'` pages (and the deprecated `kind: 'jsx'`) validates components and props only when an SDUI component manifest resolves: the project's `sdui.manifest.json` in the working directory, then the copy inside `@objectstack/console`. With neither, it falls back to parse-level checking (syntax, tag matching, forbidden constructs). All three commands used to do that silently and report success, so "passed" read as "components and props checked" when they were not.

A page "to check" below means one the gate actually judges, wherever it is declared: at the top level of the stack, or inside a `packages[]` entry. The per-package pass judges those even when the top level carries its own `pages` key.

- **No manifest, `kind: 'html'` pages to check: a notice, exit status unchanged.** Each command reports one notice, tagged `sdui/jsx-parse-level-only`. It gives the number of distinct pages checked at parse level only, top-level and package-carried alike, and names every place a manifest was looked for. `os validate` and `os build` print it as an info line plus a hint line; `os lint` lists it under Suggestions. `--json` carries it in the channel each command already publishes. It is an `info` record (the author-time finding shape) at the end of `warnings` on `os validate` / `os build`, and a `suggestion` in `os lint`'s `issues`, which also moves that run's `total` and `suggestions` counts by one. No top-level key is added. `--strict` does not promote it on any command, so a project without its own manifest exits exactly as before.
- **A project `sdui.manifest.json` that exists but cannot be used: refused (exit 1).** This applies when there is a `kind: 'html'` page to check, top-level or package-carried, and the file cannot be read, is not valid JSON, or is not a JSON object with a `components` map. The file and the reason are named on stderr and in the `--json` envelope's `error`. Before, invalid JSON, `null` and an unreadable file were ignored in silence (parse-level checking, exit 0), while `{}` or an array crashed the run with `Cannot convert undefined or null to object` (exit 1). **Fix:** correct the file, or remove it to check those pages at parse level only.
- **Unchanged:** a project with no `kind: 'html'` page to check, at the top level or in any package, says nothing and refuses nothing, whatever its manifest looks like. A resolvable manifest arms full validation exactly as before. `os init`'s scaffold check reads the manifest as it did.

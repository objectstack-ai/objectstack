---
"@objectstack/types": minor
---

fix(types): load a declared ESM-only host package through `createHostImporter`, and split its failure kind (#14041)

The declared leg's finder is `hostRequire.resolve(pkg)` — a **CommonJS**
resolution. A host-app package publishing only an `import` condition
(`{"exports": {".": {"import": "./dist/index.js"}}}`, ordinary for pure-ESM
publishes outside this workspace) made that resolve throw
`ERR_PACKAGE_PATH_NOT_EXPORTED`, and the leg classified **every** resolver
throw as `declared-unresolvable`: the load hard-failed, worded as an INSTALL
problem — `pnpm install`, un-prune, rebuild — about an install that was fine.
Nothing the message prescribed could help.

**The finder.** When — and only when — `hostRequire.resolve` throws, the leg
now consults exactly one directory: `<hostRoot>/node_modules/<name>` (name
verified against the package's own manifest, then realpath'd, so its
transitive imports resolve from its real location exactly as on the succeeding
path). If that package's `exports` names an existing `import`-condition target
for the requested subpath, it is imported. The fallback is **strictly
tighter** than the CJS resolution it backs up — no `NODE_PATH`, no walk above
`hostRoot`, no bare `require` — so it cannot reopen the #4719 declaration-gate
hole: a package reachable only through a hoisted store or a parent directory
stays refused, even though CJS resolution can see it there. And because it
runs only inside a catch that was a hard failure before, no
currently-succeeding load changes behaviour.

**The split.** When the fallback cannot help either, the failure kind is
decided by whether any install action could: a package absent from the host's
`node_modules`, or one whose manifest names a runtime target whose file is
missing (a dist never built, a partial publish), keeps `declared-unresolvable`
and the existing INSTALL wording — it is right for both. A package that is
installed and whose manifest names **no** runtime entry for the subpath under
either the `require` or the `import` conditions (a `types`-only or
`browser`-only publish, an unexported subpath) now fails as the new
`HostImportFailureKind` value **`declared-no-loadable-entry`**, with a message
about the package's own published shape — the remedy lives in the package,
and an operator is no longer sent to re-run `pnpm install` against a correct
install. The new error still carries `code: 'MODULE_NOT_FOUND'`, so every
existing caller's missing-vs-crashed classification is unchanged, and an
evaluation crash still propagates untouched with no kind.

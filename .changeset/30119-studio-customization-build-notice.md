---
'@objectstack/cli': patch
'create-objectstack': patch
---

feat(cli,create-objectstack): `os build` says when the local dev database holds Studio customizations the artifact leaves behind; the starter's `AGENTS.md` and README say a Studio change lives in the database and name `os package export`

Clause-②: no
Metadata-protocol: none

- **`@objectstack/cli`: `os build`** ends, on its text face, with one notice when the SQLite database `os dev` opens for the project (the same resolution, over the project's development `.env*` files) holds items of a `<base>.custom` package: how many, in which pair, the database file, and that `os package export` takes them out while `os dev` runs. A change saved in Studio is such an item (ADR-0146 D2), never part of `src/`, so neither the artifact nor the starter's `Dockerfile` carries it. The read is local and read-only; a database that is not a local SQLite file is not probed and prints nothing, and a file that cannot be read is said to be unchecked, never empty. `os compile`, which `os dev` runs on every boot and rebuild, and `os build --json` print nothing new.
- **`create-objectstack`: the generated `AGENTS.md` and the blank starter's README** say that Studio saves into the environment's database as an item of `<package id>.custom`, that `build` and the `Dockerfile` leave it behind, that app changes are made in `src/`, and how a customization moves as a package (`os login`, `os package export`, then `os package install` on the deployment, in the numbered order).

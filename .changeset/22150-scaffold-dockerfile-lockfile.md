---
"create-objectstack": patch
---

fix(create-objectstack): the scaffolded Dockerfile installs from the lockfile the project carries

Clause-②: no

Where pnpm is on PATH, `create-objectstack` installs with pnpm and the project gets `pnpm-lock.yaml` and no `package-lock.json`. The `Dockerfile` it wrote copied `package*.json` and ran `npm ci`, so `docker build` stopped with `EUSAGE` before `os build` ran.

- The build stage now copies `package.json` and whichever of `pnpm-lock.yaml`, `pnpm-workspace.yaml` and `package-lock.json` exist, then installs from the lockfile: `corepack pnpm@10 install --frozen-lockfile` for `pnpm-lock.yaml`, `npm ci` for `package-lock.json`. With neither, the build stops and says to install once and commit the lockfile.
- pnpm is pinned to major 10, the major the template's `.github/workflows/ci.yml` installs with. An unpinned Corepack takes the registry's newest pnpm, which the Corepack bundled with Node 22 could not run when this was measured.
- Unchanged: `os build` in the image, the runtime stage and its pinned image tag.
- A project scaffolded before this release keeps its own `Dockerfile`. To fix one, replace its `COPY package*.json ./` and `RUN npm ci` lines with the build stage shown in the self-hosting guide.

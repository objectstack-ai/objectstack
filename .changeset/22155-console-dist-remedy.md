---
'@objectstack/cli': patch
---

fix(cli): the "Console dist not found" boot warning names the remedy that works where the server runs (#22155)

When the Console package the server resolves has no built `dist/`, the boot warning used to say `install @object-ui/console (already built) or run pnpm --filter @object-ui/console build in the objectui workspace`, wherever it ran. Neither remedy worked. The resolver never reads `@object-ui/console`, and in the framework repository the Console is built by a root script.

The warning now names one remedy. It picks it by asking whether the nearest `package.json` above the resolved console package declares an `objectui:build` script:

- **In the framework repository** (the root manifest declares it), the warning gives the dist path, says that `pnpm build` does not produce it, and names `pnpm objectui:build` with the directory to run it in.
- **Anywhere else**, such as a project that installed `@objectstack/cli`, the warning gives the dist path and says the Console ships prebuilt in `@objectstack/console`, a dependency of `@objectstack/cli`. The remedy is to reinstall that package at the CLI's version.

Only the text changes. The Console mounts, or is skipped, exactly as before.

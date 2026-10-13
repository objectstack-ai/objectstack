---
'@objectstack/cli': patch
---

fix(cli): with no built Console, `/_console/` says the Console is not built and names the remedy, instead of answering a bare 404 (#22225)

Clause-②: no

When the Console package `os serve` resolves has no built `dist/`, the server printed the "Console dist not found" boot warning and mounted nothing. `GET /_console/` then answered the router's `ENDPOINT_NOT_FOUND` and `GET /` an empty 404, which look exactly like a wrong URL.

Now, on that boot, the server mounts the Console's not-built answer on the routes the Console would own:

- **`GET /_console/` and every path under it** answer `503` with a short plain-text body. It says the Console is not built, then gives the remedy the boot warning names: `pnpm objectui:build` in a framework checkout, or reinstalling `@objectstack/cli`'s `@objectstack/console` dependency elsewhere. The same function picks the remedy for both. The HTTP form leaves out the absolute paths on the host, which only the terminal shows.
- **`GET /` and `GET /_console`** redirect to `/_console/`, as they do when the Console is built.

A built Console is served exactly as before, and `--no-ui` / `--no-console` still mount nothing. The `--ui` flag's help text and the README row now name `@objectstack/console`, the package the resolver reads, instead of `@object-ui/console`.

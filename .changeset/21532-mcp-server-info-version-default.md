---
'@objectstack/mcp': patch
---

The MCP server's `serverInfo.version` is the package version unless you set one, as `MCPServerPluginOptions.version` always documented ("Defaults to package version") (#21532).

Clause-②: no

- Before, `MCPServerPlugin` and `MCPServerRuntime` each defaulted to the literal `1.0.0`, so every deployment built without the option, `os serve`'s auto-registration included, answered `initialize` with `serverInfo.version` `1.0.0` whatever the installed `@objectstack/mcp` was. Both defaults now read the version from the package's own `package.json`, ESM and CJS alike.
- An explicit `version` option (`MCPServerPluginOptions.version`, `MCPServerRuntimeConfig.version`) is still answered as given.
- `new MCPServerPlugin().version`, the kernel plugin's own version, is the package version too, where it was `1.0.0`. Its declared type is now `string | undefined`: if the manifest cannot be read (a bundle with no `package.json` beside it), `serverInfo.version` says `unknown` and the plugin's own `version` is left unset, which both kernels accept, instead of a placeholder they would refuse.
- Pass `version` yourself to keep reporting a fixed string.

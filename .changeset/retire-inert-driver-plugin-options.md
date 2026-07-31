---
"@objectstack/runtime": major
"@objectstack/cli": patch
---

feat(runtime)!: retire the inert `DriverPluginOptions` — `DriverPlugin` takes `(driver, driverName?)` (#4320)

`new DriverPlugin(driver, { datasourceName, registerAsDefault })` never did
what it promised: both options configured a datasource-registration block in
`start()` gated on `metadata.addDatasource`, a method **no metadata service
implements** — so the block early-returned on every boot since inception and
the options were dead weight (found while typing service lookups for #4251).

**Migration** — delete the options argument; nothing changes at runtime
because nothing ever happened:

- FROM `new DriverPlugin(driver, { datasourceName: 'x', registerAsDefault: false })`
  TO `new DriverPlugin(driver)`
- FROM `new DriverPlugin(driver, 'name', options)` TO `new DriverPlugin(driver, 'name')`
- The string second argument (`new DriverPlugin(driver, 'memory')`) is unchanged.

If you passed `datasourceName` expecting routing to a named auxiliary driver:
that routing never came from the option. It keys off the **driver name** —
`DriverPlugin.init()` registers `driver.<name>`, ObjectQL's discovery loop
adopts it, and the engine's lifecycle/datasource resolution looks the name up
(see the telemetry provision in `os serve` for the pattern: stamp
`driver.name`, register the plugin, done). For Setup → Datasources visibility,
declare the datasource through `DatasourceConnectionService` /
`registerInMemory('datasource', …)` (ADR-0062).

The `DriverPluginOptions` interface was module-local (never exported from the
package root), so the only public break is the constructor's second/third
argument shape.

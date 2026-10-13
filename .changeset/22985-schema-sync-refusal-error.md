---
'@objectstack/service-messaging': patch
'@objectstack/service-datasource': patch
'@objectstack/metadata-protocol': patch
---

fix: a refused on-demand schema sync (`syncObjectSchema`) is logged at `error`, naming what was not created and how to fix it (#22985)

Three places create an object's storage after the boot's own schema sync has run. When the driver refused that DDL, each of them logged a `warn` and carried on, so the deployment looked healthy while a table did not exist. Each now logs one `error` line that says what was not created, that nothing else will look wrong, and what fixes it. The driver's refusal is kept out of the line itself. Nothing else changes: the boot, the connect and the publish still complete as before.

- **`@objectstack/service-messaging`**: boot-time provisioning of the eight notification tables. A refused table logs `[messaging] could not provision <table> storage — its storage was NOT created. …` at `error`, once per table per boot, with the refusal in the record's meta. The fix it names: resolve the refusal, then restart or run `os migrate apply`. This used to be a `warn`. Under `skipSchemaSync` / `OS_SKIP_SCHEMA_SYNC=1` the provisioning still issues no DDL, so this line cannot appear.
- **`@objectstack/service-datasource`**: connecting a declared datasource re-runs the schema sync of every object bound to it. A refused object logs `datasource '<name>': object '<object>' has NO working storage here — …` at `error`, once per object per connect, with the refusal in meta. On a logger that has no `error`, the same line is logged at `warn`. The fix it names: resolve the refusal, then restart. This used to be a `warn` reading `syncObjectSchema('<object>') failed`.
- **`@objectstack/metadata-protocol`**: publishing an object whose storage sync is refused logs `[Protocol] object '<name>' was published but its storage was NOT created or altered — …` with `console.error`. The driver's refusal is the second argument. The fix it names: resolve the refusal, then publish the object again or restart. The publish still answers success. This replaces the `console.warn` line `[Protocol] table sync failed for object '<name>': …`, so a log search for that text now finds nothing.

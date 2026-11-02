---
'@objectstack/spec': minor
'@objectstack/objectql': minor
'@objectstack/metadata-protocol': minor
---

feat(spec): a record page can name the apps whose routes open it for its object (`PageSchema.apps`)

Clause-②: yes (widening)
Metadata-protocol: added

An app could not make its own record page over a platform object the page its routes open: the deployment's one `isDefault` record page (for `sys_user`, plugin-auth's `sys_user_detail`) opened everywhere, and declaring a second default is refused. A record page now takes an optional app scope:

```ts
definePage({
  name: 'duly_member',
  label: 'Member',
  type: 'record',
  object: 'sys_user',
  apps: ['duly'],
  regions: [/* … */],
});
```

- **What it means.** Inside an app `apps` names, the object's record view (`/apps/APP/OBJECT/record/ID`) opens this page. Everywhere else, Setup included, the object's one `isDefault` record page still opens. One default per object per deployment is unchanged, and there is no precedence ladder: the default and an app's page are two slots, and one page may hold both.
- **One page per object per app.** Two record pages for the same object that both name the same app are refused at the doors that refuse a second default, naming both pages and the app: `defineStack` (and so `os validate` / `os build`) and `composeStacks` with `STACK_CROSS_REFERENCE_INVALID`, and package registration and the metadata save door with `DEFAULT_RECORD_PAGE_CONFLICT` (422). Saving a page under its own name stays an overlay of that page, as for the default.
- **Where it is accepted.** Only on a record page bound to an `object`, where `isDefault` is: on any other page `apps` is refused, by the page parse and at package registration, in one sentence. Entries are app names (lowercase snake_case), at least one, each once.
- **Declared ahead of the console.** The console's page assignment reads the route's app in a follow-up; until then every app still opens the default record page, exactly as before the key existed.
- **Readers.** `defaultRecordPageObject(page, app)` (`@objectstack/spec/ui`) answers the object a page is the record page of inside `app`; `SchemaRegistry.defaultRecordPageHoldersOf(object, app)` answers the holders of that slot; a `DefaultRecordPageConflictError` conflict and the save door's refusal carry `app` when the slot is an app's.

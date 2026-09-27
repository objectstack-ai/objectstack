---
"@objectstack/lint": patch
---

fix(lint): `action-name-undefined` now resolves the `record:alert` call-to-action and the `page:header` action ids (#20105)

`action-name-undefined` is the authoring gate for "a surface names an action that no action in the stack defines". It already walked list-view row/bulk menus, the `record:quick_actions` bar (`properties.actionNames`) and app navigation, but two page surfaces that bind an action by id were never read:

- `record:alert` → `properties.action.actionName` (the banner's call-to-action button);
- `page:header` → `properties.actions` (the header's action ids).

Both renderers resolve the id against the object's declared actions and draw nothing when it resolves nowhere: the alert keeps its banner and silently loses its button, and the header renders one button fewer with only a browser-console warning. The spec types both as plain strings, so a misspelled id passed spec validation and lint and vanished at runtime.

The rule now walks both keys, each scoped to its component type (`element:button`'s `action` is an inline definition and `record:related_list` declares its own `actions`, so neither is read), and resolves them exactly as it resolves `actionNames`: against every action defined in the stack, global or object-embedded, with the same did-you-mean. A `page:header` array's inline-object elements are skipped (the spec refuses them on its own; they are definitions, not references), and every id is reported at its authored index. Each finding says what the author will actually see — a banner with no button, a header with no button — and the hint names the placement each surface needs: none for the alert, which runs its call-to-action by name, and `record_header` or `record_more` in `locations` for the header.

**What moves for consumers.** A stack whose `record:alert` or `page:header` names an undefined action built clean before and now fails `os validate` / `os lint` / `os build` with `action-name-undefined` (severity `error`). That id never rendered a button, so nothing that worked stops working. The rule still does not run at the runtime publish door for `page` writes. A stack whose ids all resolve is unaffected: measured on the platform's own `sys_user` page, whose `resend_verification_email` call-to-action resolves clean.

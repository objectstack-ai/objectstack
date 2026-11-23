---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@objectstack/spec': patch
---

feat(studio): design an object's public forms under the object, in Studio's Form tab

Clause-②: yes (widening) — new Studio language-pack keys (`engine.studio.data.form.surface*` and the `engine.studio.publicForms.*` block) in en and zh
Metadata-protocol: none

Studio → Data → an object → Form now switches between the **Record form** (the New and Edit dialogs' layout, as before) and the object's **Public forms**, the forms anyone can fill in without signing in, each submission a record of the object. No new tab: the Data pillar keeps its seven.

The designer lists the object's public forms (published ones, and ones only drafted) and:

- creates one (a title and an address; it starts with the fields the object requires) and deletes one;
- picks its fields from the object's fillable ones only: never a hidden, read-only, system, formula, roll-up or auto-number field;
- reorders fields by dragging (or the move buttons), marks them required, and groups them into named sections;
- sets the title, the description, the after-submit heading and message (`submitBehavior: { kind: 'thank-you' }`) and the address;
- shows the form live as it is edited.

Two refusals, each with its reason on screen:

- **A field the object requires** cannot be removed and is always required on the form. "Requires" means required with no default value and no default choice: a field the write path fills in, such as a status with `defaultValue`, is not held.
- **An address another form already uses** is refused, switched-off forms included, and nothing is saved.

Saves follow Studio's draft → publish path: Save draft writes the form's draft, and Publish puts it live.

- A form of a writable package is saved in that package.
- On an installed app, a form the app ships is saved as a declared override in the app's customization package (ADR-0146), never in the app. A new form goes into the customization package.
- A form the app ships cannot be deleted; the designer says to switch it off in Setup → Public forms instead.

Switching a form on or off stays Setup's. The stored shape is the form view item it always was (`viewKind: 'form'`, `config.sharing`); no key is added. Access restrictions (password, expiry, domains) are not offered.

Setup → Public forms names a form by the same rule: its label, else its title, else its first section's label, else its key.

New locale keys: `engine.studio.data.form.surface*` and `engine.studio.publicForms.*` in the studio catalogue (en, zh).

Alongside, from the review of the Setup page (#36697):

- The designer's list reads an installed app's forms the way Setup → Public forms does: a form its app ships switched off (withdrawn by the app's own document, which no customization re-opens) is listed as "Off (its app ships it off)", never On, and a form whose app document cannot be read as "Unknown".
- On Setup → Public forms, a row whose status is unknown offers no switch; Refresh reads it again.
- `anonymousFormIntakeWithdrawnIn`'s docblock (`@objectstack/spec/ui`) names its callers as they are: the anonymous form doors, the v18 organization-ownership migration and the console's Setup → Public forms page. It no longer names an organization-scoped write door that does not call it. Prose only; the function is unchanged.

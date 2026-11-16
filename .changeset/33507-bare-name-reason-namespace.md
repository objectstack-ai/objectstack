---
'@objectstack/objectql': patch
---

fix(objectql): the bare-name refusal and cold-boot warning say a narrowed type holds one name per namespace

Clause-②: no
Metadata-protocol: none

The reason a `Bare-name conflict` refusal and the `Bare-name conflict at boot` warning carry (`bareNameReason`) said, for every covered type, that it "holds one name per deployment ... with no package to tell two definitions apart, so with two holders every caller is served the same one, chosen by registration order". Every covered type (picklist, mapping, dataset, API, object-less action, function, flow, webhook, connector, email template, agent, skill, tool) has since narrowed to the namespace (ADR-0150 D2/D9, `NAMESPACE_SCOPED_BARE_NAME_TYPES`), so an administrator refused for one of them was told a rule the doors no longer apply. The reason for a narrowed type now states its rule: a package of another namespace may ship the same name, but within one namespace, or beside a package that declares no namespace, a name has one holder, and a bare name two holders share is refused naming both. For an email template the reason also names the two holdings that still meet whatever the namespaces, after "save the exceptions below": a name the platform requests by its bare spelling (the `auth.*` mails, such as `auth.password_reset`) keeps one holder per deployment, and a package that depends on the name's holder (which does not depend on it back) and ships the name only in locales the holder does not ship is refused as an addition to the holder's email template, as before. A type that joins the covered list before its own narrowing keeps the one-name-per-deployment sentence. No rule changes: the refusals fire where they did, with the same `NAMESPACE_CONFLICT` code and `422` status.

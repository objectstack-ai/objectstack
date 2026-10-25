---
'@objectstack/spec': minor
'@objectstack/lint': minor
---

feat(spec): a `notify` recipient form that is the address in an `email`-typed field of the triggering record

A `notify` node's `recipients` takes a fourth form, as the whole value: `{ emailField: 'applicant_email' }`. It names an `email`-typed field of the record that triggered the flow, and the address that field holds is the recipient — for a person who is not a user, such as an applicant who came in through a public form. The field is named by its machine name, so neither an address written out nor an expression that builds one can parse as this form: a string in `recipients` stays a user id or an audience selector, and an envelope stays a CEL value.

```ts
{
  type: 'notify',
  config: {
    recipients: { emailField: 'contact_email' },
    channels: 'email',
    template: 'supplier.application_received',
  },
}
```

- The node names `email` as its only channel (`channels: 'email'` or `['email']`). An address that no user holds has no inbox, so a node with no `channels`, or one naming any other channel, is refused.
- The form is the whole `recipients` value, never a list entry.
- `@objectstack/lint` refuses, at `os validate`, `os lint`, `os build` and the runtime publish door for a flow, an email-field recipient whose field the trigger object does not declare (`notify-email-field-unknown`), one whose field is not `email`-typed (`notify-email-field-not-email`), and one in a flow that hands its run no record of a known object — a schedule, an inbound api call, a record trigger that names no object (`notify-email-field-no-trigger-record`). A trigger object another package declares is not judged.

This change is the protocol half. Delivery — resolving the field to an address, the outbound mail configuration, the per-address rate limit and the messaging-log entry — is the runtime half, and it ships in this same release in the `notify` node of `@objectstack/service-automation`.

Clause-②: yes (widening)

Metadata-protocol: added

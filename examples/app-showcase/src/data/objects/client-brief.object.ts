// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * Client Brief — the showcase's SHARE-LINK object (ADR-0047 / ADR-0111 D8).
 *
 * A client-facing summary of a project that a Client Liaison publishes by
 * opaque capability token ("anyone with the link"), Notion/Figma style. It is
 * the app's demonstration of `publicSharing`, and it was added because the
 * showcase had NO demonstration of it at all: verified across
 * `examples/app-showcase/src`, not one object opted in, so
 * `POST /api/v1/share-links` answered 422 `SHARING_NOT_ENABLED` for every
 * showcase object and every downstream behaviour of the feature — redaction,
 * the password and audience gates, fail-closed revoke/expiry — was unreachable
 * on stock fixtures (#9308 fixture 2).
 *
 * ## `publicSharing` is a DIFFERENT AXIS from `sharingModel`
 *
 * `sharingModel` (here `public_read`) governs PRINCIPAL-based access: which
 * signed-in members may read the row, and who may write it (the owner). The
 * `publicSharing` block below governs LINK-based access: whether a capability
 * token may be minted for the row at all, which audiences and permissions the
 * minter may select, how far out an expiry may be set, and which fields are
 * stripped before anything leaves the server through a token. The two do not
 * constrain each other, which is exactly why an object must opt into link
 * sharing explicitly — a widely-readable object is not thereby publishable to
 * the anonymous internet.
 *
 * ## Both directions of every declared key are demonstrable on the seed
 *
 * A policy whose keys fail OPEN when dropped (see the `publicSharing` history
 * note in `object.zod.ts`) is worth seeding so that it can be FALSIFIED, not
 * merely observed:
 *
 *   • `redactFields` — `internal_notes` and `deal_value` carry the numbers and
 *     the candour a client must never see, while `title` / `summary` /
 *     `project` are the client-facing half. A resolve that returns either
 *     redacted field is a defect with an obvious name.
 *   • `eligibility` — only a `published` brief may be shared. The seed carries
 *     a `draft` one on purpose, so the refusal (422 `RECORD_NOT_ELIGIBLE`,
 *     #7861) is demonstrable on stock data rather than only its acceptance.
 *   • `maxExpiryDays` — a link asked to outlive 30 days is rejected.
 *
 * ## Why the internal fields live HERE rather than on `showcase_project`
 *
 * Redaction is per-OBJECT, so the fields a link must not carry have to be on
 * the shared object. Hanging them off the brief (rather than sharing a project
 * row directly) also keeps the fixture from touching `showcase_project`, whose
 * OWD and field set sit upstream of a large part of the dogfood gate.
 */
export const ClientBrief = ObjectSchema.create({
  name: 'showcase_client_brief',
  label: 'Client Brief',
  pluralLabel: 'Client Briefs',
  icon: 'share-2',
  description:
    'A client-facing project brief published by opaque share link — the showcase\'s `publicSharing` demonstration (ADR-0047).',

  // Principal-based access: every member with the object bit reads every
  // brief; only the owner writes it. Deliberately NOT the link axis below.
  sharingModel: 'public_read',

  fields: {
    title: Field.text({ label: 'Title', required: true, searchable: true, maxLength: 160 }),
    summary: Field.text({ label: 'Client Summary', maxLength: 2000 }),
    project: Field.lookup('showcase_project', { label: 'Project' }),
    status: Field.select({
      label: 'Status',
      options: [
        { label: 'Draft', value: 'draft', default: true, color: '#94A3B8' },
        { label: 'Published', value: 'published', color: '#10B981' },
      ],
    }),
    // ── The redacted half ────────────────────────────────────────────────
    // Never served through a share token (see `redactFields` below). Ordinary
    // API access by an entitled member is unaffected — redaction applies only
    // when the request principal is `kind:'share-link'`.
    internal_notes: Field.text({ label: 'Internal Notes', maxLength: 2000 }),
    deal_value: Field.currency({ label: 'Deal Value', scale: 2, min: 0 }),
    // Owner anchor — auto-stamped on insert; the `public_read` OWD reads it to
    // decide who may WRITE the row.
    owner_id: Field.lookup('sys_user', { label: 'Owner' }),
  },

  // ── The link axis (ADR-0047) ───────────────────────────────────────────
  publicSharing: {
    enabled: true,
    // Every audience this item's runner drives, and no more. `public` (search
    // engines may index, no token check) is deliberately absent: nothing in
    // this app wants an un-tokened surface, and an audience the platform will
    // accept is an audience someone can select.
    allowedAudiences: ['link_only', 'signed_in', 'email'],
    // Read-only links. `comment` / `edit` would hand a token holder write
    // authority over a row whose owner never approved it.
    allowedPermissions: ['view'],
    maxExpiryDays: 30,
    redactFields: ['internal_notes', 'deal_value'],
    // [#7861] Evaluated against the candidate record at mint time — a draft
    // brief cannot be published by link, whatever the caller holds.
    eligibility: "record.status == 'published'",
  },
});

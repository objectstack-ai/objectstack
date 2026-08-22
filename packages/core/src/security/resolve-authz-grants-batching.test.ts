// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#10825] Round-trip batching of `resolveUserAuthzGrants` — the EQUIVALENCE
// control, not a smoke test.
//
// ## What this file is
//
// `resolveUserAuthzGrants` used to issue its reads one awaited call at a time.
// Five of them share a property: their `where` is built entirely out of the two
// INPUTS (`userId`, `tenantId`), so not one of them feeds another's filter and
// nothing but the `await` kept them apart. They now go out in a single wave.
//
// The change is worth measuring because a round trip — not a query — is what
// multiplies request latency (cloud#1539 established this causally by latency
// injection, R² = 0.9994: `server_ms ~= 33 + L x 36.6`). It is worth PROVING
// because this is the authorization path: a batched read that quietly returns a
// different row set does not fail, it grants differently, and every functional
// suite in the repo stays green while it does.
//
// ## Why the assertions are shaped the way they are
//
// "The suite still passes" is worth nothing here, and so is "the query count
// went down" (it did not — see below). The two facts that can fail SILENTLY are:
//
//   1. the resolved grants stop matching the sequential resolver's, and
//   2. the queries stop being the same queries.
//
// So both are pinned against GOLDENS CAPTURED FROM THE PRE-BATCH RESOLVER —
// literally run, not reasoned about — at `926778bce01620ae56a9b0eecbf0400c43a64aa8`
// (the merge-base of the branch that batched it). Every `GOLDEN` entry below is
// output, not intention: the full `UserAuthzGrants` envelope with ARRAY ORDER
// INTACT (`positions` and `permissions` are order-sensitive downstream —
// `platform_admin` leads, caller seeds precede resolved set names), and the full
// query log as `{ object, where, limit, context }` tuples.
//
// This is a PRESERVED-BEHAVIOUR control: its subject (the sequential resolution)
// existed before the change, so it is falsified by MUTATING THE BATCH — drop the
// `organization_id` filter from the fellow-org read, fold the two `sys_member`
// reads into one, widen a `$in` — each of which reddens it. A control that
// survives those mutations is not measuring equivalence and must be repaired
// before it is trusted.
//
// ## What "legs" means here, and how it is measured
//
// A LEG is a sequential round trip, not a query: three queries issued together
// and awaited as one wave are ONE leg; three awaited in turn are three. The
// probe below measures it directly rather than inferring it from a count — a leg
// opens when a query is issued while nothing is in flight, so a `Promise.all`
// wave lands in one bucket and an awaited-in-turn read opens its own.
//
// Measured, fully-populated principal (`position-derived-grants`):
//
//     legs     8  ->  4        queries    8  ->  8
//
// The query count is deliberately UNCHANGED. Nothing was merged and nothing was
// deleted: legs 9 and 13 duplicate reads made earlier in the request, and
// removing either belongs to a different card (#10757 directions 1/2), so they
// are batched here, not dropped. Four legs is the FLOOR for this data model, not
// a half-finished job — legs 2-4 are a foreign-key chain (position NAMES ->
// `sys_position.id` -> `sys_position_permission_set.permission_set_id` ->
// `sys_permission_set`) in which each filter is the previous read's output. See
// the LEGS 2-4 note in `resolve-authz-context.ts` for why collapsing it further
// would need either a `packages/spec` denormalisation or a driver-side join a
// caller-supplied `ql` double may silently ignore.
//
// ## The probe honours `limit`, on purpose
//
// The `makeQl` double used elsewhere in this suite ignores `limit`, which would
// make the single most tempting "optimisation" here — folding the two
// `sys_member` reads (`{user_id}` limit 200 and `{organization_id}` limit 1000)
// into one query — look free. It is not: `fellow-org-over-200-members` below
// carries 251 peers, and under a folded 200-row read `org_user_ids` silently
// loses 51 collaborators, which is an RLS scope change wearing a green suite.

import { describe, it, expect } from 'vitest';
import { resolveUserAuthzGrants } from './resolve-authz-context.js';

type Tables = Record<string, any[]>;
interface QueryTuple { object: string; where: any; limit: any; context: any }
interface GoldenEntry {
  grants: any;
  queries: QueryTuple[];
  /** Round trips the PRE-BATCH resolver made for this fixture. */
  seqLegs: number;
  /** Queries the PRE-BATCH resolver made — the batched path must match it. */
  seqQueries: number;
  /** The batched wave shape: one inner array per round trip, in order. */
  waves: string[][];
}

/**
 * An in-memory engine that (a) HONOURS `limit`, (b) logs every query tuple, and
 * (c) buckets queries into round-trip waves. A wave opens on a query issued
 * while nothing is in flight; every query launched inside one `Promise.all`
 * therefore lands in the same bucket, and every awaited-in-turn read opens its
 * own. The `setTimeout` is what makes concurrency observable — an immediately
 * resolved double would let a wave close between two synchronous launches.
 */
function makeProbe(tables: Tables) {
  const queries: QueryTuple[] = [];
  const waves: string[][] = [];
  let inFlight = 0;
  return {
    queries,
    waves,
    get legs() { return waves.length; },
    async find(object: string, opts: any) {
      if (inFlight === 0) waves.push([]);
      inFlight += 1;
      waves[waves.length - 1].push(object);
      queries.push({ object, where: opts?.where, limit: opts?.limit, context: opts?.context });
      try {
        await new Promise((r) => setTimeout(r, 1));
        const rows: any[] = tables[object] ?? [];
        const where = opts?.where ?? {};
        const matched = rows.filter((r) =>
          Object.entries(where).every(([k, v]) => {
            if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(r[k]);
            return r[k] === v;
          }),
        );
        return typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
      } finally {
        inFlight -= 1;
      }
    },
  };
}

const bigOrg = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ user_id: `peer${i}`, organization_id: 'org_a', role: 'member' }));

const FIXTURES: { name: string; tables: Tables; userId: string; opts: any }[] = [
  {
    name: 'empty-principal',
    tables: { sys_user: [{ id: 'u1' }], sys_member: [], sys_user_position: [], sys_user_permission_set: [] },
    userId: 'u1', opts: {},
  },
  {
    name: 'multi-org-membership',
    tables: {
      sys_user: [{ id: 'u1', email: 'ada@x.com' }],
      sys_member: [
        { user_id: 'u1', organization_id: 'org_a', role: 'owner' },
        { user_id: 'u1', organization_id: 'org_b', role: 'member' },
        { user_id: 'u2', organization_id: 'org_a', role: 'member' },
        { user_id: 'u3', organization_id: 'org_b', role: 'member' },
      ],
      sys_user_position: [], sys_user_permission_set: [],
    },
    userId: 'u1', opts: { tenantId: 'org_a' },
  },
  {
    name: 'position-derived-grants',
    tables: {
      sys_user: [{ id: 'u1' }],
      sys_member: [{ user_id: 'u1', organization_id: 'org_a', role: 'member' }],
      sys_user_position: [
        { user_id: 'u1', position: 'approver', organization_id: null },
        { user_id: 'u1', position: 'auditor', organization_id: 'org_a' },
        { user_id: 'u1', position: 'foreign_only', organization_id: 'org_b' },
      ],
      sys_user_permission_set: [],
      sys_position: [
        { id: 'p_appr', name: 'approver' },
        { id: 'p_aud', name: 'auditor' },
        { id: 'p_every', name: 'everyone' },
      ],
      sys_position_permission_set: [
        { position_id: 'p_appr', permission_set_id: 'ps_appr' },
        { position_id: 'p_every', permission_set_id: 'ps_base' },
      ],
      sys_permission_set: [
        { id: 'ps_appr', name: 'approver_ps', system_permissions: ['cap_approve'], tab_permissions: { crm: 'visible' } },
        { id: 'ps_base', name: 'base_ps', system_permissions: ['cap_read'], tab_permissions: { crm: 'default_on', hr: 'hidden' } },
      ],
    },
    userId: 'u1', opts: { tenantId: 'org_a' },
  },
  {
    name: 'permission-set-derived-platform-admin',
    tables: {
      sys_user: [{ id: 'u1' }],
      sys_member: [], sys_user_position: [],
      sys_user_permission_set: [
        { user_id: 'u1', permission_set_id: 'ps_admin', organization_id: null },
        { user_id: 'u1', permission_set_id: 'ps_sales', organization_id: 'org_a' },
        { user_id: 'u1', permission_set_id: 'ps_other', organization_id: 'org_b' },
      ],
      sys_permission_set: [
        { id: 'ps_admin', name: 'admin_full_access' },
        { id: 'ps_sales', name: 'sales_ps' },
        { id: 'ps_other', name: 'other_org_ps' },
      ],
    },
    userId: 'u1', opts: { tenantId: 'org_a' },
  },
  {
    name: 'ai-seat',
    tables: {
      sys_user: [{ id: 'u1', email: 'ai@x.com', ai_access: 1 }],
      sys_member: [], sys_user_position: [], sys_user_permission_set: [],
    },
    userId: 'u1', opts: {},
  },
  {
    name: 'ai-seat-already-seeded-plus-email',
    tables: {
      sys_user: [{ id: 'u1', email: 'db@x.com', ai_access: 1 }],
      sys_member: [], sys_user_position: [], sys_user_permission_set: [],
    },
    userId: 'u1', opts: { seedEmail: 'session@x.com', seedPermissions: ['ai_seat', 'api:scope'] },
  },
  {
    name: 'seeded-permissions-and-email',
    tables: {
      sys_user: [{ id: 'u1', email: 'db@x.com' }],
      sys_member: [], sys_user_position: [],
      sys_user_permission_set: [{ user_id: 'u1', permission_set_id: 'ps1', organization_id: null }],
      sys_permission_set: [{ id: 'ps1', name: 'sales_ps' }],
    },
    userId: 'u1', opts: { seedEmail: 'session@x.com', seedPermissions: ['api:scope'] },
  },
  {
    name: 'deactivated-position-and-set',
    tables: {
      sys_user: [{ id: 'u1' }],
      sys_member: [], 
      sys_user_position: [
        { user_id: 'u1', position: 'dead_pos', organization_id: null },
        { user_id: 'u1', position: 'live_pos', organization_id: null },
      ],
      sys_user_permission_set: [{ user_id: 'u1', permission_set_id: 'ps_dead', organization_id: null }],
      sys_position: [
        { id: 'p_dead', name: 'dead_pos', active: false },
        { id: 'p_live', name: 'live_pos', active: true },
      ],
      sys_position_permission_set: [
        { position_id: 'p_dead', permission_set_id: 'ps_x' },
        { position_id: 'p_live', permission_set_id: 'ps_live' },
      ],
      sys_permission_set: [
        { id: 'ps_dead', name: 'dead_ps', active: false },
        { id: 'ps_live', name: 'live_ps' },
        { id: 'ps_x', name: 'via_dead_pos' },
      ],
    },
    userId: 'u1', opts: {},
  },
  {
    name: 'validity-windows',
    tables: {
      sys_user: [{ id: 'u1' }],
      sys_member: [], 
      sys_user_position: [
        { user_id: 'u1', position: 'expired_pos', organization_id: null, valid_until: '2000-01-01T00:00:00Z' },
        { user_id: 'u1', position: 'live_pos', organization_id: null, valid_from: '2000-01-01T00:00:00Z' },
      ],
      sys_user_permission_set: [
        { user_id: 'u1', permission_set_id: 'ps_exp', organization_id: null, valid_until: '2000-01-01T00:00:00Z' },
        { user_id: 'u1', permission_set_id: 'ps_ok', organization_id: null },
      ],
      sys_permission_set: [{ id: 'ps_exp', name: 'admin_full_access' }, { id: 'ps_ok', name: 'ok_ps' }],
    },
    userId: 'u1', opts: { nowMs: Date.parse('2026-01-01T00:00:00Z') },
  },
  {
    name: 'fellow-org-over-200-members',
    tables: {
      sys_user: [{ id: 'u1' }],
      sys_member: [{ user_id: 'u1', organization_id: 'org_a', role: 'member' }, ...bigOrg(250)],
      sys_user_position: [], sys_user_permission_set: [],
    },
    userId: 'u1', opts: { tenantId: 'org_a' },
  },
  {
    name: 'org-less-principal-with-org-scoped-rows',
    tables: {
      sys_user: [{ id: 'u1' }],
      sys_member: [{ user_id: 'u1', organization_id: 'org_a', role: 'owner' }],
      sys_user_position: [{ user_id: 'u1', position: 'scoped_pos', organization_id: 'org_a' }],
      sys_user_permission_set: [{ user_id: 'u1', permission_set_id: 'ps_a', organization_id: 'org_a' }],
      sys_position: [{ id: 'p_s', name: 'scoped_pos' }],
      sys_position_permission_set: [{ position_id: 'p_s', permission_set_id: 'ps_p' }],
      sys_permission_set: [{ id: 'ps_a', name: 'a_ps' }, { id: 'ps_p', name: 'p_ps' }],
    },
    userId: 'u1', opts: {},
  },
  {
    name: 'no-engine',
    tables: {},
    userId: 'u1', opts: { seedPermissions: ['api:scope'] },
  },
];

const GOLDEN: Record<string, GoldenEntry> = {
  "empty-principal": {
    "grants": {
      "positions": ["everyone"],
      "permissions": [],
      "systemPermissions": [],
      "org_user_ids": ["u1"],
      "accessible_org_ids": [],
      "posture": "MEMBER"
    },
    "queries": [
      {
        "object": "sys_user",
        "where": {"id": "u1"},
        "limit": 1,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_member",
        "where": {"user_id": "u1"},
        "limit": 200,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_user_position",
        "where": {"user_id": "u1"},
        "limit": 200,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_user_permission_set",
        "where": {"user_id": "u1"},
        "limit": 100,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_position",
        "where": {
          "name": {
            "$in": ["everyone"]
          }
        },
        "limit": 100,
        "context": {"isSystem": true}
      }
    ],
    "seqLegs": 5,
    "seqQueries": 5,
    "waves": [
      ["sys_user", "sys_member", "sys_user_position", "sys_user_permission_set"],
      ["sys_position"]
    ]
  },
  "multi-org-membership": {
    "grants": {
      "positions": ["org_owner", "everyone"],
      "permissions": [],
      "systemPermissions": [],
      "org_user_ids": ["u1", "u2"],
      "accessible_org_ids": ["org_a", "org_b"],
      "email": "ada@x.com",
      "posture": "MEMBER"
    },
    "queries": [
      {
        "object": "sys_user",
        "where": {"id": "u1"},
        "limit": 1,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_member",
        "where": {"user_id": "u1"},
        "limit": 200,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_user_position",
        "where": {"user_id": "u1"},
        "limit": 200,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_member",
        "where": {"organization_id": "org_a"},
        "limit": 1000,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_user_permission_set",
        "where": {"user_id": "u1"},
        "limit": 100,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_position",
        "where": {
          "name": {
            "$in": ["org_owner", "everyone"]
          }
        },
        "limit": 100,
        "context": {"isSystem": true}
      }
    ],
    "seqLegs": 6,
    "seqQueries": 6,
    "waves": [
      ["sys_user", "sys_member", "sys_user_position", "sys_member", "sys_user_permission_set"],
      ["sys_position"]
    ]
  },
  "position-derived-grants": {
    "grants": {
      "positions": ["org_member", "approver", "auditor", "everyone"],
      "permissions": ["approver_ps", "base_ps"],
      "systemPermissions": ["cap_approve", "cap_read"],
      "org_user_ids": ["u1"],
      "accessible_org_ids": ["org_a"],
      "tabPermissions": {"crm": "visible", "hr": "hidden"},
      "posture": "MEMBER"
    },
    "queries": [
      {
        "object": "sys_user",
        "where": {"id": "u1"},
        "limit": 1,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_member",
        "where": {"user_id": "u1"},
        "limit": 200,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_user_position",
        "where": {"user_id": "u1"},
        "limit": 200,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_member",
        "where": {"organization_id": "org_a"},
        "limit": 1000,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_user_permission_set",
        "where": {"user_id": "u1"},
        "limit": 100,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_position",
        "where": {
          "name": {
            "$in": ["org_member", "approver", "auditor", "everyone"]
          }
        },
        "limit": 100,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_position_permission_set",
        "where": {
          "position_id": {
            "$in": ["p_appr", "p_aud", "p_every"]
          }
        },
        "limit": 500,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_permission_set",
        "where": {
          "id": {
            "$in": ["ps_appr", "ps_base"]
          }
        },
        "limit": 500,
        "context": {"isSystem": true}
      }
    ],
    "seqLegs": 8,
    "seqQueries": 8,
    "waves": [
      ["sys_user", "sys_member", "sys_user_position", "sys_member", "sys_user_permission_set"],
      ["sys_position"],
      ["sys_position_permission_set"],
      ["sys_permission_set"]
    ]
  },
  "permission-set-derived-platform-admin": {
    "grants": {
      "positions": ["platform_admin", "everyone"],
      "permissions": ["admin_full_access", "sales_ps"],
      "systemPermissions": [],
      "org_user_ids": ["u1"],
      "accessible_org_ids": [],
      "posture": "PLATFORM_ADMIN"
    },
    "queries": [
      {
        "object": "sys_user",
        "where": {"id": "u1"},
        "limit": 1,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_member",
        "where": {"user_id": "u1"},
        "limit": 200,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_user_position",
        "where": {"user_id": "u1"},
        "limit": 200,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_member",
        "where": {"organization_id": "org_a"},
        "limit": 1000,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_user_permission_set",
        "where": {"user_id": "u1"},
        "limit": 100,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_position",
        "where": {
          "name": {
            "$in": ["platform_admin", "everyone"]
          }
        },
        "limit": 100,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_permission_set",
        "where": {
          "id": {
            "$in": ["ps_admin", "ps_sales"]
          }
        },
        "limit": 500,
        "context": {"isSystem": true}
      }
    ],
    "seqLegs": 7,
    "seqQueries": 7,
    "waves": [
      ["sys_user", "sys_member", "sys_user_position", "sys_member", "sys_user_permission_set"],
      ["sys_position"],
      ["sys_permission_set"]
    ]
  },
  "ai-seat": {
    "grants": {
      "positions": ["everyone"],
      "permissions": ["ai_seat"],
      "systemPermissions": [],
      "org_user_ids": ["u1"],
      "accessible_org_ids": [],
      "email": "ai@x.com",
      "posture": "MEMBER"
    },
    "queries": [
      {
        "object": "sys_user",
        "where": {"id": "u1"},
        "limit": 1,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_member",
        "where": {"user_id": "u1"},
        "limit": 200,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_user_position",
        "where": {"user_id": "u1"},
        "limit": 200,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_user_permission_set",
        "where": {"user_id": "u1"},
        "limit": 100,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_position",
        "where": {
          "name": {
            "$in": ["everyone"]
          }
        },
        "limit": 100,
        "context": {"isSystem": true}
      }
    ],
    "seqLegs": 5,
    "seqQueries": 5,
    "waves": [
      ["sys_user", "sys_member", "sys_user_position", "sys_user_permission_set"],
      ["sys_position"]
    ]
  },
  "ai-seat-already-seeded-plus-email": {
    "grants": {
      "positions": ["everyone"],
      "permissions": ["ai_seat", "api:scope"],
      "systemPermissions": [],
      "org_user_ids": ["u1"],
      "accessible_org_ids": [],
      "email": "session@x.com",
      "posture": "MEMBER"
    },
    "queries": [
      {
        "object": "sys_member",
        "where": {"user_id": "u1"},
        "limit": 200,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_user_position",
        "where": {"user_id": "u1"},
        "limit": 200,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_user_permission_set",
        "where": {"user_id": "u1"},
        "limit": 100,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_position",
        "where": {
          "name": {
            "$in": ["everyone"]
          }
        },
        "limit": 100,
        "context": {"isSystem": true}
      }
    ],
    "seqLegs": 4,
    "seqQueries": 4,
    "waves": [
      ["sys_member", "sys_user_position", "sys_user_permission_set"],
      ["sys_position"]
    ]
  },
  "seeded-permissions-and-email": {
    "grants": {
      "positions": ["everyone"],
      "permissions": ["api:scope", "sales_ps"],
      "systemPermissions": [],
      "org_user_ids": ["u1"],
      "accessible_org_ids": [],
      "email": "session@x.com",
      "posture": "MEMBER"
    },
    "queries": [
      {
        "object": "sys_member",
        "where": {"user_id": "u1"},
        "limit": 200,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_user_position",
        "where": {"user_id": "u1"},
        "limit": 200,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_user_permission_set",
        "where": {"user_id": "u1"},
        "limit": 100,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_position",
        "where": {
          "name": {
            "$in": ["everyone"]
          }
        },
        "limit": 100,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_permission_set",
        "where": {
          "id": {
            "$in": ["ps1"]
          }
        },
        "limit": 500,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_user",
        "where": {"id": "u1"},
        "limit": 1,
        "context": {"isSystem": true}
      }
    ],
    "seqLegs": 6,
    "seqQueries": 6,
    "waves": [
      ["sys_user", "sys_member", "sys_user_position", "sys_user_permission_set"],
      ["sys_position"],
      ["sys_permission_set"]
    ]
  },
  "deactivated-position-and-set": {
    "grants": {
      "positions": ["live_pos", "everyone"],
      "permissions": ["live_ps"],
      "systemPermissions": [],
      "org_user_ids": ["u1"],
      "accessible_org_ids": [],
      "posture": "MEMBER"
    },
    "queries": [
      {
        "object": "sys_user",
        "where": {"id": "u1"},
        "limit": 1,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_member",
        "where": {"user_id": "u1"},
        "limit": 200,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_user_position",
        "where": {"user_id": "u1"},
        "limit": 200,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_user_permission_set",
        "where": {"user_id": "u1"},
        "limit": 100,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_position",
        "where": {
          "name": {
            "$in": ["dead_pos", "live_pos", "everyone"]
          }
        },
        "limit": 100,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_position_permission_set",
        "where": {
          "position_id": {
            "$in": ["p_live"]
          }
        },
        "limit": 500,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_permission_set",
        "where": {
          "id": {
            "$in": ["ps_dead", "ps_live"]
          }
        },
        "limit": 500,
        "context": {"isSystem": true}
      }
    ],
    "seqLegs": 7,
    "seqQueries": 7,
    "waves": [
      ["sys_user", "sys_member", "sys_user_position", "sys_user_permission_set"],
      ["sys_position"],
      ["sys_position_permission_set"],
      ["sys_permission_set"]
    ]
  },
  "validity-windows": {
    "grants": {
      "positions": ["live_pos", "everyone"],
      "permissions": ["ok_ps"],
      "systemPermissions": [],
      "org_user_ids": ["u1"],
      "accessible_org_ids": [],
      "posture": "MEMBER"
    },
    "queries": [
      {
        "object": "sys_user",
        "where": {"id": "u1"},
        "limit": 1,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_member",
        "where": {"user_id": "u1"},
        "limit": 200,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_user_position",
        "where": {"user_id": "u1"},
        "limit": 200,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_user_permission_set",
        "where": {"user_id": "u1"},
        "limit": 100,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_position",
        "where": {
          "name": {
            "$in": ["live_pos", "everyone"]
          }
        },
        "limit": 100,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_permission_set",
        "where": {
          "id": {
            "$in": ["ps_ok"]
          }
        },
        "limit": 500,
        "context": {"isSystem": true}
      }
    ],
    "seqLegs": 6,
    "seqQueries": 6,
    "waves": [
      ["sys_user", "sys_member", "sys_user_position", "sys_user_permission_set"],
      ["sys_position"],
      ["sys_permission_set"]
    ]
  },
  "fellow-org-over-200-members": {
    "grants": {
      "positions": ["org_member", "everyone"],
      "permissions": [],
      "systemPermissions": [],
      "org_user_ids": [
        "u1", "peer0", "peer1", "peer2", "peer3", "peer4", "peer5", "peer6", "peer7", "peer8",
        "peer9", "peer10", "peer11", "peer12", "peer13", "peer14", "peer15", "peer16",
        "peer17", "peer18", "peer19", "peer20", "peer21", "peer22", "peer23", "peer24",
        "peer25", "peer26", "peer27", "peer28", "peer29", "peer30", "peer31", "peer32",
        "peer33", "peer34", "peer35", "peer36", "peer37", "peer38", "peer39", "peer40",
        "peer41", "peer42", "peer43", "peer44", "peer45", "peer46", "peer47", "peer48",
        "peer49", "peer50", "peer51", "peer52", "peer53", "peer54", "peer55", "peer56",
        "peer57", "peer58", "peer59", "peer60", "peer61", "peer62", "peer63", "peer64",
        "peer65", "peer66", "peer67", "peer68", "peer69", "peer70", "peer71", "peer72",
        "peer73", "peer74", "peer75", "peer76", "peer77", "peer78", "peer79", "peer80",
        "peer81", "peer82", "peer83", "peer84", "peer85", "peer86", "peer87", "peer88",
        "peer89", "peer90", "peer91", "peer92", "peer93", "peer94", "peer95", "peer96",
        "peer97", "peer98", "peer99", "peer100", "peer101", "peer102", "peer103", "peer104",
        "peer105", "peer106", "peer107", "peer108", "peer109", "peer110", "peer111", "peer112",
        "peer113", "peer114", "peer115", "peer116", "peer117", "peer118", "peer119", "peer120",
        "peer121", "peer122", "peer123", "peer124", "peer125", "peer126", "peer127", "peer128",
        "peer129", "peer130", "peer131", "peer132", "peer133", "peer134", "peer135", "peer136",
        "peer137", "peer138", "peer139", "peer140", "peer141", "peer142", "peer143", "peer144",
        "peer145", "peer146", "peer147", "peer148", "peer149", "peer150", "peer151", "peer152",
        "peer153", "peer154", "peer155", "peer156", "peer157", "peer158", "peer159", "peer160",
        "peer161", "peer162", "peer163", "peer164", "peer165", "peer166", "peer167", "peer168",
        "peer169", "peer170", "peer171", "peer172", "peer173", "peer174", "peer175", "peer176",
        "peer177", "peer178", "peer179", "peer180", "peer181", "peer182", "peer183", "peer184",
        "peer185", "peer186", "peer187", "peer188", "peer189", "peer190", "peer191", "peer192",
        "peer193", "peer194", "peer195", "peer196", "peer197", "peer198", "peer199", "peer200",
        "peer201", "peer202", "peer203", "peer204", "peer205", "peer206", "peer207", "peer208",
        "peer209", "peer210", "peer211", "peer212", "peer213", "peer214", "peer215", "peer216",
        "peer217", "peer218", "peer219", "peer220", "peer221", "peer222", "peer223", "peer224",
        "peer225", "peer226", "peer227", "peer228", "peer229", "peer230", "peer231", "peer232",
        "peer233", "peer234", "peer235", "peer236", "peer237", "peer238", "peer239", "peer240",
        "peer241", "peer242", "peer243", "peer244", "peer245", "peer246", "peer247", "peer248",
        "peer249"
      ],
      "accessible_org_ids": ["org_a"],
      "posture": "MEMBER"
    },
    "queries": [
      {
        "object": "sys_user",
        "where": {"id": "u1"},
        "limit": 1,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_member",
        "where": {"user_id": "u1"},
        "limit": 200,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_user_position",
        "where": {"user_id": "u1"},
        "limit": 200,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_member",
        "where": {"organization_id": "org_a"},
        "limit": 1000,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_user_permission_set",
        "where": {"user_id": "u1"},
        "limit": 100,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_position",
        "where": {
          "name": {
            "$in": ["org_member", "everyone"]
          }
        },
        "limit": 100,
        "context": {"isSystem": true}
      }
    ],
    "seqLegs": 6,
    "seqQueries": 6,
    "waves": [
      ["sys_user", "sys_member", "sys_user_position", "sys_member", "sys_user_permission_set"],
      ["sys_position"]
    ]
  },
  "org-less-principal-with-org-scoped-rows": {
    "grants": {
      "positions": ["org_owner", "scoped_pos", "everyone"],
      "permissions": ["a_ps", "p_ps"],
      "systemPermissions": [],
      "org_user_ids": ["u1"],
      "accessible_org_ids": ["org_a"],
      "posture": "MEMBER"
    },
    "queries": [
      {
        "object": "sys_user",
        "where": {"id": "u1"},
        "limit": 1,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_member",
        "where": {"user_id": "u1"},
        "limit": 200,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_user_position",
        "where": {"user_id": "u1"},
        "limit": 200,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_user_permission_set",
        "where": {"user_id": "u1"},
        "limit": 100,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_position",
        "where": {
          "name": {
            "$in": ["org_owner", "scoped_pos", "everyone"]
          }
        },
        "limit": 100,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_position_permission_set",
        "where": {
          "position_id": {
            "$in": ["p_s"]
          }
        },
        "limit": 500,
        "context": {"isSystem": true}
      },
      {
        "object": "sys_permission_set",
        "where": {
          "id": {
            "$in": ["ps_a", "ps_p"]
          }
        },
        "limit": 500,
        "context": {"isSystem": true}
      }
    ],
    "seqLegs": 7,
    "seqQueries": 7,
    "waves": [
      ["sys_user", "sys_member", "sys_user_position", "sys_user_permission_set"],
      ["sys_position"],
      ["sys_position_permission_set"],
      ["sys_permission_set"]
    ]
  },
  "no-engine": {
    "grants": {
      "positions": [],
      "permissions": ["api:scope"],
      "systemPermissions": [],
      "org_user_ids": ["u1"],
      "accessible_org_ids": []
    },
    "queries": [],
    "seqLegs": 0,
    "seqQueries": 0,
    "waves": []
  }
};

const norm = (v: any) => JSON.parse(JSON.stringify(v));
const qkey = (q: QueryTuple) => JSON.stringify(q);

describe('[#10825] resolveUserAuthzGrants — batched reads are row-equivalent to the sequential ones', () => {
  for (const f of FIXTURES) {
    const g = GOLDEN[f.name];

    it(`${f.name}: resolves the SAME grants the pre-batch resolver did, array order included`, async () => {
      const probe = makeProbe(f.tables);
      const grants = await resolveUserAuthzGrants(f.name === 'no-engine' ? undefined : probe, f.userId, f.opts);
      // Whole-envelope equality, not a spot check: a batch that drops a filter
      // changes WHICH rows come back, and the damage surfaces in whichever of
      // positions / permissions / systemPermissions / tabPermissions /
      // org_user_ids / accessible_org_ids / posture / email that row fed.
      expect(norm(grants)).toEqual(g.grants);
      expect(Object.keys(norm(grants)).sort()).toEqual(Object.keys(g.grants).sort());
    });

    it(`${f.name}: issues the SAME queries — same object, where, limit and context`, async () => {
      const probe = makeProbe(f.tables);
      await resolveUserAuthzGrants(f.name === 'no-engine' ? undefined : probe, f.userId, f.opts);
      // Sorted because batching reorders issue time, never content. This is the
      // assertion that catches a widened `$in`, a dropped tenancy filter or a
      // raised/lowered limit directly, rather than waiting for it to show up as
      // a grant difference on whichever fixture happens to expose it.
      expect(probe.queries.map(qkey).sort()).toEqual(g.queries.map(qkey).sort());
      expect(probe.queries.length).toBe(g.seqQueries);
    });

    it(`${f.name}: ${g.seqLegs} sequential round trips -> ${g.waves.length}`, async () => {
      const probe = makeProbe(f.tables);
      await resolveUserAuthzGrants(f.name === 'no-engine' ? undefined : probe, f.userId, f.opts);
      // The WIN, pinned as an exact wave shape so a future edit that re-inserts
      // an `await` between two independent reads fails here and says which.
      expect(probe.waves).toEqual(g.waves);
      expect(probe.legs).toBeLessThan(g.seqLegs === 0 ? 1 : g.seqLegs);
    });
  }

  /**
   * The divergence case the batch could plausibly have caused, made concrete.
   *
   * Both `sys_member` reads could "obviously" be one query — same object, and
   * the caller's own membership rows are a subset of the active org's. They are
   * not one query, because they carry different limits for different reasons:
   * 200 bounds how many organizations one user may belong to, 1000 bounds how
   * many collaborators an org may have. Folded at 200, an org with 251 members
   * hands RLS a peer list missing 51 people — a narrower read scope, no error,
   * and no functional test that would notice.
   */
  it('the two sys_member reads stay two reads, with their own limits (folding them truncates the peer list)', async () => {
    const f = FIXTURES.find((x) => x.name === 'fellow-org-over-200-members')!;
    const probe = makeProbe(f.tables);
    const grants = await resolveUserAuthzGrants(probe, f.userId, f.opts);

    const memberReads = probe.queries.filter((q) => q.object === 'sys_member');
    expect(memberReads).toHaveLength(2);
    expect(memberReads.map((q) => q.limit).sort((a, b) => a - b)).toEqual([200, 1000]);
    expect(memberReads.map((q) => JSON.stringify(q.where)).sort()).toEqual(
      [JSON.stringify({ organization_id: 'org_a' }), JSON.stringify({ user_id: 'u1' })].sort(),
    );
    // 250 peers + the caller. A folded 200-row read would land on 200.
    expect(grants.org_user_ids).toHaveLength(251);
    // …and both reads still go out in the SAME wave, so keeping them separate
    // costs no round trip.
    expect(probe.waves[0].filter((o) => o === 'sys_member')).toHaveLength(2);
  });

  /**
   * Tenancy scoping, asserted as a row difference rather than as a filter
   * string: `u1` belongs to org_a and org_b, and resolves under org_a. The
   * org_b peer must not appear in `org_user_ids` — the fellow-org read's
   * `organization_id` filter is the only thing keeping it out, and a batch that
   * dropped it would still return a superset with no error.
   */
  it('a multi-org principal scopes org_user_ids to the ACTIVE org while accessible_org_ids spans both', async () => {
    const f = FIXTURES.find((x) => x.name === 'multi-org-membership')!;
    const grants = await resolveUserAuthzGrants(makeProbe(f.tables), f.userId, f.opts);
    expect(grants.org_user_ids.sort()).toEqual(['u1', 'u2']);
    expect(grants.org_user_ids).not.toContain('u3');
    expect(grants.accessible_org_ids.sort()).toEqual(['org_a', 'org_b']);
  });

  /**
   * The `sys_user` read (the `ai_seat` / email-fallback leg) is hoisted into the
   * first wave, but only when the pre-batch resolver would have made it at all:
   * a principal arriving with BOTH a caller-supplied email and `ai_seat` already
   * in its seeds needed no `sys_user` row, and still issues no `sys_user` query.
   * Hoisting it unconditionally would have added a query to every API-key
   * request that already carried the seat scope.
   */
  it('hoisting the sys_user read does not create one: a seeded email + seeded ai_seat still reads no sys_user', async () => {
    const f = FIXTURES.find((x) => x.name === 'ai-seat-already-seeded-plus-email')!;
    const probe = makeProbe(f.tables);
    await resolveUserAuthzGrants(probe, f.userId, f.opts);
    expect(probe.queries.filter((q) => q.object === 'sys_user')).toHaveLength(0);
  });

  /**
   * …and it is still read at most once when it IS needed, which is the #2409
   * de-duplication this batch had to carry across (the email fallback and the
   * `ai_seat` synthesis both want the row; the memo is now a promise, so the two
   * call sites cannot race into two queries either).
   */
  it('sys_user is read at most once per resolution, even though the wave starts it early', async () => {
    const f = FIXTURES.find((x) => x.name === 'ai-seat')!;
    const probe = makeProbe(f.tables);
    const grants = await resolveUserAuthzGrants(probe, f.userId, f.opts);
    expect(probe.queries.filter((q) => q.object === 'sys_user')).toHaveLength(1);
    expect(grants.permissions).toContain('ai_seat');
    expect(grants.email).toBe('ai@x.com');
  });
});

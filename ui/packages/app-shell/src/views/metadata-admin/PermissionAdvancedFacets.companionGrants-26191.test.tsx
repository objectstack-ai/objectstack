// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins the companion-grant hint of the Delegated Admin Scope facet.
 *
 * A scope says WHAT its holder may administer; it does not let the holder in.
 * A delegate also needs the `setup.access` capability to enter Setup, read on
 * `sys_user` / `sys_business_unit` / `sys_business_unit_member` so the pickers
 * can list people and units, and CRUD on `sys_user_position` for the
 * assignment rows themselves. Without them the delegate meets "You don't have
 * access to this app" — the server is right to refuse, and the editor said
 * nothing about it.
 *
 * The facet now lists those five grants, marks each as granted or not by THIS
 * set, and offers one action that adds only the missing ones to the same
 * draft — never removing or narrowing a grant the set already carries. Under
 * a package binding the list stays and the action does not: the package
 * editor saves only the package's own objects, so the grants belong on an
 * environment set.
 *
 * Driven through the editor with the draft held as the host holds it, so the
 * assertions read what the facet actually wrote.
 */

import * as React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PermissionSetSchema } from "@objectstack/spec/security";
import { PermissionAdvancedFacets } from "./PermissionAdvancedFacets";

afterEach(cleanup);

const t = (k: string) => k;

type Draft = Record<string, unknown>;

let latest: Draft = {};
let draftWrites = 0;

function Harness({
  initial,
  writable = true,
  only,
  packageBound,
}: {
  initial: Draft;
  writable?: boolean;
  only?: "admin";
  packageBound?: boolean;
}) {
  const [draft, setDraft] = React.useState<Draft>(initial);
  React.useEffect(() => {
    latest = draft;
  }, [draft]);
  const countedSetDraft = React.useCallback((updater: (prev: any) => any) => {
    draftWrites += 1;
    setDraft(updater);
  }, []);
  return (
    <PermissionAdvancedFacets
      draft={draft}
      setDraft={countedSetDraft}
      writable={writable}
      allSetNames={[]}
      t={t}
      only={only}
      packageBound={packageBound}
    />
  );
}

async function mount(
  initial: Draft,
  opts: { writable?: boolean; only?: "admin"; packageBound?: boolean } = {},
) {
  const user = userEvent.setup();
  latest = initial;
  draftWrites = 0;
  render(<Harness initial={initial} {...opts} />);
  if (opts.only === undefined) {
    // The stacked (Setup) presentation: the section starts collapsed.
    await user.click(screen.getByText("perm.admin.title"));
  }
  return user;
}

const ANCHORED = { businessUnit: "bu_field_ops", manageAssignments: true };

const COMPANIONS = [
  "setup.access",
  "sys_user",
  "sys_business_unit",
  "sys_business_unit_member",
  "sys_user_position",
] as const;

const row = (id: string) => screen.getByTestId(`admin-companion-${id}`);
const grantButton = () => screen.queryByTestId("admin-companions-grant");

describe("PermissionAdvancedFacets · delegated admin companion grants", () => {
  it("lists the five companion grants, each marked missing on an empty set", async () => {
    await mount({ name: "field_ops_delegate", objects: {}, adminScope: ANCHORED });

    expect(screen.getByTestId("admin-companions")).toBeTruthy();
    for (const id of COMPANIONS) {
      expect(row(id).getAttribute("data-granted"), id).toBe("false");
    }
    expect(grantButton()).toBeTruthy();
  });

  it("marks each grant this set already carries as granted", async () => {
    await mount({
      name: "field_ops_delegate",
      systemPermissions: ["setup.access"],
      objects: {
        sys_user: { allowRead: true },
        // CRUD is all four; read alone does not cover the assignment rows.
        sys_user_position: { allowRead: true },
      },
      adminScope: ANCHORED,
    });

    expect(row("setup.access").getAttribute("data-granted")).toBe("true");
    expect(row("sys_user").getAttribute("data-granted")).toBe("true");
    expect(row("sys_business_unit").getAttribute("data-granted")).toBe("false");
    expect(row("sys_business_unit_member").getAttribute("data-granted")).toBe("false");
    expect(row("sys_user_position").getAttribute("data-granted")).toBe("false");
  });

  it("is not shown until the scope names a business unit, matching the block's gate", async () => {
    await mount({ name: "field_ops_delegate", objects: {} });
    expect(screen.queryByTestId("admin-companions")).toBeNull();
    expect(grantButton()).toBeNull();
  });

  it("one click adds only the missing grants, in one draft write, and narrows nothing", async () => {
    const user = await mount({
      name: "field_ops_delegate",
      systemPermissions: ["manage_org_users"],
      objects: {
        account: { allowRead: true, allowEdit: true },
        sys_user: { allowRead: true, allowEdit: true },
        sys_user_position: { allowRead: true, viewAllRecords: true },
      },
      adminScope: ANCHORED,
    });
    const before = draftWrites;

    await user.click(grantButton() as HTMLElement);

    expect(draftWrites - before).toBe(1);
    expect(latest.systemPermissions).toEqual(["manage_org_users", "setup.access"]);
    expect(latest.objects).toEqual({
      // Untouched: not a companion.
      account: { allowRead: true, allowEdit: true },
      // Untouched: already granted, and its extra Edit is kept.
      sys_user: { allowRead: true, allowEdit: true },
      // Widened to CRUD; its existing View All is kept.
      sys_user_position: {
        allowRead: true,
        viewAllRecords: true,
        allowCreate: true,
        allowEdit: true,
        allowDelete: true,
      },
      sys_business_unit: { allowRead: true },
      sys_business_unit_member: { allowRead: true },
    });
    // The scope itself is not touched by the grant.
    expect(latest.adminScope).toEqual(ANCHORED);
    // Every companion now reads as granted, so there is nothing left to add.
    for (const id of COMPANIONS) {
      expect(row(id).getAttribute("data-granted"), id).toBe("true");
    }
    expect(grantButton()).toBeNull();
  });

  it("writes a set the spec accepts, with no key the set did not already have a slot for", async () => {
    const user = await mount({ name: "field_ops_delegate", objects: {}, adminScope: ANCHORED });
    await user.click(grantButton() as HTMLElement);

    expect(Object.keys(latest).sort()).toEqual(
      ["adminScope", "name", "objects", "systemPermissions"].sort(),
    );
    const verdict = PermissionSetSchema.safeParse(latest);
    expect(verdict.success, JSON.stringify(verdict.error?.issues)).toBe(true);
  });

  it("offers no action when every grant is already on the set", async () => {
    await mount({
      name: "field_ops_delegate",
      systemPermissions: ["setup.access"],
      objects: {
        sys_user: { allowRead: true },
        sys_business_unit: { allowRead: true },
        sys_business_unit_member: { allowRead: true },
        sys_user_position: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
      },
      adminScope: ANCHORED,
    });
    expect(screen.getByTestId("admin-companions")).toBeTruthy();
    expect(grantButton()).toBeNull();
  });

  it("read-only: the hint stays, the action does not", async () => {
    await mount({ name: "field_ops_delegate", objects: {}, adminScope: ANCHORED }, { writable: false });
    expect(screen.getByTestId("admin-companions")).toBeTruthy();
    expect(grantButton()).toBeNull();
  });

  it("under a package binding: the hint stays, the action does not, and the note says where to grant", async () => {
    await mount(
      {
        name: "field_ops_delegate",
        systemPermissions: ["setup.access"],
        objects: {},
        adminScope: ANCHORED,
      },
      { packageBound: true },
    );
    const hint = screen.getByTestId("admin-companions");
    // Listed, but not marked: the package door's draft holds only the
    // package's own objects, so a `sys_*` row absent here says nothing about
    // the stored set.
    for (const id of COMPANIONS) expect(row(id).hasAttribute("data-granted"), id).toBe(false);
    expect(grantButton()).toBeNull();
    expect(within(hint).getByText("perm.admin.companions.packageNote")).toBeTruthy();
  });

  it("the Studio Access pillar mount (the package door's only host) is package-bound by default", async () => {
    await mount({ name: "field_ops_delegate", objects: {}, adminScope: ANCHORED }, { only: "admin" });
    expect(screen.getByTestId("admin-companions")).toBeTruthy();
    expect(grantButton()).toBeNull();
  });

  it("an explicit packageBound={false} on that mount keeps the action", async () => {
    await mount(
      { name: "field_ops_delegate", objects: {}, adminScope: ANCHORED },
      { only: "admin", packageBound: false },
    );
    expect(grantButton()).toBeTruthy();
  });
});

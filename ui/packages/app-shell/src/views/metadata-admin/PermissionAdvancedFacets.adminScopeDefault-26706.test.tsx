// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins what the Delegated Admin Scope facet's switches draw against the spec's
 * own defaults (objectstack#26706).
 *
 * A delegated-admin scope may leave a defaulted key unset; the server parses it
 * with `AdminScopeSchema`, so the unset key means that schema's default. Each
 * switch must therefore draw the spec default for an unset key, draw an
 * explicit boolean as itself, write nothing merely by being drawn, and write an
 * explicit boolean when the author flips it.
 *
 * Every expected value is read from the installed spec (`AdminScopeSchema`),
 * not restated here, so the pin follows the protocol: a default the spec moves
 * fails this file against the editor's restated
 * `ADMIN_SCOPE_SWITCH_DEFAULTS`. The CONTROL case keeps a reading that never
 * reached the schema from passing as a reading about the editor.
 */

import * as React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminScopeSchema } from "@objectstack/spec/security";
import { PermissionAdvancedFacets } from "./PermissionAdvancedFacets";

afterEach(cleanup);

const t = (k: string) => k;

type Draft = Record<string, unknown>;

/** The draft as the host would hold it after the last update. */
let latest: Draft = {};

function Harness({ initial }: { initial: Draft }) {
  const [draft, setDraft] = React.useState<Draft>(initial);
  React.useEffect(() => {
    latest = draft;
  }, [draft]);
  return (
    <PermissionAdvancedFacets
      draft={draft}
      setDraft={setDraft}
      writable
      allSetNames={[]}
      t={t}
      only="admin"
    />
  );
}

function mount(initial: Draft) {
  const user = userEvent.setup();
  latest = initial;
  render(<Harness initial={initial} />);
  return user;
}

const BU = "bu_east";

/** Each boolean key the facet draws a switch for, with the switch's caption. */
const SWITCHES = [
  ["includeSubtree", "perm.admin.includeSubtree"],
  ["manageAssignments", "perm.admin.manageAssignments"],
] as const;

/** The spec's own parse of a scope that names its business unit and nothing else. */
const specParsed = () => AdminScopeSchema.parse({ businessUnit: BU });

/** A switch lives inside the `<label>` that carries its caption. */
const switchFor = (captionKey: string) =>
  within(screen.getByText(captionKey).closest("label") as HTMLElement).getByRole("switch");

const drawn = (captionKey: string) => switchFor(captionKey).getAttribute("aria-checked");

describe("PermissionAdvancedFacets · delegated-admin switches draw the spec default (objectstack#26706)", () => {
  it("CONTROL — the installed spec parses each unset switch key to a boolean default", () => {
    const parsed = specParsed();
    for (const [key] of SWITCHES) {
      expect(typeof parsed[key], key).toBe("boolean");
    }
    expect(parsed.includeSubtree).toBe(true);
  });

  it("an unset key draws the spec default", () => {
    mount({ adminScope: { businessUnit: BU } });
    const parsed = specParsed();
    for (const [key, caption] of SWITCHES) {
      expect(drawn(caption), key).toBe(String(parsed[key]));
    }
    expect(switchFor("perm.admin.includeSubtree")).toBeChecked();
  });

  it("the switches draw the same defaults while they wait for a business unit", () => {
    mount({});
    const parsed = specParsed();
    for (const [key, caption] of SWITCHES) {
      expect(switchFor(caption)).toBeDisabled();
      expect(drawn(caption), key).toBe(String(parsed[key]));
    }
  });

  it("naming the business unit writes that key alone: drawing a default never writes it", async () => {
    const user = mount({});
    await user.type(screen.getByRole("textbox"), BU);

    expect(latest.adminScope).toEqual({ businessUnit: BU });
    const parsed = specParsed();
    for (const [key, caption] of SWITCHES) {
      expect(drawn(caption), key).toBe(String(parsed[key]));
    }
  });

  it("a flip writes an explicit boolean, the opposite of what was drawn, and draws it", async () => {
    const parsed = specParsed();
    for (const [key, caption] of SWITCHES) {
      const user = mount({ adminScope: { businessUnit: BU } });

      await user.click(switchFor(caption));
      expect(latest.adminScope, key).toEqual({ businessUnit: BU, [key]: !parsed[key] });
      expect(drawn(caption), key).toBe(String(!parsed[key]));

      // Flipped back, the key stays written: explicit, and equal to the default.
      await user.click(switchFor(caption));
      expect(latest.adminScope, key).toEqual({ businessUnit: BU, [key]: parsed[key] });
      expect(drawn(caption), key).toBe(String(parsed[key]));
      expect(AdminScopeSchema.safeParse(latest.adminScope).success, key).toBe(true);

      cleanup();
    }
  });

  it("an explicit boolean draws as itself, whichever the default", () => {
    for (const value of [true, false]) {
      mount({ adminScope: { businessUnit: BU, includeSubtree: value, manageAssignments: value } });
      for (const [key, caption] of SWITCHES) {
        expect(drawn(caption), `${key}: ${value}`).toBe(String(value));
      }
      cleanup();
    }
  });
});

// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A Tab visibility row keeps its name input across keystrokes (objectui#26748).
 *
 * Each row was keyed by the tab name its input edits, so every keystroke
 * renamed the key, remounted the row, and the input lost focus after the first
 * character: typing `showcase_app` stored `{"s":"hidden"}`.
 *
 * What is pinned:
 *   - a name typed one key at a time (not pasted) into a new row keeps focus
 *     and lands whole in `tabPermissions`, with the row's visibility;
 *   - renaming an existing row keeps the other rows and their order;
 *   - a name that passes through another row's name merges nothing, and the
 *     row writes again once the name is free;
 *   - the remove button drops only its own row.
 *
 * DIRECTION: with `key={tab}` restored the typed-name pin is red (focus leaves
 * after the first key).
 */

import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PermissionAdvancedFacets } from "./PermissionAdvancedFacets";

afterEach(cleanup);

const t = (k: string) => k;

type Draft = Record<string, unknown>;

/** A stateful host, so each write re-renders the facets like the editor does. */
function Host({
  initial,
  onDraft,
}: {
  initial: Draft;
  onDraft: (d: Draft) => void;
}) {
  const [draft, setDraft] = React.useState<Draft>(initial);
  React.useEffect(() => {
    onDraft(draft);
  }, [draft, onDraft]);
  return (
    <PermissionAdvancedFacets
      draft={draft}
      setDraft={setDraft}
      writable
      allSetNames={[]}
      t={t}
    />
  );
}

function mount(tabPermissions: Record<string, string>) {
  let latest: Draft = {};
  render(
    <Host
      initial={{ tabPermissions }}
      onDraft={(d) => {
        latest = d;
      }}
    />,
  );
  fireEvent.click(screen.getByText("perm.tabs.title"));
  return { tabs: () => latest.tabPermissions };
}

describe("a Tab visibility row keeps its name input across keystrokes (objectui#26748)", () => {
  it("stores a name typed key by key into a new row, focus kept", async () => {
    const user = userEvent.setup();
    const { tabs } = mount({ "": "hidden" });
    const input = screen.getByDisplayValue("");
    await user.click(input);
    await user.type(input, "showcase_app");
    expect(document.activeElement).toBe(input);
    expect(input).toHaveValue("showcase_app");
    expect(tabs()).toEqual({ showcase_app: "hidden" });
  });

  it("renames an existing row, keeping the others in order", async () => {
    const user = userEvent.setup();
    const { tabs } = mount({ a_tab: "hidden", b_tab: "visible" });
    const input = screen.getByDisplayValue("a_tab");
    await user.type(input, "_x");
    expect(document.activeElement).toBe(input);
    expect(JSON.stringify(tabs())).toBe(
      '{"a_tab_x":"hidden","b_tab":"visible"}',
    );
  });

  it("merges nothing while the typed name is another row’s", async () => {
    const user = userEvent.setup();
    const { tabs } = mount({ app: "visible", "": "hidden" });
    const input = screen.getByDisplayValue("");
    await user.type(input, "app");
    expect(input).toHaveValue("app");
    expect(JSON.stringify(tabs())).toBe('{"app":"visible","ap":"hidden"}');
    await user.type(input, "_x");
    expect(JSON.stringify(tabs())).toBe('{"app":"visible","app_x":"hidden"}');
    expect(screen.getByDisplayValue("app")).not.toBe(input);
  });

  it("removes only its own row", () => {
    const { tabs } = mount({ a_tab: "hidden", b_tab: "visible" });
    fireEvent.click(screen.getAllByLabelText("perm.tabs.remove")[0]!);
    expect(tabs()).toEqual({ b_tab: "visible" });
    expect(screen.getByDisplayValue("b_tab")).toBeInTheDocument();
  });
});

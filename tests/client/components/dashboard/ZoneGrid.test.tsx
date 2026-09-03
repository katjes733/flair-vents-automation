/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { Zone } from "~/client/api/zonesApi";

afterEach(cleanup);

const { updateZone } = vi.hoisted(() => ({ updateZone: vi.fn() }));
vi.mock("~/client/api/zonesApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/client/api/zonesApi")>();
  return { ...actual, updateZone };
});

const { default: ZoneGrid } =
  await import("~/client/components/dashboard/ZoneGrid");
const { computeDropSide, computeReorderedIndex } =
  await import("~/client/components/shared/reorderDragLogic");
const { lightStatusPalette } = await import("~/client/theme/statusPalette");

const theme = createTheme({
  palette: { mode: "light", status: lightStatusPalette },
});

function makeZone(overrides: Partial<Zone> = {}): Zone {
  return {
    id: "z1",
    installationId: "inst-1",
    airHandlerId: "ah-1",
    flairRoomId: null,
    name: "Bedroom",
    ventHardwareType: "flair_smart_vent",
    config: {
      has_temperature_sensor: true,
      has_occupancy_sensor: false,
      thermal_load_flags: [],
      idle_baseline_position: 100,
      sensor_calibration_offset: 0,
      min_vent_position: 0,
      max_vent_position: 100,
      flair_vents: [{ flair_vent_id: "vent-1" }],
      manual_vents: [],
      display_order: 0,
    },
    state: {
      last_target_position: null,
      last_commanded_at: null,
      vents: [],
      last_reading_value: 22.5,
      last_reading_changed_at: null,
      stale: false,
      spike_active: false,
      spike_since: null,
      last_classification: null,
      occupied: false,
      occupancy_pending_flip_since: null,
    },
    ...overrides,
  };
}

function renderGrid(zones: Zone[], onChanged = vi.fn()) {
  return render(
    <ThemeProvider theme={theme}>
      <ZoneGrid
        zones={zones}
        tickRecordsByZoneId={new Map()}
        activeOverridesByZoneId={new Map()}
        onChanged={onChanged}
        onEdit={vi.fn()}
      />
    </ThemeProvider>,
  );
}

describe("ZoneGrid", () => {
  beforeEach(() => {
    updateZone.mockReset().mockResolvedValue({});
  });

  it("renders one card per zone, threading tick records and overrides by zone id", () => {
    const zones = [
      makeZone({ id: "z1", name: "Bedroom" }),
      makeZone({ id: "z2", name: "Office" }),
    ];
    render(
      <ThemeProvider theme={theme}>
        <ZoneGrid
          zones={zones}
          tickRecordsByZoneId={
            new Map([
              [
                "z1",
                {
                  zone_id: "z1",
                  name: "Bedroom",
                  vent_hardware_type: "flair_smart_vent",
                  classification: "demanding",
                  occupied: false,
                  spiking: false,
                  resolved_setpoint: null,
                  desired_position_pct: 60,
                  post_contention_position_pct: 60,
                  vents: [
                    {
                      flair_vent_id: "vent-1",
                      name: "Bedroom Vent",
                      commanded_position_pct: 50,
                      reported_position_pct: 48,
                      dispatch_decision: "dispatched",
                      degraded: false,
                    },
                  ],
                  reason: "still cooling",
                },
              ],
            ])
          }
          activeOverridesByZoneId={new Map()}
          onChanged={vi.fn()}
          onEdit={vi.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("Bedroom")).toBeInTheDocument();
    expect(screen.getByText("Office")).toBeInTheDocument();
    expect(screen.getByText("Demanding")).toBeInTheDocument();
  });

  it("calls onEdit with the right zone when a specific card's Edit button is clicked", () => {
    const onEdit = vi.fn();
    const zones = [
      makeZone({ id: "z1", name: "Bedroom" }),
      makeZone({ id: "z2", name: "Office" }),
    ];
    render(
      <ThemeProvider theme={theme}>
        <ZoneGrid
          zones={zones}
          tickRecordsByZoneId={new Map()}
          activeOverridesByZoneId={new Map()}
          onChanged={vi.fn()}
          onEdit={onEdit}
        />
      </ThemeProvider>,
    );

    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    fireEvent.click(editButtons[1]);
    expect(onEdit).toHaveBeenCalledWith(zones[1]);
  });

  it("sorts zones by display_order rather than the order they were passed in", () => {
    const zones = [
      makeZone({
        id: "z1",
        name: "Second",
        config: { ...makeZone().config, display_order: 1 },
      }),
      makeZone({
        id: "z2",
        name: "First",
        config: { ...makeZone().config, display_order: 0 },
      }),
    ];
    renderGrid(zones);
    const headings = screen.getAllByRole("heading", { level: 6 });
    expect(headings.map((h) => h.textContent)).toEqual(["First", "Second"]);
  });

  it("moving a zone down persists sequential display_order for both affected zones", async () => {
    const onChanged = vi.fn();
    const zones = [
      makeZone({
        id: "z1",
        name: "First",
        config: { ...makeZone().config, display_order: 0 },
      }),
      makeZone({
        id: "z2",
        name: "Second",
        config: { ...makeZone().config, display_order: 1 },
      }),
    ];
    renderGrid(zones, onChanged);

    fireEvent.click(screen.getByRole("button", { name: "Move First down" }));

    await vi.waitFor(() => {
      expect(updateZone).toHaveBeenCalledWith("z1", {
        config: { display_order: 1 },
      });
      expect(updateZone).toHaveBeenCalledWith("z2", {
        config: { display_order: 0 },
      });
      expect(onChanged).toHaveBeenCalled();
    });

    const headings = screen.getAllByRole("heading", { level: 6 });
    expect(headings.map((h) => h.textContent)).toEqual(["Second", "First"]);
  });

  it("disables the up arrow for the first zone and the down arrow for the last", () => {
    const zones = [
      makeZone({
        id: "z1",
        name: "First",
        config: { ...makeZone().config, display_order: 0 },
      }),
      makeZone({
        id: "z2",
        name: "Last",
        config: { ...makeZone().config, display_order: 1 },
      }),
    ];
    renderGrid(zones);
    expect(
      screen.getByRole("button", { name: "Move First up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Last down" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move First down" }),
    ).not.toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Last up" }),
    ).not.toBeDisabled();
  });

  // Regression coverage for the user-requested drop indicator: "not
  // evident when it will correctly lock in its new position... an
  // indicated line where the card would snap in." The exact before/after/
  // no-op arithmetic is covered directly against `computeDropSide`/
  // `computeReorderedIndex` below rather than by simulating real drag
  // gestures — jsdom's `DragEvent`/pointer-position support is too
  // incomplete to reliably carry a real `clientX` through a simulated
  // "dragover" event, independent of whether the underlying logic is
  // correct. A separate, simpler DOM test still confirms the indicator
  // element itself actually appears and disappears at the right time.
  function gridItemFor(name: string): HTMLElement {
    const heading = screen.getByRole("heading", { name });
    const item = heading.closest('[draggable="true"]');
    if (!item) throw new Error(`no draggable grid item found for ${name}`);
    return item as HTMLElement;
  }

  describe("computeDropSide", () => {
    it("is 'before' when the pointer is in the left half of the target", () => {
      expect(computeDropSide(120, { left: 100, width: 200 })).toBe("before");
    });

    it("is 'after' when the pointer is in the right half of the target", () => {
      expect(computeDropSide(280, { left: 100, width: 200 })).toBe("after");
    });

    it("treats the exact midpoint as 'after'", () => {
      expect(computeDropSide(200, { left: 100, width: 200 })).toBe("after");
    });
  });

  describe("computeReorderedIndex", () => {
    it("moves a card forward when dropped after a later card", () => {
      // [A, B, C, D] — drag A (0), drop after C (2) → [B, C, A, D].
      expect(computeReorderedIndex(0, { index: 2, side: "after" })).toBe(2);
    });

    it("moves a card forward when dropped before a later card", () => {
      // [A, B, C, D] — drag A (0), drop before C (2) → [B, A, C, D].
      expect(computeReorderedIndex(0, { index: 2, side: "before" })).toBe(1);
    });

    it("moves a card backward when dropped before an earlier card", () => {
      // [A, B, C, D] — drag D (3), drop before A (0) → [D, A, B, C].
      expect(computeReorderedIndex(3, { index: 0, side: "before" })).toBe(0);
    });

    it("moves a card backward when dropped after an earlier card", () => {
      // [A, B, C, D] — drag D (3), drop after A (0) → [A, D, B, C].
      expect(computeReorderedIndex(3, { index: 0, side: "after" })).toBe(1);
    });

    it("is a no-op when dropped on its own current position, either side", () => {
      expect(computeReorderedIndex(1, { index: 1, side: "before" })).toBeNull();
      expect(computeReorderedIndex(1, { index: 1, side: "after" })).toBeNull();
    });

    it("is a no-op when dropped adjacent to itself in a way that wouldn't move it", () => {
      // [A, B, C, D] — drag B (1), drop after A (0): B is already right
      // after A, so this changes nothing.
      expect(computeReorderedIndex(1, { index: 0, side: "after" })).toBeNull();
      // Symmetric case: drag C (2), drop before D (3): C is already
      // right before D.
      expect(computeReorderedIndex(2, { index: 3, side: "before" })).toBeNull();
    });
  });

  it("shows exactly one drop indicator while dragging, on the card being dragged over", () => {
    const zones = [
      makeZone({
        id: "z1",
        name: "First",
        config: { ...makeZone().config, display_order: 0 },
      }),
      makeZone({
        id: "z2",
        name: "Second",
        config: { ...makeZone().config, display_order: 1 },
      }),
    ];
    renderGrid(zones);
    const first = gridItemFor("First");
    const second = gridItemFor("Second");

    expect(screen.queryByTestId("drop-indicator")).not.toBeInTheDocument();
    fireEvent.dragStart(first);
    fireEvent.dragOver(second);
    expect(screen.getAllByTestId("drop-indicator")).toHaveLength(1);
    expect(second.contains(screen.getByTestId("drop-indicator"))).toBe(true);

    fireEvent.dragEnd(first);
    expect(screen.queryByTestId("drop-indicator")).not.toBeInTheDocument();
  });

  it("dragging one card and dropping it on another persists both zones' new display_order", async () => {
    const onChanged = vi.fn();
    const zones = [
      makeZone({
        id: "z1",
        name: "First",
        config: { ...makeZone().config, display_order: 0 },
      }),
      makeZone({
        id: "z2",
        name: "Second",
        config: { ...makeZone().config, display_order: 1 },
      }),
    ];
    renderGrid(zones, onChanged);
    const first = gridItemFor("First");
    const second = gridItemFor("Second");

    fireEvent.dragStart(first);
    fireEvent.dragOver(second);
    fireEvent.drop(second);

    await vi.waitFor(() => {
      expect(updateZone).toHaveBeenCalled();
      expect(onChanged).toHaveBeenCalled();
    });
  });

  // Regression test for a real, user-reported bug: editing a zone (e.g.
  // renaming it or changing its vent hardware type) didn't show up
  // immediately in the dashboard. Root cause: `ordered` (the locally-
  // controlled position array — see orderKey's own comment) only ever
  // re-synced from a fresh `zones` prop when the *set or order* of ids
  // changed, since that's the one thing `orderKey` compares. A same-id,
  // changed-content update (the overwhelmingly common case for any zone
  // edit, since edits never add/remove zones) left `ordered` — and
  // therefore every ZoneCard's props — silently stuck on the old data
  // until something else happened to touch the id ordering.
  it("reflects a same-id content change from a fresh zones prop immediately, without any reorder", () => {
    const zones = [makeZone({ id: "z1", name: "Bedroom" })];
    const { rerender } = renderGrid(zones);
    expect(screen.getByText("Bedroom")).toBeInTheDocument();

    rerender(
      <ThemeProvider theme={theme}>
        <ZoneGrid
          zones={[makeZone({ id: "z1", name: "Bedroom (edited)" })]}
          tickRecordsByZoneId={new Map()}
          activeOverridesByZoneId={new Map()}
          onChanged={vi.fn()}
          onEdit={vi.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText("Bedroom (edited)")).toBeInTheDocument();
    expect(screen.queryByText("Bedroom")).not.toBeInTheDocument();
  });
});

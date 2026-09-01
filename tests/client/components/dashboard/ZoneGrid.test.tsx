/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { Zone } from "~/client/api/zonesApi";

afterEach(cleanup);

const { default: ZoneGrid } =
  await import("~/client/components/dashboard/ZoneGrid");
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
      flair_vent_ids: ["vent-1"],
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

describe("ZoneGrid", () => {
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
                  desired_position_pct: 60,
                  post_contention_position_pct: 60,
                  vents: [
                    {
                      flair_vent_id: "vent-1",
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
});

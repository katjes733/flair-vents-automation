/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { Zone } from "~/client/api/zonesApi";
import StalenessMonitor from "~/client/components/diagnostics/StalenessMonitor";

afterEach(cleanup);

const theme = createTheme();
const NOW = new Date("2026-09-02T12:00:00.000Z").getTime();

function makeZone(overrides: Partial<Zone> = {}): Zone {
  return {
    id: "z1",
    installationId: "inst-1",
    airHandlerId: "ah-1",
    flairRoomId: "room-1",
    name: "Martin Bedroom",
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

function renderMonitor(zones: Zone[]) {
  return render(
    <ThemeProvider theme={theme}>
      <StalenessMonitor zones={zones} nowMs={NOW} />
    </ThemeProvider>,
  );
}

describe("StalenessMonitor", () => {
  it("shows a fresh zone's elapsed time since its last reading change", () => {
    renderMonitor([
      makeZone({
        state: {
          ...makeZone().state,
          last_reading_changed_at: "2026-09-02T11:57:00.000Z",
          stale: false,
        },
      }),
    ]);
    expect(screen.getByText("Fresh")).toBeInTheDocument();
    expect(screen.getByText("3m ago")).toBeInTheDocument();
  });

  it("flags a stale zone distinctly from a fresh one", () => {
    renderMonitor([
      makeZone({
        name: "Martin Office",
        state: {
          ...makeZone().state,
          last_reading_changed_at: "2026-09-02T11:00:00.000Z",
          stale: true,
        },
      }),
    ]);
    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(screen.getByText("1h ago")).toBeInTheDocument();
  });

  it("shows a zone with no reading yet distinctly from stale or fresh", () => {
    renderMonitor([makeZone({ state: { ...makeZone().state, stale: false } })]);
    expect(screen.getByText("No reading yet")).toBeInTheDocument();
    expect(screen.queryByText("Stale")).not.toBeInTheDocument();
  });

  it("renders one tile per zone", () => {
    renderMonitor([
      makeZone({ id: "z1", name: "Martin Bedroom" }),
      makeZone({ id: "z2", name: "Martin Office" }),
    ]);
    expect(screen.getByText("Martin Bedroom")).toBeInTheDocument();
    expect(screen.getByText("Martin Office")).toBeInTheDocument();
  });
});

/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { NotificationProvider } from "~/client/components/notification/NotificationContext";
import type { Zone } from "~/client/api/zonesApi";

afterEach(cleanup);

const { updateZone } = vi.hoisted(() => ({ updateZone: vi.fn() }));
vi.mock("~/client/api/zonesApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/client/api/zonesApi")>();
  return { ...actual, updateZone };
});

const { default: ZoneDetailDialog } =
  await import("~/client/components/dashboard/ZoneDetailDialog");

const theme = createTheme();

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
      last_reading_value: null,
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

function renderDialog(zone: Zone | null, onSaved = vi.fn(), onClose = vi.fn()) {
  return render(
    <ThemeProvider theme={theme}>
      <NotificationProvider>
        <ZoneDetailDialog
          open
          zone={zone}
          onClose={onClose}
          onSaved={onSaved}
        />
      </NotificationProvider>
    </ThemeProvider>,
  );
}

describe("ZoneDetailDialog", () => {
  beforeEach(() => {
    updateZone.mockReset().mockResolvedValue({});
  });

  it("renders nothing when no zone is selected", () => {
    const { container } = renderDialog(null);
    expect(container).toBeEmptyDOMElement();
  });

  it("seeds the form from the zone's existing config", () => {
    renderDialog(
      makeZone({
        config: {
          has_temperature_sensor: true,
          has_occupancy_sensor: false,
          thermal_load_flags: [],
          idle_baseline_position: 80,
          comfort_tolerance: 1.5,
          sensor_calibration_offset: 0.5,
          min_vent_position: 10,
          max_vent_position: 90,
          flair_vent_ids: ["vent-1"],
        },
      }),
    );
    expect(screen.getByLabelText("Idle baseline (0–100%)")).toHaveValue(80);
    expect(screen.getByLabelText(/Comfort tolerance/)).toHaveValue(1.5);
    expect(screen.getByLabelText(/Sensor calibration offset/)).toHaveValue(0.5);
  });

  it("hides position fields for a no_vent zone", () => {
    renderDialog(
      makeZone({
        ventHardwareType: "no_vent",
        config: {
          has_temperature_sensor: true,
          has_occupancy_sensor: false,
          thermal_load_flags: [],
          idle_baseline_position: 100,
          sensor_calibration_offset: 0,
          min_vent_position: 0,
          max_vent_position: 100,
          flair_vent_ids: [],
        },
      }),
    );
    expect(
      screen.queryByLabelText("Idle baseline (0–100%)"),
    ).not.toBeInTheDocument();
  });

  it("saves the edited config and calls onSaved", async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    renderDialog(makeZone(), onSaved, onClose);
    fireEvent.change(screen.getByLabelText("Idle baseline (0–100%)"), {
      target: { value: "60" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => {
      expect(updateZone).toHaveBeenCalledWith(
        "z1",
        expect.objectContaining({
          config: expect.objectContaining({ idle_baseline_position: 60 }),
        }),
      );
      expect(onSaved).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("treats a blank comfort tolerance as unset, not zero", async () => {
    renderDialog(
      makeZone({ config: { ...makeZone().config, comfort_tolerance: 2 } }),
    );
    fireEvent.change(screen.getByLabelText(/Comfort tolerance/), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => {
      expect(updateZone).toHaveBeenCalledWith(
        "z1",
        expect.objectContaining({
          config: expect.objectContaining({ comfort_tolerance: undefined }),
        }),
      );
    });
  });
});

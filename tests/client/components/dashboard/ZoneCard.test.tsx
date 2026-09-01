/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ComponentProps } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { Zone } from "~/client/api/zonesApi";

afterEach(cleanup);

const { revokeOverride } = vi.hoisted(() => ({ revokeOverride: vi.fn() }));
vi.mock("~/client/api/overridesApi", () => ({ revokeOverride }));

const { default: ZoneCard } =
  await import("~/client/components/dashboard/ZoneCard");
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

function renderCard(props: Partial<ComponentProps<typeof ZoneCard>> = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <ZoneCard
        zone={makeZone()}
        tickRecord={undefined}
        activeOverride={undefined}
        onChanged={vi.fn()}
        onEdit={vi.fn()}
        {...props}
      />
    </ThemeProvider>,
  );
}

describe("ZoneCard", () => {
  it("shows the calibrated reading for a sensored zone", () => {
    renderCard();
    expect(screen.getByText("22.5°C")).toBeInTheDocument();
  });

  it("shows the fixed position for a manual vent instead of a reading", () => {
    renderCard({
      zone: makeZone({
        ventHardwareType: "manual_fixed_vent",
        config: {
          has_temperature_sensor: false,
          has_occupancy_sensor: false,
          assumed_fixed_position: 40,
          thermal_load_flags: [],
          idle_baseline_position: 100,
          sensor_calibration_offset: 0,
          min_vent_position: 0,
          max_vent_position: 100,
          flair_vent_ids: [],
        },
      }),
    });
    expect(screen.getByText(/Manual fixed vent \(40%\)/)).toBeInTheDocument();
  });

  it("shows a degraded chip when the zone is degraded", () => {
    renderCard({
      zone: makeZone({
        state: {
          ...makeZone().state,
          vents: [
            {
              flair_vent_id: "vent-1",
              last_reported_position: null,
              degraded: true,
              degraded_since: "2024-01-01T00:00:00.000Z",
              reconcile_attempts: 3,
            },
          ],
        },
      }),
    });
    expect(screen.getByText("Degraded vent")).toBeInTheDocument();
  });

  it("offers 'Set manual override' for a controllable zone with no active override", () => {
    renderCard();
    expect(
      screen.getByRole("button", { name: "Set manual override" }),
    ).toBeInTheDocument();
  });

  it("offers 'Clear override' and revokes it on click when one is active", async () => {
    revokeOverride.mockResolvedValue(undefined);
    const onChanged = vi.fn();
    renderCard({
      activeOverride: {
        id: "mo-1",
        zoneId: "z1",
        config: {
          kind: "position",
          value: 50,
          hold_type: "2h",
          actor: "Martin",
        },
        expiresAtMs: null,
        revokedAtMs: null,
        active: true,
      },
      onChanged,
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear override" }));
    await vi.waitFor(() => {
      expect(revokeOverride).toHaveBeenCalledWith("mo-1");
      expect(onChanged).toHaveBeenCalled();
    });
  });

  it("does not offer manual override controls for a no_vent zone", () => {
    renderCard({
      zone: makeZone({
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
    });
    expect(
      screen.queryByRole("button", { name: "Set manual override" }),
    ).not.toBeInTheDocument();
  });

  it("calls onEdit with the zone when Edit is clicked", () => {
    const onEdit = vi.fn();
    const zone = makeZone();
    renderCard({ zone, onEdit });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledWith(zone);
  });
});

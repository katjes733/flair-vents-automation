/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { DisplayUnitProvider } from "~/client/theme/DisplayUnitProvider";
import type { Zone } from "~/client/api/zonesApi";
import type { AirHandler } from "~/client/api/airHandlersApi";
import type { ScheduleEvent } from "~/client/api/schedulesApi";

afterEach(cleanup);

const { fetchSettings } = vi.hoisted(() => ({ fetchSettings: vi.fn() }));
vi.mock("~/client/api/settingsApi", () => ({ fetchSettings }));

const { default: EventEditorDialog } =
  await import("~/client/components/dashboard/EventEditorDialog");

const theme = createTheme();

function makeZone(overrides: Partial<Zone> = {}): Zone {
  return {
    id: "z1",
    installationId: "inst-1",
    airHandlerId: "ah-1",
    flairRoomId: null,
    name: "Den Front",
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

const ZONES: Zone[] = [
  makeZone({ id: "z1", name: "Den Front" }),
  makeZone({ id: "z2", name: "Martin Bedroom" }),
];

const AIR_HANDLERS: AirHandler[] = [
  {
    id: "ah-1",
    installationId: "inst-1",
    flairZoneId: null,
    name: "Upstairs",
    active: true,
    config: {
      topology_mode: "variable_speed",
      blower_rated_flow_rate_is_estimate: true,
      minimum_aggregate_flow_is_estimate: true,
    },
  },
];

function renderDialog(
  props: Partial<{
    event: ScheduleEvent | null;
    otherEvents: ScheduleEvent[];
    open: boolean;
    onClose: () => void;
    onSave: (e: unknown) => void;
    onDelete: () => void;
  }> = {},
) {
  const onClose = props.onClose ?? vi.fn();
  const onSave = props.onSave ?? vi.fn();
  const onDelete = props.onDelete ?? vi.fn();
  const utils = render(
    <ThemeProvider theme={theme}>
      <DisplayUnitProvider>
        <EventEditorDialog
          open={props.open ?? true}
          zones={ZONES}
          airHandlers={AIR_HANDLERS}
          event={props.event ?? null}
          otherEvents={props.otherEvents ?? []}
          onClose={onClose}
          onSave={onSave}
          onDelete={props.event ? onDelete : undefined}
        />
      </DisplayUnitProvider>
    </ThemeProvider>,
  );
  return { ...utils, onClose, onSave, onDelete };
}

async function addRoom(name: string): Promise<void> {
  const select = screen.getByRole("combobox", {
    name: "Add a room to this event",
  });
  fireEvent.mouseDown(select);
  fireEvent.click(await screen.findByRole("option", { name }));
  fireEvent.click(screen.getByRole("button", { name: "Add room" }));
}

describe("EventEditorDialog", () => {
  beforeEach(() => {
    localStorage.setItem("displayTemperatureUnit", "F");
    fetchSettings.mockReset().mockResolvedValue({
      display_temperature_unit: "F",
      display_airflow_unit: "Lps",
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("defaults a new event to Active, 20:00-07:00, every day, no rooms assigned", () => {
    renderDialog();
    expect(screen.getByRole("switch", { name: "Active" })).toBeChecked();
    expect(screen.getByLabelText("Start time")).toHaveValue("20:00");
    expect(screen.getByLabelText("End time")).toHaveValue("07:00");
    for (const day of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
      expect(screen.getByRole("button", { name: day })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    }
    expect(
      screen.getByRole("combobox", { name: "Add a room to this event" }),
    ).toBeInTheDocument();
  });

  it("Save is disabled while start and end time are equal", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("End time"), {
      target: { value: "20:00" },
    });
    expect(screen.getByRole("button", { name: "Add event" })).toBeDisabled();
    expect(screen.getByText("Must differ from start time")).toBeInTheDocument();
  });

  it("the first room added defaults its setpoints to 72°/68°F", async () => {
    renderDialog();
    await addRoom("Den Front");
    expect(screen.getByLabelText("Cool (°F)")).toHaveValue(72);
    expect(screen.getByLabelText("Heat (°F)")).toHaveValue(68);
    expect(
      screen.getByRole("button", { name: "Add event" }),
    ).not.toBeDisabled(); // already valid — no further edits required
  });

  it("a later room copies whatever the previous room's values currently are", async () => {
    renderDialog();
    await addRoom("Den Front");
    fireEvent.change(screen.getByLabelText("Cool (°F)"), {
      target: { value: "70" },
    });
    fireEvent.change(screen.getByLabelText("Heat (°F)"), {
      target: { value: "65" },
    });

    await addRoom("Martin Bedroom");

    const coolFields = screen.getAllByLabelText("Cool (°F)");
    const heatFields = screen.getAllByLabelText("Heat (°F)");
    expect(coolFields).toHaveLength(2);
    expect(coolFields[1]).toHaveValue(70);
    expect(heatFields[1]).toHaveValue(65);
  });

  it("an inactive event never requires per-room setpoints", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("switch", { name: "Active" }));
    await addRoom("Den Front");

    expect(screen.queryByLabelText("Cool (°F)")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add event" }),
    ).not.toBeDisabled();
  });

  it("removing a room clears it from the assigned list and re-offers it in the add picker", async () => {
    renderDialog();
    await addRoom("Den Front");
    expect(screen.getByLabelText("Cool (°F)")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove Den Front from this event" }),
    );
    expect(screen.queryByLabelText("Cool (°F)")).not.toBeInTheDocument();
    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: "Add a room to this event" }),
    );
    expect(
      await screen.findByRole("option", { name: "Den Front" }),
    ).toBeInTheDocument();
  });

  it("Save builds the request with days_of_week as a bitmask and setpoints converted back to Celsius", async () => {
    const onSave = vi.fn();
    renderDialog({ onSave });
    // Deselect Monday (bit 1) and Wednesday (bit 3), leaving Sun/Tue/Thu/Fri/Sat.
    fireEvent.click(screen.getByRole("button", { name: "Mon" }));
    fireEvent.click(screen.getByRole("button", { name: "Wed" }));

    await addRoom("Den Front");
    fireEvent.change(screen.getByLabelText("Cool (°F)"), {
      target: { value: "71.6" }, // 22°C
    });
    fireEvent.change(screen.getByLabelText("Heat (°F)"), {
      target: { value: "68" }, // 20°C
    });

    fireEvent.click(screen.getByRole("button", { name: "Add event" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const request = onSave.mock.calls[0][0];
    expect(request.days_of_week).toBe(0b1110101); // Sun,Tue,Thu,Fri,Sat (Mon/Wed cleared)
    expect(request.zone_settings).toHaveLength(1);
    expect(request.zone_settings[0].zone_id).toBe("z1");
    expect(request.zone_settings[0].cool_setpoint).toBeCloseTo(22, 1);
    expect(request.zone_settings[0].heat_setpoint).toBeCloseTo(20, 1);
    expect(request.zone_priority_order).toEqual(["z1"]);
    expect(request.driving_zone_overrides).toBeUndefined();
  });

  it("zone_priority_order is derived from room order, and the up/down arrows change it", async () => {
    const onSave = vi.fn();
    renderDialog({ onSave });
    await addRoom("Den Front");
    await addRoom("Martin Bedroom");

    // Den Front was added first, so it's currently ranked first.
    fireEvent.click(
      screen.getByRole("button", { name: "Move Martin Bedroom up" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Add event" }));
    const request = onSave.mock.calls[0][0];
    expect(request.zone_priority_order).toEqual(["z2", "z1"]);
  });

  it("seeds every field from an existing event, including converting stored Celsius setpoints to the active display unit", () => {
    const event: ScheduleEvent = {
      id: "ev-1",
      created_at: "2024-01-01T00:00:00.000Z",
      modified_at: "2024-01-01T00:00:00.000Z",
      mode: "active",
      start_time: "22:00",
      end_time: "06:00",
      days_of_week: 0b0100010, // Mon, Fri
      zone_settings: [
        {
          zone_id: "z1",
          cool_setpoint: 21.11, // ~70°F
          heat_setpoint: 18.89, // ~66°F
          comfort_tolerance: 0.56, // ~1°F
          assume_occupied: true,
        },
      ],
    };
    renderDialog({ event });

    expect(screen.getByLabelText("Start time")).toHaveValue("22:00");
    expect(screen.getByLabelText("End time")).toHaveValue("06:00");
    expect(screen.getByRole("button", { name: "Mon" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Tue" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByLabelText("Cool (°F)")).toHaveValue(70);
    expect(screen.getByLabelText("Heat (°F)")).toHaveValue(66);
    expect(screen.getByLabelText("Tolerance, °F")).toHaveValue(1.01);
    expect(screen.getByRole("checkbox", { name: "Sleep Mode" })).toBeChecked();
  });

  it("the Advanced section is collapsed by default and reveals only the driving-zone picker", () => {
    renderDialog();
    expect(
      screen.queryByRole("combobox", { name: "Driving zone — Upstairs" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show advanced" }));
    expect(
      screen.getByRole("combobox", { name: "Driving zone — Upstairs" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/priority/i)).not.toBeInTheDocument();
  });

  it("setting a driving-zone override includes it in the saved request", async () => {
    const onSave = vi.fn();
    renderDialog({ onSave });
    fireEvent.click(screen.getByRole("button", { name: "Show advanced" }));
    const picker = screen.getByRole("combobox", {
      name: "Driving zone — Upstairs",
    });
    fireEvent.mouseDown(picker);
    fireEvent.click(
      await screen.findByRole("option", { name: "Martin Bedroom" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Add event" }));

    const request = onSave.mock.calls[0][0];
    expect(request.driving_zone_overrides).toEqual({ "ah-1": "z2" });
  });

  describe("overlap detection", () => {
    const CONFLICTING_EVENT: ScheduleEvent = {
      id: "ev-conflict",
      created_at: "2024-01-01T00:00:00.000Z",
      modified_at: "2024-01-01T00:00:00.000Z",
      mode: "active",
      start_time: "22:00",
      end_time: "23:00",
      days_of_week: 0b0000001, // Sunday
      zone_settings: [
        {
          zone_id: "z1",
          cool_setpoint: 22,
          heat_setpoint: 20,
          assume_occupied: false,
        },
      ],
    };

    it("shows a warning when the draft shares a room and overlapping time with an existing event", async () => {
      renderDialog({ otherEvents: [CONFLICTING_EVENT] });
      await addRoom("Den Front"); // z1 — same zone as CONFLICTING_EVENT
      expect(
        screen.getByText("Overlaps with 1 existing period"),
      ).toBeInTheDocument();
      expect(screen.getByText(/22:00–23:00/)).toBeInTheDocument();
    });

    it("shows no warning when no room is shared with the conflicting event", async () => {
      renderDialog({ otherEvents: [CONFLICTING_EVENT] });
      await addRoom("Martin Bedroom"); // z2 — CONFLICTING_EVENT only covers z1
      expect(screen.queryByText(/Overlaps with/)).not.toBeInTheDocument();
    });

    it("Save requires an explicit confirm step when an overlap exists, and doesn't save on the first click", async () => {
      const onSave = vi.fn();
      renderDialog({ onSave, otherEvents: [CONFLICTING_EVENT] });
      await addRoom("Den Front");
      fireEvent.click(screen.getByRole("button", { name: "Add event" }));
      expect(onSave).not.toHaveBeenCalled();
      expect(
        screen.getByText("Save despite the overlap above?"),
      ).toBeInTheDocument();
    });

    it('"Save anyway" commits the save after the confirm step', async () => {
      const onSave = vi.fn();
      renderDialog({ onSave, otherEvents: [CONFLICTING_EVENT] });
      await addRoom("Den Front");
      fireEvent.click(screen.getByRole("button", { name: "Add event" }));
      fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it('"Back" returns to the normal Save button without saving', async () => {
      const onSave = vi.fn();
      renderDialog({ onSave, otherEvents: [CONFLICTING_EVENT] });
      await addRoom("Den Front");
      fireEvent.click(screen.getByRole("button", { name: "Add event" }));
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(onSave).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Add event" }),
      ).toBeInTheDocument();
    });

    it("saves immediately with no confirm step when there is no overlap", async () => {
      const onSave = vi.fn();
      renderDialog({ onSave });
      await addRoom("Den Front");
      fireEvent.click(screen.getByRole("button", { name: "Add event" }));
      expect(onSave).toHaveBeenCalledTimes(1);
    });
  });

  describe("deleting an event", () => {
    const EXISTING_EVENT: ScheduleEvent = {
      id: "ev-1",
      created_at: "2024-01-01T00:00:00.000Z",
      modified_at: "2024-01-01T00:00:00.000Z",
      mode: "active",
      start_time: "20:00",
      end_time: "07:00",
      days_of_week: 0b1111111,
      zone_settings: [],
    };

    it("offers no delete option when creating a new event", () => {
      renderDialog({ event: null });
      expect(
        screen.queryByRole("button", { name: "Delete event" }),
      ).not.toBeInTheDocument();
    });

    it("asks for confirmation before deleting an existing event", () => {
      const { onDelete } = renderDialog({ event: EXISTING_EVENT });
      fireEvent.click(screen.getByRole("button", { name: "Delete event" }));
      expect(screen.getByText("Delete this event?")).toBeInTheDocument();
      expect(onDelete).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
      expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it("Cancel on the delete confirmation leaves the event untouched", () => {
      const { onDelete } = renderDialog({ event: EXISTING_EVENT });
      fireEvent.click(screen.getByRole("button", { name: "Delete event" }));
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByText("Delete this event?")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Save event" }),
      ).toBeInTheDocument();
      expect(onDelete).not.toHaveBeenCalled();
    });
  });
});

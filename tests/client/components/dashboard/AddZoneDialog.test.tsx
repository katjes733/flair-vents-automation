/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { NotificationProvider } from "~/client/components/notification/NotificationContext";
import type { AirHandler } from "~/client/api/airHandlersApi";

afterEach(cleanup);

const { createZone } = vi.hoisted(() => ({ createZone: vi.fn() }));
vi.mock("~/client/api/zonesApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/client/api/zonesApi")>();
  return { ...actual, createZone };
});

const { default: AddZoneDialog } =
  await import("~/client/components/dashboard/AddZoneDialog");

const theme = createTheme();
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

function renderDialog(onCreated = vi.fn(), onClose = vi.fn(), open = true) {
  return render(
    <ThemeProvider theme={theme}>
      <NotificationProvider>
        <AddZoneDialog
          open={open}
          airHandlers={AIR_HANDLERS}
          onClose={onClose}
          onCreated={onCreated}
        />
      </NotificationProvider>
    </ThemeProvider>,
  );
}

describe("AddZoneDialog", () => {
  beforeEach(() => {
    createZone.mockReset().mockResolvedValue({ id: "z1" });
  });

  it("requires a fixed position for a manual_fixed_vent, not for a smart vent", async () => {
    const user = userEvent.setup();
    renderDialog();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Office" },
    });
    fireEvent.change(screen.getByLabelText("Flair vent ID 1"), {
      target: { value: "vent-1" },
    });
    // Default hardware type is flair_smart_vent — Create should be enabled
    // once a name and at least one vent id are entered.
    expect(screen.getByRole("button", { name: "Create" })).not.toBeDisabled();

    // MUI's <TextField select> renders a listbox, not a native <select> —
    // interact with it the way a user actually would: open it, then pick
    // the option. getByRole("combobox") resolves reliably here;
    // getByLabelText does not, for reasons specific to how MUI wires up
    // the label association on this element.
    await user.click(
      screen.getByRole("combobox", { name: "Vent hardware type" }),
    );
    await user.click(
      await screen.findByRole("option", { name: "Manual fixed vent" }),
    );
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Position 1"), {
      target: { value: "40" },
    });
    expect(screen.getByRole("button", { name: "Create" })).not.toBeDisabled();
  });

  // Regression coverage for modeling a real gap: a manual_fixed_vent
  // zone's vents can each sit at a genuinely different position (a real
  // house confirmed both its bathrooms and its Den back each have 2 — see
  // manual_vents in zoneConfig.ts).
  it("submits each manual vent's own position and duct rating, and resets to a single blank row for other types", async () => {
    const onCreated = vi.fn();
    const user = userEvent.setup();
    renderDialog(onCreated);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Guest Bath" },
    });

    await user.click(
      screen.getByRole("combobox", { name: "Vent hardware type" }),
    );
    await user.click(
      await screen.findByRole("option", { name: "Manual fixed vent" }),
    );
    expect(screen.getByLabelText("Position 1")).toHaveValue(null);

    fireEvent.change(screen.getByLabelText("Position 1"), {
      target: { value: "75" },
    });
    await user.click(screen.getByRole("button", { name: "Add another vent" }));
    fireEvent.change(screen.getByLabelText("Position 2"), {
      target: { value: "25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await vi.waitFor(() => {
      expect(createZone).toHaveBeenCalledWith(
        expect.objectContaining({
          vent_hardware_type: "manual_fixed_vent",
          config: expect.objectContaining({
            manual_vents: [{ position: 75 }, { position: 25 }],
          }),
        }),
      );
      expect(onCreated).toHaveBeenCalled();
    });
  });

  it("does not show a manual-vent position field for a flair_smart_vent zone", () => {
    renderDialog();
    expect(screen.queryByLabelText(/Position 1/)).not.toBeInTheDocument();
  });

  it("submits the expected payload for a smart vent with a Flair room id", async () => {
    const onCreated = vi.fn();
    renderDialog(onCreated);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Office" },
    });
    fireEvent.change(screen.getByLabelText("Flair room ID (optional)"), {
      target: { value: "room-123" },
    });
    fireEvent.change(screen.getByLabelText("Flair vent ID 1"), {
      target: { value: "vent-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await vi.waitFor(() => {
      expect(createZone).toHaveBeenCalledWith(
        expect.objectContaining({
          air_handler_id: "ah-1",
          name: "Office",
          vent_hardware_type: "flair_smart_vent",
          flair_room_id: "room-123",
          config: expect.objectContaining({
            flair_vents: [{ flair_vent_id: "vent-1" }],
          }),
        }),
      );
      expect(onCreated).toHaveBeenCalled();
    });
  });

  // Regression coverage for extending per-vent duct ratings from manual
  // vents to flair_smart_vent zones (see "Multi-Vent Manual Zones").
  it("submits a flair vent's own id and rating", async () => {
    const onCreated = vi.fn();
    renderDialog(onCreated);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Den Front" },
    });
    fireEvent.change(screen.getByLabelText("Flair vent ID 1"), {
      target: { value: "vent-a" },
    });
    fireEvent.change(screen.getByLabelText("Rating 1, L/s"), {
      target: { value: "94.4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await vi.waitFor(() => {
      expect(createZone).toHaveBeenCalledWith(
        expect.objectContaining({
          vent_hardware_type: "flair_smart_vent",
          config: expect.objectContaining({
            flair_vents: [
              { flair_vent_id: "vent-a", duct_flow_rate_lps: 94.4 },
            ],
          }),
        }),
      );
      expect(onCreated).toHaveBeenCalled();
    });
  });

  // Regression coverage: unlike manual vents, a Flair vent's id is Flair's
  // own opaque identifier — not something a user would type from memory —
  // so this dialog deliberately offers no way to add a second row for a
  // flair_smart_vent zone. See RepeatableFlairVentField's own comment.
  it("does not offer 'Add another vent' for a flair_smart_vent zone", () => {
    renderDialog();
    expect(
      screen.queryByRole("button", { name: "Add another vent" }),
    ).not.toBeInTheDocument();
  });

  // Regression coverage for the "pick a vent size" ergonomics improvement
  // (see docs/hvac-pressure-research.md's "Register Size to Airflow
  // Rating") — applies identically to manual and flair vents.
  it("autofills a vent's airflow rating from a picked size, still overridable", async () => {
    const user = userEvent.setup();
    renderDialog();
    fireEvent.change(screen.getByLabelText("Flair vent ID 1"), {
      target: { value: "vent-a" },
    });
    await user.click(screen.getByRole("combobox", { name: "Vent size" }));
    await user.click(await screen.findByRole("option", { name: "12x12" }));
    expect(screen.getByLabelText("Rating 1, L/s")).toHaveValue(221.8);

    fireEvent.change(screen.getByLabelText("Rating 1, L/s"), {
      target: { value: "200" },
    });
    expect(screen.getByLabelText("Rating 1, L/s")).toHaveValue(200);
  });

  it("shows the server's error message on failure", async () => {
    createZone.mockRejectedValue({
      response: { data: { error: "Zone name already in use" } },
    });
    renderDialog();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Office" },
    });
    fireEvent.change(screen.getByLabelText("Flair vent ID 1"), {
      target: { value: "vent-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText("Zone name already in use");
  });

  // Regression test: this dialog stays mounted between opens (DashboardPage
  // just toggles `open`) — without a reset on the closed→open transition,
  // a cancelled or failed attempt's leftover input (or a previous
  // successful one's, before this fix) stayed there the next time it was
  // opened. Confirmed live by the user against a real duplicate-name
  // failure.
  it("clears every field on reopen, after either a cancel or a failed attempt", async () => {
    createZone.mockRejectedValue({
      response: {
        data: {
          error:
            'A zone named "Luke Bathroom" already exists on this air handler.',
        },
      },
    });
    const { rerender } = renderDialog(vi.fn(), vi.fn(), true);
    const rerenderOpen = (open: boolean) =>
      rerender(
        <ThemeProvider theme={theme}>
          <NotificationProvider>
            <AddZoneDialog
              open={open}
              airHandlers={AIR_HANDLERS}
              onClose={vi.fn()}
              onCreated={vi.fn()}
            />
          </NotificationProvider>
        </ThemeProvider>,
      );

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Luke Bathroom" },
    });
    fireEvent.change(screen.getByLabelText("Flair vent ID 1"), {
      target: { value: "vent-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText(/already exists on this air handler/);

    // Simulate closing (DashboardPage sets open=false) and reopening.
    rerenderOpen(false);
    rerenderOpen(true);

    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByLabelText("Flair vent ID 1")).toHaveValue("");
    expect(
      screen.queryByText(/already exists on this air handler/),
    ).not.toBeInTheDocument();
  });
});

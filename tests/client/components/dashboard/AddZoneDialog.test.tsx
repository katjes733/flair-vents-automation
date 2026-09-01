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

function renderDialog(onCreated = vi.fn(), onClose = vi.fn()) {
  return render(
    <ThemeProvider theme={theme}>
      <NotificationProvider>
        <AddZoneDialog
          open
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

    fireEvent.change(screen.getByLabelText("Fixed position (0–100%)"), {
      target: { value: "40" },
    });
    expect(screen.getByRole("button", { name: "Create" })).not.toBeDisabled();
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
          config: expect.objectContaining({ flair_vent_ids: ["vent-1"] }),
        }),
      );
      expect(onCreated).toHaveBeenCalled();
    });
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
});

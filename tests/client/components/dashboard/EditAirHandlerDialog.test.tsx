/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { NotificationProvider } from "~/client/components/notification/NotificationContext";
import type { AirHandler } from "~/client/api/airHandlersApi";

afterEach(cleanup);

const { updateAirHandler, deleteAirHandler, fetchAvailableFlairZones } =
  vi.hoisted(() => ({
    updateAirHandler: vi.fn(),
    deleteAirHandler: vi.fn(),
    fetchAvailableFlairZones: vi.fn(),
  }));
vi.mock("~/client/api/airHandlersApi", () => ({
  updateAirHandler,
  deleteAirHandler,
  fetchAvailableFlairZones,
}));

const { useSession } = vi.hoisted(() => ({ useSession: vi.fn() }));
vi.mock("~/client/session/useSession", () => ({ useSession }));

const { default: EditAirHandlerDialog } =
  await import("~/client/components/dashboard/EditAirHandlerDialog");

const theme = createTheme();

const AIR_HANDLER: AirHandler = {
  id: "ah-1",
  installationId: "inst-1",
  flairZoneId: null,
  name: "Upstairs",
  active: true,
  config: {
    topology_mode: "variable_speed",
    setpoint_delivery_mode: "flair",
    tonnage_tons: 5,
    blower_rated_flow_rate_is_estimate: true,
    minimum_aggregate_flow_is_estimate: true,
  },
};

function renderDialog(
  airHandler: AirHandler | null = AIR_HANDLER,
  onSaved = vi.fn(),
  onDeleted = vi.fn(),
) {
  return render(
    <ThemeProvider theme={theme}>
      <NotificationProvider>
        <EditAirHandlerDialog
          open
          airHandler={airHandler}
          onClose={vi.fn()}
          onSaved={onSaved}
          onDeleted={onDeleted}
        />
      </NotificationProvider>
    </ThemeProvider>,
  );
}

describe("EditAirHandlerDialog", () => {
  beforeEach(() => {
    useSession.mockReturnValue({ user: { profile: "admin", role: "owner" } });
    updateAirHandler.mockReset().mockResolvedValue({});
    deleteAirHandler.mockReset().mockResolvedValue(undefined);
    fetchAvailableFlairZones.mockReset().mockResolvedValue([
      {
        id: "flair-zone-123",
        name: "Upstairs (Flair)",
        assignedAirHandlerId: null,
        assignedAirHandlerName: null,
      },
    ]);
  });

  it("renders nothing when no air handler is selected", () => {
    const { container } = renderDialog(null);
    expect(container).toBeEmptyDOMElement();
  });

  it("disables Save and Delete for a read profile", async () => {
    useSession.mockReturnValue({ user: { profile: "read", role: "read" } });
    renderDialog();
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("seeds the form from the air handler's existing fields", async () => {
    renderDialog();
    expect(screen.getByLabelText("Name")).toHaveValue("Upstairs");
    expect(screen.getByLabelText("Tonnage (tons)")).toHaveValue(5);
    // The picker briefly renders its own "loading" combobox under the same
    // accessible name before the fetch resolves — wait for the real text,
    // not just for a combobox with that name to exist.
    await vi.waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: "Flair zone" }),
      ).toHaveTextContent("None (not linked yet)");
    });
  });

  it("seeds the away-override fields from the air handler's config, converted to the (bare-default Celsius) display unit", async () => {
    renderDialog({
      ...AIR_HANDLER,
      config: {
        ...AIR_HANDLER.config,
        away_setpoint_cool_override: 26,
        away_setpoint_heat_override: 16,
        away_tolerance_override: 3,
      },
    });
    expect(screen.getByLabelText(/Away cooling setpoint override/)).toHaveValue(
      26,
    );
    expect(screen.getByLabelText(/Away heating setpoint override/)).toHaveValue(
      16,
    );
    expect(screen.getByLabelText(/Away tolerance override/)).toHaveValue(3);
  });

  it("leaves the away-override fields blank when unset", () => {
    renderDialog();
    expect(screen.getByLabelText(/Away cooling setpoint override/)).toHaveValue(
      null,
    );
    expect(screen.getByLabelText(/Away heating setpoint override/)).toHaveValue(
      null,
    );
    expect(screen.getByLabelText(/Away tolerance override/)).toHaveValue(null);
  });

  it("saves a newly-entered away-override value", async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText(/Away cooling setpoint override/), {
      target: { value: "26" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => {
      expect(updateAirHandler).toHaveBeenCalledWith(
        "ah-1",
        expect.objectContaining({
          config: expect.objectContaining({
            away_setpoint_cool_override: 26,
            away_setpoint_heat_override: null,
            away_tolerance_override: null,
          }),
        }),
      );
    });
  });

  it("clears a previously-set away-override back to null (not an omitted key) when blanked", async () => {
    renderDialog({
      ...AIR_HANDLER,
      config: { ...AIR_HANDLER.config, away_tolerance_override: 3 },
    });
    fireEvent.change(screen.getByLabelText(/Away tolerance override/), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => {
      const patch = updateAirHandler.mock.calls[0][1];
      expect(patch.config).toHaveProperty("away_tolerance_override", null);
    });
  });

  it("saves edited fields, including adding a Flair zone id after the fact", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderDialog(AIR_HANDLER, onSaved);
    await user.click(
      await screen.findByRole("combobox", { name: "Flair zone" }),
    );
    await user.click(
      await screen.findByRole("option", { name: "Upstairs (Flair)" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => {
      expect(updateAirHandler).toHaveBeenCalledWith(
        "ah-1",
        expect.objectContaining({ flair_zone_id: "flair-zone-123" }),
      );
      expect(onSaved).toHaveBeenCalled();
    });
  });

  it("requires an explicit confirm before deleting", async () => {
    const onDeleted = vi.fn();
    renderDialog(AIR_HANDLER, vi.fn(), onDeleted);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteAirHandler).not.toHaveBeenCalled();

    const confirmButtons = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    await vi.waitFor(() => {
      expect(deleteAirHandler).toHaveBeenCalledWith("ah-1");
      expect(onDeleted).toHaveBeenCalled();
    });
  });

  it("shows the server's referential-integrity error without closing on a failed delete", async () => {
    deleteAirHandler.mockRejectedValue({
      response: { data: { error: "still has zone(s): Bedroom" } },
    });
    const onDeleted = vi.fn();
    renderDialog(AIR_HANDLER, vi.fn(), onDeleted);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const confirmButtons = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    await screen.findByText(/still has zone\(s\): Bedroom/);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("defaults the Setpoint delivery field to Flair API and hides both HomeKit buttons", () => {
    renderDialog();
    expect(
      screen.getByRole("combobox", { name: "Setpoint delivery" }),
    ).toHaveTextContent("Flair API");
    expect(
      screen.queryByRole("button", { name: "Set up HomeKit pairing" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Match HomeKit Sensors" }),
    ).not.toBeInTheDocument();
  });

  it("reveals the HomeKit pairing and sensor-matching buttons when Direct (HomeKit) is selected", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(
      screen.getByRole("combobox", { name: "Setpoint delivery" }),
    );
    await user.click(
      await screen.findByRole("option", { name: "Direct (HomeKit)" }),
    );
    expect(
      screen.getByRole("button", { name: "Set up HomeKit pairing" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Match HomeKit Sensors" }),
    ).toBeInTheDocument();
  });

  it("saves the selected setpoint delivery mode", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(
      screen.getByRole("combobox", { name: "Setpoint delivery" }),
    );
    await user.click(
      await screen.findByRole("option", { name: "Direct (HomeKit)" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => {
      expect(updateAirHandler).toHaveBeenCalledWith(
        "ah-1",
        expect.objectContaining({
          config: expect.objectContaining({
            setpoint_delivery_mode: "homekit",
          }),
        }),
      );
    });
  });
});

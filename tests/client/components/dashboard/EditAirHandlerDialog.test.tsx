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
});

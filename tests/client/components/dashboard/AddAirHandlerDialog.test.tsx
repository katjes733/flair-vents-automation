/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { NotificationProvider } from "~/client/components/notification/NotificationContext";

afterEach(cleanup);

const { createAirHandler, fetchAvailableFlairZones } = vi.hoisted(() => ({
  createAirHandler: vi.fn(),
  fetchAvailableFlairZones: vi.fn(),
}));
vi.mock("~/client/api/airHandlersApi", () => ({
  createAirHandler,
  fetchAvailableFlairZones,
}));

const { default: AddAirHandlerDialog } =
  await import("~/client/components/dashboard/AddAirHandlerDialog");

const theme = createTheme();

function renderDialog(onCreated = vi.fn(), onClose = vi.fn(), open = true) {
  return render(
    <ThemeProvider theme={theme}>
      <NotificationProvider>
        <AddAirHandlerDialog
          open={open}
          onClose={onClose}
          onCreated={onCreated}
        />
      </NotificationProvider>
    </ThemeProvider>,
  );
}

describe("AddAirHandlerDialog", () => {
  beforeEach(() => {
    createAirHandler.mockReset().mockResolvedValue({ id: "ah-1" });
    fetchAvailableFlairZones.mockReset().mockResolvedValue([
      {
        id: "flair-zone-1",
        name: "Upstairs",
        assignedAirHandlerId: null,
        assignedAirHandlerName: null,
      },
    ]);
  });

  it("disables Create until a name is entered", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Upstairs" },
    });
    expect(screen.getByRole("button", { name: "Create" })).not.toBeDisabled();
  });

  it("submits name/tonnage/flair zone id and calls onCreated + onClose", async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    renderDialog(onCreated, onClose);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Upstairs" },
    });
    fireEvent.change(screen.getByLabelText("Tonnage (tons)"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await vi.waitFor(() => {
      expect(createAirHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Upstairs",
          active: true,
          config: { tonnage_tons: 5 },
        }),
      );
      expect(onCreated).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("lets you pick a Flair zone by name instead of typing its raw id", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    renderDialog(onCreated);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Upstairs" },
    });

    // MUI's <TextField select> renders a listbox, not a native <select> —
    // getByRole("combobox") + userEvent is the reliable way to drive it
    // (see AddZoneDialog.test.tsx for the same established pattern).
    await user.click(
      await screen.findByRole("combobox", { name: "Flair zone" }),
    );
    await user.click(await screen.findByRole("option", { name: "Upstairs" }));

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await vi.waitFor(() => {
      expect(createAirHandler).toHaveBeenCalledWith(
        expect.objectContaining({ flair_zone_id: "flair-zone-1" }),
      );
      expect(onCreated).toHaveBeenCalled();
    });
  });

  it("disables an already-assigned Flair zone in the picker", async () => {
    fetchAvailableFlairZones.mockResolvedValue([
      {
        id: "flair-zone-1",
        name: "Upstairs",
        assignedAirHandlerId: "ah-other",
        assignedAirHandlerName: "Downstairs",
      },
    ]);
    const user = userEvent.setup();
    renderDialog();
    await user.click(
      await screen.findByRole("combobox", { name: "Flair zone" }),
    );
    const option = await screen.findByRole("option", {
      name: /Upstairs.*assigned to Downstairs/,
    });
    expect(option).toHaveAttribute("aria-disabled", "true");
  });

  it("shows the server's error message on failure without closing", async () => {
    createAirHandler.mockRejectedValue({
      response: { data: { error: "tonnage_tons is required" } },
    });
    const onClose = vi.fn();
    renderDialog(vi.fn(), onClose);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Upstairs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText("tonnage_tons is required");
    expect(onClose).not.toHaveBeenCalled();
  });

  // Regression test: same bug/fix as AddZoneDialog.test.tsx — this dialog
  // stays mounted between opens, so a failed attempt's leftover input
  // used to survive to the next open.
  it("clears every field on reopen after a failed attempt", async () => {
    createAirHandler.mockRejectedValue({
      response: { data: { error: "tonnage_tons is required" } },
    });
    const { rerender } = renderDialog(vi.fn(), vi.fn(), true);
    const rerenderOpen = (open: boolean) =>
      rerender(
        <ThemeProvider theme={theme}>
          <NotificationProvider>
            <AddAirHandlerDialog
              open={open}
              onClose={vi.fn()}
              onCreated={vi.fn()}
            />
          </NotificationProvider>
        </ThemeProvider>,
      );

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Upstairs" },
    });
    fireEvent.change(screen.getByLabelText("Tonnage (tons)"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText("tonnage_tons is required");

    rerenderOpen(false);
    rerenderOpen(true);

    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByLabelText("Tonnage (tons)")).toHaveValue(null);
    expect(
      screen.queryByText("tonnage_tons is required"),
    ).not.toBeInTheDocument();
  });
});

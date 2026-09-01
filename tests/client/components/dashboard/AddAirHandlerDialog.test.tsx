/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { NotificationProvider } from "~/client/components/notification/NotificationContext";

afterEach(cleanup);

const { createAirHandler } = vi.hoisted(() => ({ createAirHandler: vi.fn() }));
vi.mock("~/client/api/airHandlersApi", () => ({ createAirHandler }));

const { default: AddAirHandlerDialog } =
  await import("~/client/components/dashboard/AddAirHandlerDialog");

const theme = createTheme();

function renderDialog(onCreated = vi.fn(), onClose = vi.fn()) {
  return render(
    <ThemeProvider theme={theme}>
      <NotificationProvider>
        <AddAirHandlerDialog open onClose={onClose} onCreated={onCreated} />
      </NotificationProvider>
    </ThemeProvider>,
  );
}

describe("AddAirHandlerDialog", () => {
  beforeEach(() => {
    createAirHandler.mockReset().mockResolvedValue({ id: "ah-1" });
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
});

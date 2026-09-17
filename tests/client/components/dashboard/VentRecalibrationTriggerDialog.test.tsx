/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { NotificationProvider } from "~/client/components/notification/NotificationContext";

afterEach(cleanup);

const { triggerVentRecalibration } = vi.hoisted(() => ({
  triggerVentRecalibration: vi.fn(),
}));
vi.mock("~/client/api/zonesApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/client/api/zonesApi")>();
  return { ...actual, triggerVentRecalibration };
});

const { default: VentRecalibrationTriggerDialog } =
  await import("~/client/components/dashboard/VentRecalibrationTriggerDialog");

const theme = createTheme();

function renderDialog({
  zoneChronic = true,
  onClose = vi.fn(),
  onTriggered = vi.fn(),
}: {
  zoneChronic?: boolean;
  onClose?: () => void;
  onTriggered?: () => void;
} = {}) {
  render(
    <ThemeProvider theme={theme}>
      <NotificationProvider>
        <VentRecalibrationTriggerDialog
          open
          zoneId="z1"
          zoneName="Bedroom"
          zoneChronic={zoneChronic}
          onClose={onClose}
          onTriggered={onTriggered}
        />
      </NotificationProvider>
    </ThemeProvider>,
  );
  return { onClose, onTriggered };
}

describe("VentRecalibrationTriggerDialog", () => {
  beforeEach(() => {
    triggerVentRecalibration.mockReset().mockResolvedValue(undefined);
  });

  it("shows the not-currently-chronic warning when the zone isn't flagged", () => {
    renderDialog({ zoneChronic: false });
    expect(
      screen.getByText(/isn't currently flagged as having a recurring issue/),
    ).toBeInTheDocument();
  });

  it("omits the not-currently-chronic warning when the zone is already flagged", () => {
    renderDialog({ zoneChronic: true });
    expect(
      screen.queryByText(/isn't currently flagged as having a recurring issue/),
    ).not.toBeInTheDocument();
  });

  it("triggers recalibration, notifies success, and closes", async () => {
    const { onClose, onTriggered } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Unstick vent" }));

    await screen.findByText(
      "Recalibration requested for Bedroom — usually resolves within a couple of minutes.",
    );
    expect(triggerVentRecalibration).toHaveBeenCalledWith("z1");
    expect(onTriggered).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the server's own error and does not close or notify on failure", async () => {
    triggerVentRecalibration.mockRejectedValueOnce({
      response: {
        data: {
          error: "A recalibration cycle is already in progress for this zone.",
        },
      },
    });
    const { onClose, onTriggered } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Unstick vent" }));

    await screen.findByText(
      "A recalibration cycle is already in progress for this zone.",
    );
    expect(onTriggered).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Unstick vent" }),
    ).not.toBeDisabled();
  });

  it("falls back to a generic error message when the failure carries no server text", async () => {
    triggerVentRecalibration.mockRejectedValueOnce(new Error("network error"));
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Unstick vent" }));

    await screen.findByText("Couldn't request a recalibration — try again.");
  });
});

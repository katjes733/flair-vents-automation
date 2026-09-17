/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { NotificationProvider } from "~/client/components/notification/NotificationContext";

afterEach(cleanup);

const { clearVentMisalignmentWarning } = vi.hoisted(() => ({
  clearVentMisalignmentWarning: vi.fn(),
}));
vi.mock("~/client/api/zonesApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/client/api/zonesApi")>();
  return { ...actual, clearVentMisalignmentWarning };
});

const { default: VentMisalignmentClearWarningDialog } =
  await import("~/client/components/dashboard/VentMisalignmentClearWarningDialog");

const theme = createTheme();

function renderDialog({
  onClose = vi.fn(),
  onCleared = vi.fn(),
}: { onClose?: () => void; onCleared?: () => void } = {}) {
  render(
    <ThemeProvider theme={theme}>
      <NotificationProvider>
        <VentMisalignmentClearWarningDialog
          open
          zoneId="z1"
          zoneName="Bedroom"
          onClose={onClose}
          onCleared={onCleared}
        />
      </NotificationProvider>
    </ThemeProvider>,
  );
  return { onClose, onCleared };
}

describe("VentMisalignmentClearWarningDialog", () => {
  beforeEach(() => {
    clearVentMisalignmentWarning.mockReset().mockResolvedValue(undefined);
  });

  it("clears the warning, notifies success, and closes", async () => {
    const { onClose, onCleared } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Clear warning" }));

    await screen.findByText("Cleared the vent warning for Bedroom.");
    expect(clearVentMisalignmentWarning).toHaveBeenCalledWith("z1");
    expect(onCleared).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows an error and does not close or notify on failure", async () => {
    clearVentMisalignmentWarning.mockRejectedValueOnce(new Error("network"));
    const { onClose, onCleared } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Clear warning" }));

    await screen.findByText("Couldn't clear the warning — try again.");
    expect(onCleared).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { NotificationProvider } from "~/client/components/notification/NotificationContext";

afterEach(cleanup);

const {
  fetchHomeKitStatus,
  discoverHomeKitAccessories,
  pairHomeKitAccessory,
  unpairHomeKitAccessory,
} = vi.hoisted(() => ({
  fetchHomeKitStatus: vi.fn(),
  discoverHomeKitAccessories: vi.fn(),
  pairHomeKitAccessory: vi.fn(),
  unpairHomeKitAccessory: vi.fn(),
}));
vi.mock("~/client/api/homekitApi", () => ({
  fetchHomeKitStatus,
  discoverHomeKitAccessories,
  pairHomeKitAccessory,
  unpairHomeKitAccessory,
}));

const { useSession } = vi.hoisted(() => ({ useSession: vi.fn() }));
vi.mock("~/client/session/useSession", () => ({ useSession }));

const { default: HomeKitPairingDialog } =
  await import("~/client/components/dashboard/HomeKitPairingDialog");

const theme = createTheme();

function renderDialog(onClose = vi.fn()) {
  return render(
    <ThemeProvider theme={theme}>
      <NotificationProvider>
        <HomeKitPairingDialog
          open
          airHandlerId="ah-1"
          airHandlerName="Upstairs"
          onClose={onClose}
        />
      </NotificationProvider>
    </ThemeProvider>,
  );
}

describe("HomeKitPairingDialog", () => {
  beforeEach(() => {
    useSession.mockReturnValue({ user: { profile: "admin", role: "owner" } });
    fetchHomeKitStatus.mockReset();
    discoverHomeKitAccessories.mockReset();
    pairHomeKitAccessory.mockReset().mockResolvedValue(undefined);
    unpairHomeKitAccessory.mockReset().mockResolvedValue(undefined);
  });

  it("shows a Discover action when unpaired", async () => {
    fetchHomeKitStatus.mockResolvedValue({ paired: false });
    renderDialog();
    expect(await screen.findByText(/Not paired/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Discover" }),
    ).toBeInTheDocument();
  });

  it("auto-selects the accessory when discovery finds exactly one, then pairs with a typed code", async () => {
    fetchHomeKitStatus.mockResolvedValue({ paired: false });
    discoverHomeKitAccessories.mockResolvedValue([
      { name: "Upstairs", accessoryId: "AA:BB:CC" },
    ]);
    const user = userEvent.setup();
    renderDialog();
    await screen.findByRole("button", { name: "Discover" });
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));
    await screen.findByLabelText("Setup code");

    await user.type(screen.getByLabelText("Setup code"), "12345678");
    expect(screen.getByLabelText("Setup code")).toHaveValue("123-45-678");

    fetchHomeKitStatus.mockResolvedValue({
      paired: true,
      accessoryId: "AA:BB:CC",
      reachable: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));
    await vi.waitFor(() => {
      expect(pairHomeKitAccessory).toHaveBeenCalledWith(
        "ah-1",
        "AA:BB:CC",
        "123-45-678",
      );
    });
  });

  it("shows an Unpair action when already paired, and calls it", async () => {
    fetchHomeKitStatus.mockResolvedValue({
      paired: true,
      accessoryId: "AA:BB:CC",
      reachable: true,
    });
    renderDialog();
    const unpairButton = await screen.findByRole("button", { name: "Unpair" });

    fetchHomeKitStatus.mockResolvedValue({ paired: false });
    fireEvent.click(unpairButton);
    await vi.waitFor(() => {
      expect(unpairHomeKitAccessory).toHaveBeenCalledWith("ah-1");
    });
  });

  it("surfaces a discovery error instead of a silent empty state", async () => {
    fetchHomeKitStatus.mockResolvedValue({ paired: false });
    discoverHomeKitAccessories.mockResolvedValue([]);
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Discover" }));
    await screen.findByText(/No unpaired HomeKit accessories found/);
  });
});

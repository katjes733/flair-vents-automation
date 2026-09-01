/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { NotificationProvider } from "~/client/components/notification/NotificationContext";

afterEach(cleanup);

const { disarmControl, rearmControl } = vi.hoisted(() => ({
  disarmControl: vi.fn(),
  rearmControl: vi.fn(),
}));
vi.mock("~/client/api/controlApi", () => ({
  disarmControl,
  rearmControl,
  getStoredActor: () => "",
  setStoredActor: vi.fn(),
}));

const { default: GlobalStatusBar } =
  await import("~/client/components/dashboard/GlobalStatusBar");

const theme = createTheme();

function renderBar(controlDisarmed: boolean, onChanged = vi.fn()) {
  return render(
    <ThemeProvider theme={theme}>
      <NotificationProvider>
        <GlobalStatusBar
          controlDisarmed={controlDisarmed}
          onChanged={onChanged}
        />
      </NotificationProvider>
    </ThemeProvider>,
  );
}

describe("GlobalStatusBar", () => {
  beforeEach(() => {
    disarmControl.mockReset().mockResolvedValue(undefined);
    rearmControl.mockReset().mockResolvedValue(undefined);
  });

  it("shows the armed state and a Disarm Control action", () => {
    renderBar(false);
    expect(screen.getByText("Automatic Control Active")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Disarm Control" }),
    ).toBeInTheDocument();
  });

  it("shows the disarmed state and a Resume action", () => {
    renderBar(true);
    expect(screen.getByText("Control Disarmed")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Resume Automatic Control" }),
    ).toBeInTheDocument();
  });

  it("disables Confirm until an actor name is entered, then calls disarmControl", async () => {
    const onChanged = vi.fn();
    renderBar(false, onChanged);
    fireEvent.click(screen.getByRole("button", { name: "Disarm Control" }));
    const confirmButton = screen.getByRole("button", { name: "Confirm" });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Martin" },
    });
    expect(confirmButton).not.toBeDisabled();

    fireEvent.click(confirmButton);
    await vi.waitFor(() => {
      expect(disarmControl).toHaveBeenCalledWith("Martin");
      expect(onChanged).toHaveBeenCalled();
    });
  });

  it("calls rearmControl when confirming from the disarmed state", async () => {
    renderBar(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Resume Automatic Control" }),
    );
    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Martin" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await vi.waitFor(() => {
      expect(rearmControl).toHaveBeenCalledWith("Martin");
    });
  });
});

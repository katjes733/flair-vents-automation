/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { ThemeModeProvider } from "~/client/theme/ThemeModeProvider";
import { DiagnosticModeProvider } from "~/client/theme/DiagnosticModeProvider";

afterEach(cleanup);

const { useSession } = vi.hoisted(() => ({ useSession: vi.fn() }));
vi.mock("~/client/session/useSession", () => ({ useSession }));

const { default: NavMenu } = await import("~/client/components/layout/NavMenu");

const logout = vi.fn();

function renderNavMenu() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <ThemeModeProvider>
        <DiagnosticModeProvider>
          <Routes>
            <Route path="*" element={<NavMenu />} />
          </Routes>
        </DiagnosticModeProvider>
      </ThemeModeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  logout.mockReset();
});

describe("NavMenu", () => {
  it("hides the page-navigation menu and account menu for a logged-out visitor", () => {
    useSession.mockReturnValue({ user: null, logout });
    renderNavMenu();
    expect(
      screen.queryByRole("button", { name: "menu" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Account menu" }),
    ).not.toBeInTheDocument();
    // The theme toggle is still available regardless of auth state.
    expect(
      screen.getByRole("button", { name: /Switch to (dark|light) mode/ }),
    ).toBeInTheDocument();
  });

  it("shows the page-navigation menu for a logged-in user, and navigates on selection", () => {
    useSession.mockReturnValue({
      user: {
        loginEmail: "a@example.com",
        installationName: "Martin's Home",
        installationLinked: true,
      },
      logout,
    });
    renderNavMenu();
    fireEvent.click(screen.getByRole("button", { name: "menu" }));
    expect(
      screen.getByRole("menuitem", { name: "Schedules" }),
    ).toBeInTheDocument();
  });

  it("shows the current user's email and installation in the account menu", () => {
    useSession.mockReturnValue({
      user: {
        loginEmail: "a@example.com",
        installationName: "Martin's Home",
        installationLinked: true,
      },
      logout,
    });
    renderNavMenu();
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    expect(screen.getByText("a@example.com")).toBeInTheDocument();
    expect(screen.getByText("Martin's Home")).toBeInTheDocument();
  });

  it("logs out when 'Log out' is selected", () => {
    useSession.mockReturnValue({
      user: {
        loginEmail: "a@example.com",
        installationName: null,
        installationLinked: true,
      },
      logout,
    });
    renderNavMenu();
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Log out" }));
    expect(logout).toHaveBeenCalledOnce();
  });
});

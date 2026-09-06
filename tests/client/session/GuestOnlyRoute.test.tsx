/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";

afterEach(cleanup);

const { useSession } = vi.hoisted(() => ({ useSession: vi.fn() }));
vi.mock("~/client/session/useSession", () => ({ useSession }));

const { default: GuestOnlyRoute } =
  await import("~/client/session/GuestOnlyRoute");

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/" element={<div>dashboard</div>} />
        <Route
          path="/login"
          element={
            <GuestOnlyRoute>
              <div>login form</div>
            </GuestOnlyRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("GuestOnlyRoute", () => {
  it("shows a loading spinner while the session is still resolving", () => {
    useSession.mockReturnValue({ user: null, loading: true });
    renderRoute();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("renders the guest content for a logged-out visitor", () => {
    useSession.mockReturnValue({ user: null, loading: false });
    renderRoute();
    expect(screen.getByText("login form")).toBeInTheDocument();
  });

  it("still renders the guest content for a user mid-signup (not yet installation-linked)", () => {
    useSession.mockReturnValue({
      user: { loginEmail: "a@example.com", installationLinked: false },
      loading: false,
    });
    renderRoute();
    expect(screen.getByText("login form")).toBeInTheDocument();
  });

  it("redirects a fully signed-in user to the dashboard", () => {
    useSession.mockReturnValue({
      user: { loginEmail: "a@example.com", installationLinked: true },
      loading: false,
    });
    renderRoute();
    expect(screen.getByText("dashboard")).toBeInTheDocument();
  });
});

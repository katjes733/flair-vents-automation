/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";

afterEach(cleanup);

const { useSession } = vi.hoisted(() => ({ useSession: vi.fn() }));
vi.mock("~/client/session/useSession", () => ({ useSession }));

const { default: ProtectedRoute } =
  await import("~/client/session/ProtectedRoute");

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/login" element={<div>login page</div>} />
        <Route path="/signup" element={<div>signup page</div>} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <div>protected content</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute", () => {
  it("shows a loading spinner while the session is still resolving", () => {
    useSession.mockReturnValue({ user: null, loading: true });
    renderRoute();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });

  it("redirects to /login when not authenticated", () => {
    useSession.mockReturnValue({ user: null, loading: false });
    renderRoute();
    expect(screen.getByText("login page")).toBeInTheDocument();
  });

  it("redirects to /signup when logged in but not yet linked to an installation", () => {
    useSession.mockReturnValue({
      user: { loginEmail: "a@example.com", installationLinked: false },
      loading: false,
    });
    renderRoute();
    expect(screen.getByText("signup page")).toBeInTheDocument();
  });

  it("renders the protected content once authenticated and linked", () => {
    useSession.mockReturnValue({
      user: { loginEmail: "a@example.com", installationLinked: true },
      loading: false,
    });
    renderRoute();
    expect(screen.getByText("protected content")).toBeInTheDocument();
  });
});

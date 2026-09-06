/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { useSession } from "~/client/session/useSession";

afterEach(cleanup);

const { fetchMe, logout: logoutRequest } = vi.hoisted(() => ({
  fetchMe: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("~/client/api/sessionApi", () => ({
  fetchMe,
  logout: logoutRequest,
}));

const { setUnauthorizedHandler } = vi.hoisted(() => ({
  setUnauthorizedHandler: vi.fn(),
}));
vi.mock("~/client/api/httpClient", () => ({ setUnauthorizedHandler }));

const { SessionProvider } = await import("~/client/session/SessionProvider");

function TestConsumer() {
  const { user, loading, refresh, logout } = useSession();
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="user">{user?.loginEmail ?? "none"}</div>
      <button onClick={() => refresh()}>refresh</button>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
}

function LoginStub() {
  return <div>login page</div>;
}

function renderProvider(initialEntry = "/") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SessionProvider>
        <Routes>
          <Route path="/login" element={<LoginStub />} />
          <Route path="*" element={<TestConsumer />} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  fetchMe.mockReset();
  logoutRequest.mockReset().mockResolvedValue(undefined);
  setUnauthorizedHandler.mockReset();
});

describe("SessionProvider", () => {
  it("resolves the user once on mount", async () => {
    fetchMe.mockResolvedValue({
      loginEmail: "a@example.com",
      installationId: "inst-1",
      installationName: "Home",
      role: "owner",
      profile: "admin",
      installationLinked: true,
    });
    renderProvider();
    expect(screen.getByTestId("loading")).toHaveTextContent("true");
    await waitFor(() =>
      expect(screen.getByTestId("loading")).toHaveTextContent("false"),
    );
    expect(screen.getByTestId("user")).toHaveTextContent("a@example.com");
  });

  it("treats a rejected fetchMe as logged out, not stuck loading", async () => {
    fetchMe.mockRejectedValue(new Error("401"));
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("loading")).toHaveTextContent("false"),
    );
    expect(screen.getByTestId("user")).toHaveTextContent("none");
  });

  it("refresh() re-fetches the current user", async () => {
    fetchMe.mockResolvedValueOnce(null);
    renderProvider();
    await waitFor(() => expect(fetchMe).toHaveBeenCalledTimes(1));

    fetchMe.mockResolvedValueOnce({
      loginEmail: "b@example.com",
      installationId: "inst-1",
      installationName: "Home",
      role: "owner",
      profile: "admin",
      installationLinked: true,
    });
    fireEvent.click(screen.getByText("refresh"));
    await waitFor(() => expect(fetchMe).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("user")).toHaveTextContent("b@example.com");
  });

  it("logout() calls the API, clears the user, and navigates to /login", async () => {
    fetchMe.mockResolvedValue({
      loginEmail: "a@example.com",
      installationId: "inst-1",
      installationName: "Home",
      role: "owner",
      profile: "admin",
      installationLinked: true,
    });
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("user")).toHaveTextContent("a@example.com"),
    );
    fireEvent.click(screen.getByText("logout"));
    await waitFor(() => expect(logoutRequest).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByText("login page")).toBeInTheDocument(),
    );
  });

  it("still navigates to /login if the logout request itself fails", async () => {
    fetchMe.mockResolvedValue({
      loginEmail: "a@example.com",
      installationId: "inst-1",
      installationName: "Home",
      role: "owner",
      profile: "admin",
      installationLinked: true,
    });
    logoutRequest.mockRejectedValue(new Error("network error"));
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("user")).toHaveTextContent("a@example.com"),
    );
    fireEvent.click(screen.getByText("logout"));
    await waitFor(() =>
      expect(screen.getByText("login page")).toBeInTheDocument(),
    );
  });

  it("registers an httpClient unauthorized handler that clears the user and redirects to /login", async () => {
    fetchMe.mockResolvedValue({
      loginEmail: "a@example.com",
      installationId: "inst-1",
      installationName: "Home",
      role: "owner",
      profile: "admin",
      installationLinked: true,
    });
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("user")).toHaveTextContent("a@example.com"),
    );
    expect(setUnauthorizedHandler).toHaveBeenCalled();
    const handler = setUnauthorizedHandler.mock.calls[0][0] as () => void;

    handler();
    await waitFor(() =>
      expect(screen.getByText("login page")).toBeInTheDocument(),
    );
  });

  it("unregisters the unauthorized handler on unmount", async () => {
    fetchMe.mockResolvedValue(null);
    const { unmount } = renderProvider();
    await waitFor(() => expect(fetchMe).toHaveBeenCalled());
    unmount();
    expect(setUnauthorizedHandler).toHaveBeenLastCalledWith(null);
  });
});

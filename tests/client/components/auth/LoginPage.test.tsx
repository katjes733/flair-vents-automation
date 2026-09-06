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

afterEach(cleanup);

const { browserSupportsWebAuthn } = vi.hoisted(() => ({
  browserSupportsWebAuthn: vi.fn(),
}));
vi.mock("@simplewebauthn/browser", () => ({ browserSupportsWebAuthn }));

const { login } = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock("~/client/api/sessionApi", () => ({ login }));

const { loginWithPasskey } = vi.hoisted(() => ({
  loginWithPasskey: vi.fn(),
}));
vi.mock("~/client/api/webauthnApi", () => ({ loginWithPasskey }));

const { useSession } = vi.hoisted(() => ({ useSession: vi.fn() }));
vi.mock("~/client/session/useSession", () => ({ useSession }));

const { default: LoginPage } =
  await import("~/client/components/auth/LoginPage");

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const refresh = vi.fn();

beforeEach(() => {
  browserSupportsWebAuthn.mockReturnValue(false);
  login.mockReset();
  loginWithPasskey.mockReset();
  refresh.mockReset().mockResolvedValue(undefined);
  useSession.mockReturnValue({ refresh });
});

describe("LoginPage", () => {
  it("does not show a passkey option on a browser with no WebAuthn support", () => {
    renderPage();
    expect(
      screen.queryByRole("button", { name: "Sign in with a passkey" }),
    ).not.toBeInTheDocument();
  });

  it("logs in and navigates to the dashboard on success", async () => {
    login.mockResolvedValue({
      message: "Logged in",
      user: null,
      sessionExpiry: 1,
    });
    renderPage();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "a@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "hunter2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() =>
      expect(login).toHaveBeenCalledWith("a@example.com", "hunter2"),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByText("dashboard")).toBeInTheDocument(),
    );
  });

  it("shows the server's own error message on a failed login", async () => {
    login.mockRejectedValue({
      response: { data: { error: "Invalid credentials" } },
    });
    renderPage();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "a@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText("Invalid credentials")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("offers passkey sign-in on a supporting browser, and logs in via it", async () => {
    browserSupportsWebAuthn.mockReturnValue(true);
    loginWithPasskey.mockResolvedValue({
      message: "Logged in",
      user: null,
      sessionExpiry: 1,
    });
    renderPage();

    fireEvent.click(
      screen.getByRole("button", { name: "Sign in with a passkey" }),
    );

    await waitFor(() => expect(loginWithPasskey).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByText("dashboard")).toBeInTheDocument(),
    );
  });

  it("surfaces a passkey failure without crashing", async () => {
    browserSupportsWebAuthn.mockReturnValue(true);
    loginWithPasskey.mockRejectedValue(
      new Error("The operation either timed out or was not allowed."),
    );
    renderPage();

    fireEvent.click(
      screen.getByRole("button", { name: "Sign in with a passkey" }),
    );

    expect(
      await screen.findByText(
        "The operation either timed out or was not allowed.",
      ),
    ).toBeInTheDocument();
  });
});

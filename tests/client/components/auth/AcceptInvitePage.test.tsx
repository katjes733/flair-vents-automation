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

const { sendCode, activateInvite } = vi.hoisted(() => ({
  sendCode: vi.fn(),
  activateInvite: vi.fn(),
}));
vi.mock("~/client/api/authApi", () => ({ sendCode, activateInvite }));

const { useSession } = vi.hoisted(() => ({ useSession: vi.fn() }));
vi.mock("~/client/session/useSession", () => ({ useSession }));

const { default: AcceptInvitePage } =
  await import("~/client/components/auth/AcceptInvitePage");

const refresh = vi.fn();

function renderPage(initialEntry = "/accept-invite?email=a%40example.com") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route path="/" element={<div>dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  sendCode.mockReset();
  activateInvite.mockReset();
  refresh.mockReset().mockResolvedValue(undefined);
  useSession.mockReturnValue({ refresh });
});

describe("AcceptInvitePage", () => {
  it("shows a clear error when the invite link is missing its email", () => {
    renderPage("/accept-invite");
    expect(screen.getByText(/missing its email address/)).toBeInTheDocument();
  });

  it("activates the invite and lands on the dashboard on success", async () => {
    activateInvite.mockResolvedValue({
      message: "Logged in",
      user: { loginEmail: "a@example.com", installationLinked: true },
      sessionExpiry: 1,
    });
    renderPage();

    fireEvent.change(screen.getByLabelText("Verification code"), {
      target: { value: "123456" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "supersecret" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "supersecret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Activate account" }));

    await waitFor(() =>
      expect(activateInvite).toHaveBeenCalledWith({
        email: "a@example.com",
        code: "123456",
        password: "supersecret",
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByText("dashboard")).toBeInTheDocument(),
    );
  });

  it("rejects a too-short password before calling the server", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Verification code"), {
      target: { value: "123456" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "short" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Activate account" }));
    expect(
      await screen.findByText("Password must be at least 8 characters."),
    ).toBeInTheDocument();
    expect(activateInvite).not.toHaveBeenCalled();
  });

  it("rejects mismatched password confirmation before calling the server", async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Verification code"), {
      target: { value: "123456" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "supersecret" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "different1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Activate account" }));
    expect(
      await screen.findByText("Passwords don't match."),
    ).toBeInTheDocument();
    expect(activateInvite).not.toHaveBeenCalled();
  });

  it("surfaces the server's own error on a failed activation", async () => {
    activateInvite.mockRejectedValue({
      response: { data: { error: "Invalid verification code" } },
    });
    renderPage();
    fireEvent.change(screen.getByLabelText("Verification code"), {
      target: { value: "wrong" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "supersecret" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "supersecret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Activate account" }));
    expect(
      await screen.findByText("Invalid verification code"),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("resends the code on request", async () => {
    sendCode.mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await waitFor(() => expect(sendCode).toHaveBeenCalledWith("a@example.com"));
    expect(
      await screen.findByText("A new code has been sent."),
    ).toBeInTheDocument();
  });
});

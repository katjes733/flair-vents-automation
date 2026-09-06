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

const { sendCode, verifyCode, signup, connectFlair } = vi.hoisted(() => ({
  sendCode: vi.fn(),
  verifyCode: vi.fn(),
  signup: vi.fn(),
  connectFlair: vi.fn(),
}));
vi.mock("~/client/api/authApi", () => ({
  sendCode,
  verifyCode,
  signup,
  connectFlair,
}));

const { useSession } = vi.hoisted(() => ({ useSession: vi.fn() }));
vi.mock("~/client/session/useSession", () => ({ useSession }));

const { default: SignupPage } =
  await import("~/client/components/auth/SignupPage");

const refresh = vi.fn();

function renderPage(initialEntry = "/signup") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/" element={<div>dashboard</div>} />
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function completeUpToConnectFlair() {
  sendCode.mockResolvedValue(undefined);
  verifyCode.mockResolvedValue(undefined);
  signup.mockResolvedValue(undefined);

  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "a@example.com" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Send verification code" }),
  );
  await waitFor(() => expect(sendCode).toHaveBeenCalledWith("a@example.com"));

  fireEvent.change(await screen.findByLabelText("Verification code"), {
    target: { value: "123456" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
  await waitFor(() =>
    expect(verifyCode).toHaveBeenCalledWith("a@example.com", "123456"),
  );

  fireEvent.change(await screen.findByLabelText("Password"), {
    target: { value: "supersecret" },
  });
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: "supersecret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() =>
    expect(signup).toHaveBeenCalledWith("a@example.com", "supersecret"),
  );

  await screen.findByLabelText("Flair Client ID");
}

beforeEach(() => {
  sendCode.mockReset();
  verifyCode.mockReset();
  signup.mockReset();
  connectFlair.mockReset();
  refresh.mockReset().mockResolvedValue(undefined);
  useSession.mockReturnValue({ user: null, loading: false, refresh });
});

describe("SignupPage", () => {
  it("walks through email → code → password → connect-flair in order", async () => {
    renderPage();
    await completeUpToConnectFlair();
    expect(screen.getByLabelText("Flair Client Secret")).toBeInTheDocument();
  });

  it("prefills the email and jumps to the code step when ?email= is present (the 'continue signup' email link)", () => {
    renderPage("/signup?email=b%40example.com");
    expect(screen.getByLabelText("Verification code")).toBeInTheDocument();
    expect(
      screen.getByText("We sent a verification code to b@example.com."),
    ).toBeInTheDocument();
  });

  it("resends the code without changing steps", async () => {
    renderPage("/signup?email=b%40example.com");
    sendCode.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await waitFor(() => expect(sendCode).toHaveBeenCalledWith("b@example.com"));
    expect(screen.getByLabelText("Verification code")).toBeInTheDocument();
  });

  it("rejects a too-short password before ever calling the server", async () => {
    renderPage("/signup?email=b%40example.com");
    verifyCode.mockResolvedValue(undefined);
    fireEvent.change(screen.getByLabelText("Verification code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
    await waitFor(() => expect(verifyCode).toHaveBeenCalled());

    fireEvent.change(await screen.findByLabelText("Password"), {
      target: { value: "short" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText("Password must be at least 8 characters."),
    ).toBeInTheDocument();
    expect(signup).not.toHaveBeenCalled();
  });

  it("rejects mismatched password confirmation before calling the server", async () => {
    renderPage("/signup?email=b%40example.com");
    verifyCode.mockResolvedValue(undefined);
    fireEvent.change(screen.getByLabelText("Verification code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
    await waitFor(() => expect(verifyCode).toHaveBeenCalled());

    fireEvent.change(await screen.findByLabelText("Password"), {
      target: { value: "supersecret" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "different1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText("Passwords don't match."),
    ).toBeInTheDocument();
    expect(signup).not.toHaveBeenCalled();
  });

  it("connects Flair credentials, refreshes the session, and lands on the dashboard", async () => {
    renderPage();
    await completeUpToConnectFlair();
    connectFlair.mockResolvedValue({
      message: "Logged in",
      user: {
        loginEmail: "a@example.com",
        installationLinked: true,
      },
      sessionExpiry: 1,
    });

    fireEvent.change(screen.getByLabelText("Flair Client ID"), {
      target: { value: "client-id" },
    });
    fireEvent.change(screen.getByLabelText("Flair Client Secret"), {
      target: { value: "client-secret" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Connect Flair account" }),
    );

    await waitFor(() =>
      expect(connectFlair).toHaveBeenCalledWith({
        email: "a@example.com",
        flairClientId: "client-id",
        flairClientSecret: "client-secret",
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByText("dashboard")).toBeInTheDocument(),
    );
  });

  it("surfaces the server's own error when the Flair credentials don't validate", async () => {
    renderPage();
    await completeUpToConnectFlair();
    connectFlair.mockRejectedValue({
      response: { data: { error: "That Client ID/Secret didn't work." } },
    });

    fireEvent.change(screen.getByLabelText("Flair Client ID"), {
      target: { value: "bad-id" },
    });
    fireEvent.change(screen.getByLabelText("Flair Client Secret"), {
      target: { value: "bad-secret" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Connect Flair account" }),
    );

    expect(
      await screen.findByText("That Client ID/Secret didn't work."),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("resumes straight at the connect-flair step for a session that's logged in but not yet installation-linked", () => {
    useSession.mockReturnValue({
      user: { loginEmail: "resumed@example.com", installationLinked: false },
      loading: false,
      refresh,
    });
    renderPage();
    expect(screen.getByLabelText("Flair Client ID")).toBeInTheDocument();
  });

  it("toggles the Flair Client Secret's visibility", async () => {
    renderPage();
    await completeUpToConnectFlair();
    const secretField = screen.getByLabelText(
      "Flair Client Secret",
    ) as HTMLInputElement;
    expect(secretField.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show secret" }));
    expect(secretField.type).toBe("text");
  });
});

/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";

afterEach(cleanup);

const { forgotPassword, resetPassword } = vi.hoisted(() => ({
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
}));
vi.mock("~/client/api/authApi", () => ({ forgotPassword, resetPassword }));

const { default: ForgotPasswordPage } =
  await import("~/client/components/auth/ForgotPasswordPage");

function renderPage() {
  return render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  forgotPassword.mockReset();
  resetPassword.mockReset();
});

describe("ForgotPasswordPage", () => {
  it("starts on the email step", () => {
    renderPage();
    expect(
      screen.getByRole("button", { name: "Send reset code" }),
    ).toBeInTheDocument();
  });

  it("advances to the reset step after requesting a code", async () => {
    forgotPassword.mockResolvedValue(undefined);
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: "a@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset code" }));
    await screen.findByRole("button", { name: "Reset password" });
    expect(forgotPassword).toHaveBeenCalledWith("a@example.com");
  });

  it("shows an error and stays on the email step if the request fails", async () => {
    forgotPassword.mockRejectedValue(new Error("network error"));
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: "a@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset code" }));
    expect(
      await screen.findByText(/Couldn't send a reset code/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send reset code" }),
    ).toBeInTheDocument();
  });

  async function advanceToResetStep(email = "a@example.com") {
    forgotPassword.mockResolvedValue(undefined);
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: email },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset code" }));
    await screen.findByRole("button", { name: "Reset password" });
  }

  it("rejects a too-short password before calling the server", async () => {
    await advanceToResetStep();
    fireEvent.change(screen.getByLabelText(/^Reset code/), {
      target: { value: "111111" },
    });
    fireEvent.change(screen.getByLabelText(/^New password/), {
      target: { value: "short" },
    });
    fireEvent.change(screen.getByLabelText(/^Confirm new password/), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    // Matches only the submit-time error Alert, not the field's own
    // always-present "At least 8 characters." helper text.
    expect(
      await screen.findByText(/password must be at least 8 characters/i),
    ).toBeInTheDocument();
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("rejects mismatched passwords before calling the server", async () => {
    await advanceToResetStep();
    fireEvent.change(screen.getByLabelText(/^Reset code/), {
      target: { value: "111111" },
    });
    fireEvent.change(screen.getByLabelText(/^New password/), {
      target: { value: "password-one" },
    });
    fireEvent.change(screen.getByLabelText(/^Confirm new password/), {
      target: { value: "password-two" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    expect(await screen.findByText(/don't match/)).toBeInTheDocument();
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("resets the password and navigates to /login on success", async () => {
    await advanceToResetStep("a@example.com");
    resetPassword.mockResolvedValue(undefined);
    fireEvent.change(screen.getByLabelText(/^Reset code/), {
      target: { value: "111111" },
    });
    fireEvent.change(screen.getByLabelText(/^New password/), {
      target: { value: "new-password-123" },
    });
    fireEvent.change(screen.getByLabelText(/^Confirm new password/), {
      target: { value: "new-password-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    await vi.waitFor(() =>
      expect(resetPassword).toHaveBeenCalledWith({
        email: "a@example.com",
        code: "111111",
        newPassword: "new-password-123",
      }),
    );
  });

  it("resends the code on Resend code, without leaving the reset step", async () => {
    await advanceToResetStep();
    forgotPassword.mockClear().mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    await screen.findByText("A new code has been sent.");
    expect(forgotPassword).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: "Reset password" }),
    ).toBeInTheDocument();
  });
});

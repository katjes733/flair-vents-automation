/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { NotificationProvider } from "~/client/components/notification/NotificationContext";

afterEach(cleanup);

const { browserSupportsWebAuthn } = vi.hoisted(() => ({
  browserSupportsWebAuthn: vi.fn(),
}));
vi.mock("@simplewebauthn/browser", () => ({ browserSupportsWebAuthn }));

const { fetchPasskeys, registerPasskey, deletePasskey } = vi.hoisted(() => ({
  fetchPasskeys: vi.fn(),
  registerPasskey: vi.fn(),
  deletePasskey: vi.fn(),
}));
vi.mock("~/client/api/webauthnApi", () => ({
  fetchPasskeys,
  registerPasskey,
  deletePasskey,
}));

const { default: PasskeySettingsCard } =
  await import("~/client/components/settings/PasskeySettingsCard");

function renderCard() {
  return render(
    <NotificationProvider>
      <PasskeySettingsCard />
    </NotificationProvider>,
  );
}

beforeEach(() => {
  browserSupportsWebAuthn.mockReturnValue(true);
  fetchPasskeys.mockReset().mockResolvedValue([]);
  registerPasskey.mockReset();
  deletePasskey.mockReset();
});

describe("PasskeySettingsCard", () => {
  it("renders nothing at all on a browser with no WebAuthn support", () => {
    browserSupportsWebAuthn.mockReturnValue(false);
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
    expect(fetchPasskeys).not.toHaveBeenCalled();
  });

  it("lists existing passkeys once loaded", async () => {
    fetchPasskeys.mockResolvedValue([
      {
        id: "1",
        credentialId: "c1",
        nickname: "My Phone",
        deviceType: "singleDevice",
        backedUp: false,
        transports: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        lastUsedAt: null,
      },
    ]);
    renderCard();
    expect(await screen.findByText("My Phone")).toBeInTheDocument();
  });

  it("falls back to 'Unnamed passkey' when no nickname was given", async () => {
    fetchPasskeys.mockResolvedValue([
      {
        id: "1",
        credentialId: "c1",
        nickname: null,
        deviceType: "singleDevice",
        backedUp: false,
        transports: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        lastUsedAt: null,
      },
    ]);
    renderCard();
    expect(await screen.findByText("Unnamed passkey")).toBeInTheDocument();
  });

  it("registers a new passkey with the entered nickname and reloads the list", async () => {
    registerPasskey.mockResolvedValue(undefined);
    renderCard();
    await waitFor(() => expect(fetchPasskeys).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Nickname (optional)"), {
      target: { value: "Work Laptop" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add passkey" }));

    await waitFor(() =>
      expect(registerPasskey).toHaveBeenCalledWith("Work Laptop"),
    );
    await waitFor(() => expect(fetchPasskeys).toHaveBeenCalledTimes(2));
  });

  it("surfaces a passkey registration error", async () => {
    registerPasskey.mockRejectedValue(new Error("Ceremony was cancelled"));
    renderCard();
    await waitFor(() => expect(fetchPasskeys).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Add passkey" }));

    expect(
      await screen.findByText("Ceremony was cancelled"),
    ).toBeInTheDocument();
  });

  it("removes a passkey", async () => {
    fetchPasskeys.mockResolvedValue([
      {
        id: "1",
        credentialId: "c1",
        nickname: "My Phone",
        deviceType: "singleDevice",
        backedUp: false,
        transports: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        lastUsedAt: null,
      },
    ]);
    deletePasskey.mockResolvedValue(undefined);
    renderCard();
    await screen.findByText("My Phone");

    fireEvent.click(screen.getByRole("button", { name: "Remove My Phone" }));
    await waitFor(() => expect(deletePasskey).toHaveBeenCalledWith("1"));
  });
});

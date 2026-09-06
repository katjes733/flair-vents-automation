import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { createTransport, sendMail } = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}));
vi.mock("nodemailer", () => ({
  default: { createTransport },
}));

const ORIGINAL_ENV = { ...process.env };

describe("mailing", () => {
  beforeEach(() => {
    vi.resetModules();
    createTransport.mockReset();
    sendMail.mockReset();
    createTransport.mockReturnValue({ sendMail });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe("escapeHtml", () => {
    it("escapes every reserved HTML character", async () => {
      const { escapeHtml } = await import("~/server/util/mailing");
      expect(escapeHtml(`<script>alert("x") & 'y'</script>`)).toBe(
        "&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;",
      );
    });
  });

  describe("sendEmail", () => {
    it("does nothing when SMTP env vars are not configured", async () => {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_PORT;
      delete process.env.SMTP_SENDER_EMAIL;
      delete process.env.SMTP_SENDER_PASSWORD;
      const { sendEmail } = await import("~/server/util/mailing");

      await sendEmail("Subject", "Body", "someone@example.com");

      expect(createTransport).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();
    });

    // Regression test for a real, confirmed bug: this app's own .env/
    // env/sample.env define SMTP_SENDER_EMAIL/SMTP_SENDER_PASSWORD, but the
    // transporter used to gate on the bare SENDER_EMAIL/SENDER_PASSWORD
    // names — silently never constructing a transporter in the real
    // deployment, with every alert email failing with no error and no log.
    // This test previously used the wrong (bare) names too, which is
    // exactly why the mismatch shipped unnoticed — it now asserts against
    // the real, confirmed .env variable names.
    it("does NOT activate the transporter for the old, wrong bare env var names", async () => {
      delete process.env.SMTP_SENDER_EMAIL;
      delete process.env.SMTP_SENDER_PASSWORD;
      process.env.SMTP_HOST = "smtp.example.com";
      process.env.SMTP_PORT = "587";
      process.env.SENDER_EMAIL = "sender@example.com";
      process.env.SENDER_PASSWORD = "secret";
      const { sendEmail } = await import("~/server/util/mailing");

      await sendEmail("Subject", "Body", "someone@example.com");

      expect(createTransport).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();
    });

    it("does nothing when the sendEmail flag is false, even with SMTP configured", async () => {
      process.env.SMTP_HOST = "smtp.example.com";
      process.env.SMTP_PORT = "587";
      process.env.SMTP_SENDER_EMAIL = "sender@example.com";
      process.env.SMTP_SENDER_PASSWORD = "secret";
      const { sendEmail } = await import("~/server/util/mailing");

      await sendEmail("Subject", "Body", "someone@example.com", false);

      expect(sendMail).not.toHaveBeenCalled();
    });

    it("sends via the configured SMTP transport", async () => {
      process.env.SMTP_HOST = "smtp.example.com";
      process.env.SMTP_PORT = "587";
      process.env.SMTP_SENDER_EMAIL = "sender@example.com";
      process.env.SMTP_SENDER_PASSWORD = "secret";
      sendMail.mockResolvedValue({ messageId: "msg-1" });
      const { sendEmail } = await import("~/server/util/mailing");

      await sendEmail("Subject", "Body text", "someone@example.com");

      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: "smtp.example.com",
          port: 587,
          secure: false, // port 587, not 465
          auth: { user: "sender@example.com", pass: "secret" },
        }),
      );
      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "someone@example.com",
          subject: "Subject",
          text: "Body text",
          from: expect.stringContaining("sender@example.com"),
        }),
      );
    });

    it("marks the connection secure for port 465", async () => {
      process.env.SMTP_HOST = "smtp.example.com";
      process.env.SMTP_PORT = "465";
      process.env.SMTP_SENDER_EMAIL = "sender@example.com";
      process.env.SMTP_SENDER_PASSWORD = "secret";
      sendMail.mockResolvedValue({ messageId: "msg-1" });
      const { sendEmail } = await import("~/server/util/mailing");

      await sendEmail("Subject", "Body", "someone@example.com");

      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ secure: true }),
      );
    });

    it("does not throw when the transport itself fails to send", async () => {
      process.env.SMTP_HOST = "smtp.example.com";
      process.env.SMTP_PORT = "587";
      process.env.SMTP_SENDER_EMAIL = "sender@example.com";
      process.env.SMTP_SENDER_PASSWORD = "secret";
      sendMail.mockRejectedValue(new Error("connection refused"));
      const { sendEmail } = await import("~/server/util/mailing");

      await expect(
        sendEmail("Subject", "Body", "someone@example.com"),
      ).resolves.toBeUndefined();
    });
  });
});

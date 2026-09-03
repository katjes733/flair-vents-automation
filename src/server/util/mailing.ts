import nodemailer, { type Transporter } from "nodemailer";
import { maskEmail } from "~/server/util/maskEmail";

const mailLog = logger.child({ service: "mail" });

let mailTransporter: Transporter | null = null;

function getMailTransporter(): Transporter | null {
  if (
    !mailTransporter &&
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SENDER_EMAIL &&
    process.env.SENDER_PASSWORD
  ) {
    mailTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT), // Typically 587 for TLS
      secure: Number(process.env.SMTP_PORT) === 465, // true for port 465
      auth: {
        user: process.env.SENDER_EMAIL,
        pass: process.env.SENDER_PASSWORD,
      },
    });
  }

  return mailTransporter;
}

// This app has no user model (see "Full authentication & multi-user
// support" in the implementation plan) — every alert falls back to this
// one env-configured recipient. There is deliberately no per-site/per-user
// recipient-resolution branch here to port from the reference app: with
// exactly one installation and no accounts, there's nothing else for an
// alert to resolve a recipient from.
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL || "recipient@example.com";

// For interpolating untrusted-ish values (emails, names) into an HTML email
// body — email clients render HTML, so an unescaped value could inject markup
// or a spoofed link, not just break layout.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendEmail(
  subject: string,
  text: string,
  recipient = RECIPIENT_EMAIL,
  sendEmail = true,
  html?: string,
): Promise<void> {
  if (!sendEmail) {
    return;
  }
  const transporter = getMailTransporter();
  if (transporter && recipient) {
    try {
      const info = await transporter.sendMail({
        from: `"Flair Vents Automation" <${process.env.SENDER_EMAIL || "your_email@example.com"}>`,
        to: recipient,
        subject: subject,
        text: text,
        ...(html ? { html } : {}),
      });
      mailLog.info(
        { messageId: info.messageId, recipient: maskEmail(recipient) },
        "Email sent",
      );
    } catch (error) {
      mailLog.error(
        { err: error, recipient: maskEmail(recipient) },
        "Email sending failed",
      );
    }
  }
}

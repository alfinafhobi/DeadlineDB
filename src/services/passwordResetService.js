const nodemailer = require("nodemailer");

const appConfig = require("../config/appConfig");
const logger = require("../utils/logger");

let resetTransporter;

function hasSmtpConfig() {
  return Boolean(appConfig.smtpHost && appConfig.smtpUser && appConfig.smtpPass);
}

function getTransporter() {
  if (!hasSmtpConfig()) {
    return null;
  }

  if (!resetTransporter) {
    resetTransporter = nodemailer.createTransport({
      host: appConfig.smtpHost,
      port: appConfig.smtpPort,
      secure: appConfig.smtpSecure,
      auth: {
        user: appConfig.smtpUser,
        pass: appConfig.smtpPass
      }
    });
  }

  return resetTransporter;
}

async function sendPasswordResetEmail({ user, resetUrl, expiresInMinutes }) {
  const transporter = getTransporter();

  if (!transporter) {
    logger.info("auth.password-reset.simulated", {
      email: user.email,
      resetUrl,
      expiresInMinutes
    });

    return {
      status: "simulated",
      simulated: true
    };
  }

  await transporter.sendMail({
    from: appConfig.emailFrom,
    to: user.email,
    subject: "[DeadlineDB] Reset your password",
    text: [
      "A password reset was requested for your DeadlineDB account.",
      `Reset link: ${resetUrl}`,
      `This link expires in ${expiresInMinutes} minutes.`,
      "If you did not request this, you can ignore this email."
    ].join("\n\n")
  });

  logger.info("auth.password-reset.sent", {
    email: user.email,
    expiresInMinutes
  });

  return {
    status: "sent",
    simulated: false
  };
}

module.exports = {
  hasSmtpConfig,
  sendPasswordResetEmail
};

const nodemailer = require("nodemailer");

const appConfig = require("../config/appConfig");
const NotificationLog = require("../models/NotificationLog");
const logger = require("../utils/logger");

let transporter;

function hasSmtpConfig() {
  return Boolean(appConfig.smtpHost && appConfig.smtpUser && appConfig.smtpPass);
}

function getTransporter() {
  if (!hasSmtpConfig()) {
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: appConfig.smtpHost,
      port: appConfig.smtpPort,
      secure: appConfig.smtpSecure,
      auth: {
        user: appConfig.smtpUser,
        pass: appConfig.smtpPass
      }
    });
  }

  return transporter;
}

function buildNotificationMessage(payload) {
  const dueLabel = payload.dueDate
    ? new Date(payload.dueDate).toLocaleString()
    : "No due date set";

  const courseLabel = payload.course || payload.subject || "General";

  return [
    `Title: ${payload.title}`,
    `Course: ${courseLabel}`,
    `Due: ${dueLabel}`,
    `Priority: ${payload.priorityBand}`,
    `Source: ${payload.source}`,
    `Trigger: ${payload.triggerType}`
  ].join(" | ");
}

async function deliverEmail(payload) {
  const message = buildNotificationMessage(payload);
  const emailTransporter = getTransporter();

  if (!emailTransporter) {
    logger.info("notification.simulated", {
      email: payload.user.email,
      title: payload.title,
      triggerType: payload.triggerType
    });
    return {
      channel: "email",
      status: "simulated",
      simulated: true
    };
  }

  await emailTransporter.sendMail({
    from: appConfig.emailFrom,
    to: payload.user.email,
    subject: `[DeadlineDB] ${payload.title}`,
    text: message
  });

  logger.info("notification.sent", {
    email: payload.user.email,
    title: payload.title,
    triggerType: payload.triggerType
  });

  return {
    channel: "email",
    status: "sent",
    simulated: false
  };
}

async function sendNotification(payload) {
  const message = buildNotificationMessage(payload);

  try {
    const delivery = await deliverEmail(payload);

    return NotificationLog.create({
      user: payload.user._id,
      channel: delivery.channel,
      entityType: payload.entityType,
      entityId: payload.entityId,
      title: payload.title,
      subject: payload.subject || "",
      course: payload.course || "",
      dueDate: payload.dueDate || null,
      priorityBand: payload.priorityBand || "medium",
      source: payload.source || "",
      triggerType: payload.triggerType,
      triggerKey: payload.triggerKey,
      message,
      status: delivery.status,
      simulated: delivery.simulated,
      sentAt: new Date()
    });
  } catch (error) {
    logger.error("notification.failed", {
      email: payload.user.email,
      title: payload.title,
      triggerType: payload.triggerType,
      message: error.message
    });

    return NotificationLog.create({
      user: payload.user._id,
      channel: "email",
      entityType: payload.entityType,
      entityId: payload.entityId,
      title: payload.title,
      subject: payload.subject || "",
      course: payload.course || "",
      dueDate: payload.dueDate || null,
      priorityBand: payload.priorityBand || "medium",
      source: payload.source || "",
      triggerType: payload.triggerType,
      triggerKey: payload.triggerKey,
      message,
      status: "failed",
      simulated: false,
      sentAt: new Date()
    });
  }
}

module.exports = {
  sendNotification
};

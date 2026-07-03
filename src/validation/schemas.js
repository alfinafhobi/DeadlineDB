const Joi = require("joi");

const objectId = Joi.string().trim().length(24).hex();
const email = Joi.string().email({ tlds: { allow: false } });
const role = Joi.string().valid("student", "professor", "coordinator", "study-group", "room-admin");
const assignmentStatus = Joi.string().valid("todo", "in-progress", "completed");
const roomProgressStatus = Joi.string().valid("not-started", "in-progress", "completed");
const reminderStatus = Joi.string().valid("pending", "done", "dismissed");
const priorityBand = Joi.string().valid("low", "medium", "high", "critical");
const sourceType = Joi.string().valid("telegram", "gmail", "google-classroom");
const syncMode = Joi.string().valid("api", "webhook");
const roomAnnouncementCategory = Joi.string().valid("assignment", "exam", "event", "general", "urgent");

const optionalDate = Joi.date().iso().allow(null, "");
const localDateInput = Joi.alternatives().try(
  Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/),
  Joi.date().iso()
);
const optionalLocalDateInput = localDateInput.allow(null, "");

module.exports = {
  idParamSchema: Joi.object({
    id: objectId.required()
  }),
  authRegisterSchema: Joi.object({
    name: Joi.string().min(2).max(80).required(),
    email: email.required(),
    password: Joi.string().min(6).max(120).required(),
    role: role.default("student")
  }),
  authLoginSchema: Joi.object({
    email: email.required(),
    password: Joi.string().min(6).max(120).required()
  }),
  authForgotPasswordSchema: Joi.object({
    email: email.required()
  }),
  authResetPasswordSchema: Joi.object({
    email: email.required(),
    token: Joi.string().trim().length(64).hex().required(),
    password: Joi.string().min(6).max(120).required()
  }),
  assignmentCreateSchema: Joi.object({
    title: Joi.string().min(2).max(140).required(),
    description: Joi.string().max(2000).allow(""),
    dueDate: localDateInput.required(),
    difficulty: Joi.number().integer().min(1).max(5).default(3),
    weight: Joi.number().integer().min(1).max(5).default(3),
    subject: Joi.string().min(2).max(120).required(),
    course: Joi.string().max(120).allow(""),
    source: Joi.string().valid("Telegram", "Gmail", "Email", "Google Classroom", "Manual").default("Manual"),
    status: assignmentStatus.default("todo")
  }),
  assignmentUpdateSchema: Joi.object({
    title: Joi.string().min(2).max(140),
    description: Joi.string().max(2000).allow(""),
    dueDate: localDateInput,
    difficulty: Joi.number().integer().min(1).max(5),
    weight: Joi.number().integer().min(1).max(5),
    subject: Joi.string().min(2).max(120),
    course: Joi.string().max(120).allow(""),
    source: Joi.string().valid("Telegram", "Gmail", "Email", "Google Classroom", "Manual"),
    status: assignmentStatus
  }).min(1),
  noteCreateSchema: Joi.object({
    subject: Joi.string().min(2).max(120).required(),
    course: Joi.string().max(120).allow(""),
    content: Joi.string().min(3).max(5000).required()
  }),
  reminderCreateSchema: Joi.object({
    title: Joi.string().min(2).max(160).required(),
    description: Joi.string().max(2000).allow(""),
    subject: Joi.string().max(120).allow(""),
    course: Joi.string().max(120).allow(""),
    dueDate: optionalLocalDateInput,
    priorityBand: priorityBand.default("medium")
  }),
  reminderUpdateSchema: Joi.object({
    title: Joi.string().min(2).max(160),
    description: Joi.string().max(2000).allow(""),
    subject: Joi.string().max(120).allow(""),
    course: Joi.string().max(120).allow(""),
    dueDate: optionalLocalDateInput,
    status: reminderStatus,
    priorityBand
  }).min(1),
  notificationQuerySchema: Joi.object({
    limit: Joi.number().integer().min(1).max(100).default(20)
  }),
  integrationCreateSchema: Joi.object({
    type: sourceType.required(),
    label: Joi.string().min(2).max(120).required(),
    selectors: Joi.alternatives().try(
      Joi.array().items(Joi.string().max(120)).max(20),
      Joi.string().max(500).allow("")
    ),
    syncMode: syncMode.default("api"),
    providerAccountId: Joi.string().max(160).allow(""),
    providerEmail: email.allow(""),
    settings: Joi.object({
      courseIds: Joi.alternatives().try(
        Joi.array().items(Joi.string().max(160)).max(50),
        Joi.string().max(2000).allow("")
      ),
      courseNames: Joi.alternatives().try(
        Joi.array().items(Joi.string().max(160)).max(50),
        Joi.string().max(2000).allow("")
      ),
      senderFilters: Joi.alternatives().try(
        Joi.array().items(Joi.string().max(160)).max(50),
        Joi.string().max(2000).allow("")
      ),
      keywordFilters: Joi.alternatives().try(
        Joi.array().items(Joi.string().max(80)).max(50),
        Joi.string().max(2000).allow("")
      ),
      labelFilters: Joi.alternatives().try(
        Joi.array().items(Joi.string().max(80)).max(50),
        Joi.string().max(2000).allow("")
      ),
      query: Joi.string().max(500).allow(""),
      maxResults: Joi.number().integer().min(1).max(100),
      chatIds: Joi.alternatives().try(
        Joi.array().items(Joi.string().max(80)).max(100),
        Joi.string().max(2000).allow("")
      ),
      botToken: Joi.string().max(250).allow(""),
      botUsername: Joi.string().max(120).allow(""),
      webhookSecret: Joi.string().max(256).allow(""),
      webhookUrl: Joi.string().uri({ scheme: [/https?/] }).allow(""),
      pollingEnabled: Joi.boolean(),
      courseKeywords: Joi.alternatives().try(
        Joi.array().items(Joi.string().max(120)).max(50),
        Joi.string().max(2000).allow("")
      )
    }).default({})
  }),
  integrationSyncSchema: Joi.object({
    provider: sourceType,
    force: Joi.boolean().default(false)
  }),
  integrationSettingsSchema: Joi.object({
    label: Joi.string().min(2).max(120),
    selectors: Joi.alternatives().try(
      Joi.array().items(Joi.string().max(120)).max(20),
      Joi.string().max(500).allow("")
    ),
    status: Joi.string().valid("connected", "paused", "disconnected"),
    settings: Joi.object().unknown(true)
  }).min(1),
  providerParamSchema: Joi.object({
    provider: sourceType.required()
  }),
  roomCreateSchema: Joi.object({
    name: Joi.string().min(2).max(120).required(),
    description: Joi.string().max(500).allow("")
  }),
  roomJoinSchema: Joi.object({
    shareCode: Joi.string().trim().length(6).required()
  }),
  roomAssignmentCreateSchema: Joi.object({
    title: Joi.string().min(2).max(140).required(),
    instructions: Joi.string().max(2500).allow(""),
    dueDate: localDateInput.required(),
    difficulty: Joi.number().integer().min(1).max(5).default(3),
    weight: Joi.number().integer().min(1).max(5).default(3),
    subject: Joi.string().min(2).max(120).required(),
    course: Joi.string().max(120).allow(""),
    referenceLinks: Joi.alternatives().try(
      Joi.array().items(Joi.string().uri({ scheme: [/https?/] })).max(10),
      Joi.string().max(2000).allow("")
    )
  }),
  roomAssignmentUpdateSchema: Joi.object({
    title: Joi.string().min(2).max(140),
    instructions: Joi.string().max(2500).allow(""),
    dueDate: localDateInput,
    difficulty: Joi.number().integer().min(1).max(5),
    weight: Joi.number().integer().min(1).max(5),
    subject: Joi.string().min(2).max(120),
    course: Joi.string().max(120).allow(""),
    referenceLinks: Joi.alternatives().try(
      Joi.array().items(Joi.string().uri({ scheme: [/https?/] })).max(10),
      Joi.string().max(2000).allow("")
    ),
    archived: Joi.boolean()
  }).min(1),
  roomAssignmentProgressSchema: Joi.object({
    status: roomProgressStatus.required()
  }),
  roomAnnouncementCreateSchema: Joi.object({
    title: Joi.string().min(2).max(140).required(),
    message: Joi.string().min(3).max(2500).required(),
    category: roomAnnouncementCategory.default("general"),
    showOnDashboard: Joi.boolean().default(true),
    pinned: Joi.boolean().default(false)
  }),
  roomAnnouncementUpdateSchema: Joi.object({
    title: Joi.string().min(2).max(140),
    message: Joi.string().min(3).max(2500),
    category: roomAnnouncementCategory,
    showOnDashboard: Joi.boolean(),
    pinned: Joi.boolean(),
    archived: Joi.boolean()
  }).min(1),
  roomNotePinSchema: Joi.object({
    pinned: Joi.boolean().required()
  })
};

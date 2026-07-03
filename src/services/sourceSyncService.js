const Assignment = require("../models/Assignment");
const ImportedSourceItem = require("../models/ImportedSourceItem");
const Reminder = require("../models/Reminder");
const SourceConnection = require("../models/SourceConnection");
const { invalidateUserViewCaches } = require("./cacheService");
const { calculatePriorityMetrics } = require("./priorityService");
const { logDeadlineExtraction } = require("./deadlineExtractionService");
const googleClassroomAdapter = require("./googleClassroomAdapter");
const gmailAdapter = require("./gmailAdapter");
const telegramAdapter = require("./telegramAdapter");
const { sourceDisplayName } = require("./providerNormalizationService");
const logger = require("../utils/logger");

const adapters = {
  "google-classroom": googleClassroomAdapter,
  gmail: gmailAdapter,
  telegram: telegramAdapter
};

function getAdapter(provider) {
  const adapter = adapters[provider];

  if (!adapter) {
    throw new Error("Unsupported integration provider.");
  }

  return adapter;
}

function buildSyncSummaryMessage(provider, result, providerMetadata = {}) {
  if (provider === "google-classroom") {
    const reconnectNotice = providerMetadata.announcementScopeWarning
      ? ` ${providerMetadata.announcementScopeWarning}`
      : "";
    return `Classroom sync matched ${providerMetadata.matchedCourseCount || 0}/${providerMetadata.totalCoursesFetched || 0} courses, scanned ${providerMetadata.courseworkFetchedCount || 0} coursework items and ${providerMetadata.announcementsFetchedCount || 0} announcements, created ${result.assignmentImports} assignments and ${result.announcementImports} instruction announcements, updated ${result.updatedCount}, skipped ${result.skippedDuplicates} duplicates.${reconnectNotice}`;
  }

  if (provider === "gmail") {
    return `Gmail sync fetched ${providerMetadata.fetchedMessageCount || 0} messages, matched ${providerMetadata.matchedBySenderCount || 0} sender filters and ${providerMetadata.matchedByKeywordCount || 0} keyword filters, created ${result.assignmentImports} assignments, ${result.reminderImports} reminders, ${result.announcementImports} announcements, and skipped ${providerMetadata.unrelatedSkippedCount || 0} unrelated emails.`;
  }

  if (provider === "telegram") {
    return `Telegram sync fetched ${providerMetadata.fetchedUpdates || 0} updates, matched ${providerMetadata.matchedApprovedChats || 0} approved chat messages, ignored ${providerMetadata.ignoredUnapprovedChats || 0} unapproved chat messages, imported ${result.importedCount} items, updated ${result.updatedCount}, and skipped ${result.skippedDuplicates} duplicates.`;
  }

  return "Sync completed.";
}

async function syncConnection(connection, user, options = {}) {
  const provider = connection.provider || connection.type;

  if (connection.status === "disconnected" || connection.status === "paused") {
    throw new Error("This integration is not active.");
  }

  if (["google-classroom", "gmail"].includes(provider) && !connection.encryptedAccessToken && !connection.encryptedRefreshToken) {
    const error = new Error("Connect this provider with OAuth before syncing.");
    error.code = "PROVIDER_NEEDS_AUTH";
    throw error;
  }

  const adapter = getAdapter(provider);
  const result = {
    importedCount: 0,
    skippedDuplicates: 0,
    updatedCount: 0,
    failedRecords: 0,
    assignmentImports: 0,
    reminderImports: 0,
    announcementImports: 0,
    importedItems: [],
    assignments: [],
    reminders: [],
    providerMetadata: {}
  };

  try {
    const adapterResult = await adapter.fetchNormalizedItems(connection, options);
    const normalizedItems = adapterResult.normalizedItems || [];
    result.providerMetadata = adapterResult.providerMetadata || {};

    for (const item of normalizedItems) {
      try {
        logDeadlineExtraction({
          rawDateToken: item.deadlineExtraction && item.deadlineExtraction.rawDateToken,
          rawTimeToken: item.deadlineExtraction && item.deadlineExtraction.rawTimeToken,
          resolvedDateTime: item.dueDateTime || item.dueDate || null,
          confidence: item.parseConfidence || "low",
          ambiguityFlags: item.ambiguityFlags || []
        }, {
          entity: item.importType,
          route: "integration.sync",
          provider,
          connectionId: connection._id
        });
        const outcome = await importNormalizedItem(item, connection, user);

        result[outcome.counter] += 1;

        if (outcome.counter === "importedCount") {
          if (outcome.importType === "assignment") {
            result.assignmentImports += 1;
          } else if (outcome.importType === "announcement") {
            result.announcementImports += 1;
          } else {
            result.reminderImports += 1;
          }
        }

        if (outcome.importedItem) {
          result.importedItems.push(outcome.importedItem);
        }

        if (outcome.assignment) {
          result.assignments.push(outcome.assignment);
        }

        if (outcome.reminder) {
          result.reminders.push(outcome.reminder);
        }
      } catch (error) {
        result.failedRecords += 1;
        logger.warn("integration.record-import.failed", {
          provider,
          connectionId: connection._id,
          syncHash: item.syncHash,
          message: error.message
        });
      }
    }

    await markSyncSuccess(connection, result, result.providerMetadata);
    invalidateUserViewCaches([user._id]);

    logger.info("integration.sync.completed", {
      provider,
      connectionId: connection._id,
      userId: user._id,
      importedCount: result.importedCount,
      skippedDuplicates: result.skippedDuplicates,
      updatedCount: result.updatedCount,
      failedRecords: result.failedRecords
    });

    return result;
  } catch (error) {
    await markSyncFailure(connection, error);

    logger.error("integration.sync.failed", {
      provider,
      connectionId: connection._id,
      userId: user._id,
      message: error.message,
      code: error.code || error.providerCode || ""
    });

    throw error;
  }
}

async function importNormalizedItem(item, connection, user) {
  const provider = connection.provider || connection.type;
  const existingImport = await ImportedSourceItem.findOne({
    user: user._id,
    sourceProvider: provider,
    syncHash: item.syncHash
  });

  if (existingImport) {
    const updated = await updateExistingEntityIfChanged(existingImport, item);
    return {
      counter: updated ? "updatedCount" : "skippedDuplicates",
      importedItem: existingImport
    };
  }

  if (item.importType === "assignment") {
    return importAssignment(item, connection, user);
  }

  if (item.importType === "announcement") {
    return importAnnouncement(item, connection, user);
  }

  return importReminder(item, connection, user);
}

async function importAssignment(item, connection, user) {
  const provider = connection.provider || connection.type;
  const dueDate = item.dueDate || new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
  const metrics = calculatePriorityMetrics({
    dueDate,
    difficulty: item.difficulty || 3,
    weight: item.weight || 3
  });
  const assignment = await Assignment.create({
    user: user._id,
    title: item.title,
    description: item.description || "",
    dueDate,
    dueTime: item.dueTime || "",
    dueDateTime: item.dueDateTime || dueDate,
    rawDetectedDeadlineText: item.rawDetectedDeadlineText || "",
    parseConfidence: item.parseConfidence || "",
    ambiguityFlags: item.ambiguityFlags || [],
    parseSource: item.parseSource || provider,
    needsUserReview: Boolean(item.needsUserReview),
    deadlineExtraction: item.deadlineExtraction || {},
    difficulty: item.difficulty || 3,
    weight: item.weight || 3,
    subject: item.subject || item.course || sourceDisplayName(provider),
    course: item.course || item.subject || "",
    source: sourceDisplayName(provider),
    ...metrics,
    sourceRef: buildSourceRef(item, connection)
  });
  const reminder = await Reminder.create({
    user: user._id,
    title: `Upcoming: ${assignment.title}`,
    description: `Imported from ${assignment.source}${item.sourceUrl ? ` (${item.sourceUrl})` : ""}`,
    subject: assignment.subject,
    course: assignment.course,
    dueDate: assignment.dueDate,
    dueTime: assignment.dueTime || item.dueTime || "",
    dueDateTime: assignment.dueDateTime || assignment.dueDate,
    rawDetectedDeadlineText: item.rawDetectedDeadlineText || "",
    parseConfidence: item.parseConfidence || "",
    ambiguityFlags: item.ambiguityFlags || [],
    parseSource: item.parseSource || provider,
    needsUserReview: Boolean(item.needsUserReview),
    deadlineExtraction: item.deadlineExtraction || {},
    source: "integration",
    priorityBand: assignment.priorityBand,
    assignment: assignment._id,
    sourceRef: buildSourceRef(item, connection)
  });
  const importedItem = await ImportedSourceItem.create({
    ...buildImportedItemPayload(item, connection, user),
    assignment: assignment._id,
    reminder: reminder._id,
    status: "imported"
  });

  return {
    counter: "importedCount",
    importedItem,
    assignment,
    reminder,
    importType: "assignment"
  };
}

async function importReminder(item, connection, user) {
  const provider = connection.provider || connection.type;
  const reminder = await Reminder.create({
    user: user._id,
    title: item.title,
    description: item.description || "",
    subject: item.subject || item.course || sourceDisplayName(provider),
    course: item.course || item.subject || "",
    dueDate: item.dueDate || null,
    dueTime: item.dueTime || "",
    dueDateTime: item.dueDateTime || item.dueDate || null,
    rawDetectedDeadlineText: item.rawDetectedDeadlineText || "",
    parseConfidence: item.parseConfidence || "",
    ambiguityFlags: item.ambiguityFlags || [],
    parseSource: item.parseSource || provider,
    needsUserReview: Boolean(item.needsUserReview),
    deadlineExtraction: item.deadlineExtraction || {},
    source: "integration",
    priorityBand: item.priorityBand || "medium",
    sourceRef: buildSourceRef(item, connection)
  });
  const importedItem = await ImportedSourceItem.create({
    ...buildImportedItemPayload(item, connection, user),
    reminder: reminder._id,
    status: "imported"
  });

  return {
    counter: "importedCount",
    importedItem,
    reminder,
    importType: "reminder"
  };
}

async function importAnnouncement(item, connection, user) {
  const provider = connection.provider || connection.type;
  const reminder = await Reminder.create({
    user: user._id,
    title: item.title,
    description: item.description || "",
    subject: item.subject || item.course || sourceDisplayName(provider),
    course: item.course || item.subject || "",
    dueDate: item.dueDate || null,
    dueTime: item.dueTime || "",
    dueDateTime: item.dueDateTime || item.dueDate || null,
    rawDetectedDeadlineText: item.rawDetectedDeadlineText || "",
    parseConfidence: item.parseConfidence || "",
    ambiguityFlags: item.ambiguityFlags || [],
    parseSource: item.parseSource || provider,
    needsUserReview: Boolean(item.needsUserReview),
    deadlineExtraction: item.deadlineExtraction || {},
    source: "integration",
    priorityBand: item.priorityBand || "low",
    sourceRef: buildSourceRef(item, connection)
  });
  const importedItem = await ImportedSourceItem.create({
    ...buildImportedItemPayload(item, connection, user),
    reminder: reminder._id,
    status: "imported"
  });

  return {
    counter: "importedCount",
    importedItem,
    reminder,
    importType: "announcement"
  };
}

async function updateExistingEntityIfChanged(importedItem, item) {
  if (!item.dueDate) {
    return false;
  }

  if (importedItem.assignment) {
    const assignment = await Assignment.findById(importedItem.assignment);

    if (assignment && new Date(assignment.dueDate).getTime() !== new Date(item.dueDate).getTime()) {
      assignment.dueDate = item.dueDate;
      assignment.dueTime = item.dueTime || assignment.dueTime || "";
      assignment.dueDateTime = item.dueDateTime || item.dueDate;
      assignment.rawDetectedDeadlineText = item.rawDetectedDeadlineText || assignment.rawDetectedDeadlineText || "";
      assignment.parseConfidence = item.parseConfidence || assignment.parseConfidence || "";
      assignment.ambiguityFlags = item.ambiguityFlags || assignment.ambiguityFlags || [];
      assignment.parseSource = item.parseSource || assignment.parseSource || "";
      assignment.needsUserReview = Boolean(item.needsUserReview);
      assignment.deadlineExtraction = item.deadlineExtraction || assignment.deadlineExtraction || {};
      Object.assign(assignment, calculatePriorityMetrics(assignment));
      await assignment.save();
      importedItem.status = "updated";
      importedItem.dueDate = item.dueDate;
      await importedItem.save();
      return true;
    }
  }

  if (importedItem.reminder) {
    const reminder = await Reminder.findById(importedItem.reminder);

    if (reminder && (!reminder.dueDate || new Date(reminder.dueDate).getTime() !== new Date(item.dueDate).getTime())) {
      reminder.dueDate = item.dueDate;
      reminder.dueTime = item.dueTime || reminder.dueTime || "";
      reminder.dueDateTime = item.dueDateTime || item.dueDate;
      reminder.rawDetectedDeadlineText = item.rawDetectedDeadlineText || reminder.rawDetectedDeadlineText || "";
      reminder.parseConfidence = item.parseConfidence || reminder.parseConfidence || "";
      reminder.ambiguityFlags = item.ambiguityFlags || reminder.ambiguityFlags || [];
      reminder.parseSource = item.parseSource || reminder.parseSource || "";
      reminder.needsUserReview = Boolean(item.needsUserReview);
      reminder.deadlineExtraction = item.deadlineExtraction || reminder.deadlineExtraction || {};
      await reminder.save();
      importedItem.status = "updated";
      importedItem.dueDate = item.dueDate;
      await importedItem.save();
      return true;
    }
  }

  return false;
}

function buildSourceRef(item, connection) {
  return {
    externalKey: item.syncHash,
    selector: item.sourceCourseId || item.sourceMessageId || connection.label,
    connection: connection._id,
    provider: item.sourceProvider,
    sourceAccountId: item.sourceAccountId || "",
    sourceCourseId: item.sourceCourseId || "",
    sourceItemId: item.sourceItemId || "",
    sourceMessageId: item.sourceMessageId || "",
    sourceUrl: item.sourceUrl || "",
    rawMetadata: item.rawMetadata || {}
  };
}

function buildImportedItemPayload(item, connection, user) {
  return {
    user: user._id,
    connection: connection._id,
    sourceProvider: item.sourceProvider,
    sourceAccountId: item.sourceAccountId || "",
    sourceCourseId: item.sourceCourseId || "",
    sourceItemId: item.sourceItemId || "",
    sourceMessageId: item.sourceMessageId || "",
    title: item.title,
    description: item.description || "",
    subject: item.subject || "",
    course: item.course || "",
    dueDate: item.dueDate || null,
    dueTime: item.dueTime || "",
    dueDateTime: item.dueDateTime || item.dueDate || null,
    postedAt: item.postedAt || null,
    sourceUrl: item.sourceUrl || "",
    rawMetadata: item.rawMetadata || {},
    rawDetectedDeadlineText: item.rawDetectedDeadlineText || "",
    parseConfidence: item.parseConfidence || "",
    ambiguityFlags: item.ambiguityFlags || [],
    parseSource: item.parseSource || "",
    needsUserReview: Boolean(item.needsUserReview),
    deadlineExtraction: item.deadlineExtraction || {},
    importType: item.importType,
    syncHash: item.syncHash
  };
}

async function markSyncSuccess(connection, result, providerMetadata = {}) {
  const provider = connection.provider || connection.type;
  const existingProviderMetadata = (connection.settings && connection.settings.providerMetadata) || {};
  const mergedProviderMetadata = {
    ...existingProviderMetadata,
    ...providerMetadata
  };
  connection.lastSyncedAt = new Date();
  connection.lastSuccessfulSyncAt = connection.lastSyncedAt;
  connection.status = provider === "telegram"
    ? "connected"
    : (connection.status === "setup-required" || connection.status === "needs-auth")
      ? "connected"
      : connection.status;
  connection.health = provider === "telegram"
    ? connection.settings && connection.settings.canReadAllGroupMessages
      ? "healthy"
      : "limited"
    : result.failedRecords
      ? "limited"
      : "healthy";
  connection.errorState = {
    code: "",
    message: "",
    occurredAt: null
  };
  connection.lastSyncResult = {
    importedCount: result.importedCount,
    skippedDuplicates: result.skippedDuplicates,
    updatedCount: result.updatedCount,
    failedRecords: result.failedRecords,
    message: mergedProviderMetadata.message || buildSyncSummaryMessage(provider, result, mergedProviderMetadata)
  };
  connection.settings = {
    ...(connection.settings || {}),
    providerMetadata: mergedProviderMetadata
  };
  await connection.save();
}

async function markSyncFailure(connection, error) {
  const setupRequiredCodes = new Set([
    "TELEGRAM_TOKEN_REQUIRED",
    "TELEGRAM_TOKEN_INVALID_FORMAT",
    "TELEGRAM_TOKEN_WHITESPACE"
  ]);
  connection.lastSyncedAt = new Date();
  connection.lastFailedSyncAt = connection.lastSyncedAt;
  connection.status = error.code === "PROVIDER_NEEDS_AUTH" || error.code === "TOKEN_REFRESH_REQUIRED"
    ? "needs-auth"
    : setupRequiredCodes.has(error.code)
      ? "setup-required"
    : "error";
  connection.health = connection.status === "setup-required" ? "action-required" : "error";
  connection.errorState = {
    code: error.code || error.providerCode || "SYNC_FAILED",
    message: error.message,
    occurredAt: new Date()
  };
  connection.lastSyncResult = {
    ...(connection.lastSyncResult || {}),
    message: error.message
  };
  if (error.diagnostics) {
    const diagnostics = typeof telegramAdapter.publicDiagnostics === "function"
      ? telegramAdapter.publicDiagnostics(error.diagnostics)
      : error.diagnostics;
    connection.settings = {
      ...(connection.settings || {}),
      providerMetadata: {
        ...((connection.settings && connection.settings.providerMetadata) || {}),
        telegramDiagnostics: diagnostics
      }
    };
  }
  await connection.save();
}

async function findConnectionWithSecrets(query) {
  return SourceConnection.findOne(query).select("+encryptedAccessToken +encryptedRefreshToken");
}

module.exports = {
  findConnectionWithSecrets,
  getAdapter,
  importNormalizedItem,
  syncConnection
};

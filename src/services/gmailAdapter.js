const { getValidGoogleAccessToken } = require("./googleOAuthService");
const { normalizeGmailMessage } = require("./providerNormalizationService");
const logger = require("../utils/logger");

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

function uniqueValues(values = []) {
  const seen = new Set();

  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

async function gmailRequest(connection, path, params = {}) {
  const accessToken = await getValidGoogleAccessToken(connection);
  const url = new URL(`${GMAIL_API_BASE}${path}`);

  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .forEach((item) => url.searchParams.append(key, item));
      return;
    }

    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload.error && payload.error.message ? payload.error.message : "Gmail API request failed.");
    error.status = response.status;
    error.providerCode = payload.error && payload.error.status ? payload.error.status : "";
    throw error;
  }

  return payload;
}

function buildSenderQuery(senderFilters = []) {
  const senders = uniqueValues(senderFilters);

  if (!senders.length) {
    return "";
  }

  if (senders.length === 1) {
    return `from:${senders[0]}`;
  }

  return `(${senders.map((sender) => `from:${sender}`).join(" OR ")})`;
}

function buildKeywordQuery(keywordFilters = []) {
  const keywords = uniqueValues(keywordFilters);

  if (!keywords.length) {
    return "";
  }

  if (keywords.length === 1) {
    return `"${keywords[0]}"`;
  }

  return `(${keywords.map((keyword) => `"${keyword}"`).join(" OR ")})`;
}

function buildGmailQuery(settings = {}) {
  const queryParts = [];

  if (settings.query) {
    queryParts.push(`(${String(settings.query).trim()})`);
  }

  const senderQuery = buildSenderQuery(settings.senderFilters || []);
  const keywordQuery = buildKeywordQuery(settings.keywordFilters || []);

  if (senderQuery) {
    queryParts.push(senderQuery);
  }

  if (keywordQuery) {
    queryParts.push(keywordQuery);
  }

  return queryParts.join(" ").trim();
}

async function listLabels(connection) {
  const payload = await gmailRequest(connection, "/labels");
  return payload.labels || [];
}

async function resolveLabelFilterIds(connection, settings = {}) {
  const requestedLabels = uniqueValues(settings.labelFilters || []);

  if (!requestedLabels.length) {
    return {
      labelIds: [],
      resolvedLabels: [],
      unmatchedLabels: []
    };
  }

  const labels = await listLabels(connection);
  const byId = new Map(labels.map((label) => [String(label.id || ""), label]));
  const byName = new Map(labels.map((label) => [String(label.name || "").toLowerCase(), label]));
  const labelIds = [];
  const resolvedLabels = [];
  const unmatchedLabels = [];

  for (const requested of requestedLabels) {
    const byExplicitId = byId.get(requested);
    const byNormalizedName = byName.get(requested.toLowerCase());
    const match = byExplicitId || byNormalizedName;

    if (!match) {
      unmatchedLabels.push(requested);
      continue;
    }

    labelIds.push(match.id);
    resolvedLabels.push({
      requested,
      id: match.id,
      name: match.name || ""
    });
  }

  return {
    labelIds: uniqueValues(labelIds),
    resolvedLabels,
    unmatchedLabels
  };
}

async function listMessages(connection, options = {}) {
  const settings = connection.settings || {};
  const payload = await gmailRequest(connection, "/messages", {
    q: options.query || buildGmailQuery(settings),
    labelIds: options.labelIds || [],
    maxResults: settings.maxResults || 25
  });

  return payload.messages || [];
}

async function getMessage(connection, messageId) {
  const payload = await gmailRequest(connection, `/messages/${encodeURIComponent(messageId)}`, {
    format: "full"
  });

  return mapGmailPayload(payload);
}

function mapGmailPayload(payload) {
  const headers = payload.payload && Array.isArray(payload.payload.headers)
    ? payload.payload.headers
    : [];
  const headerMap = new Map(headers.map((header) => [String(header.name || "").toLowerCase(), header.value || ""]));
  const internalDate = payload.internalDate ? new Date(Number(payload.internalDate)) : null;

  return {
    id: payload.id,
    threadId: payload.threadId,
    labelIds: payload.labelIds || [],
    subject: headerMap.get("subject") || "Gmail academic notice",
    from: headerMap.get("from") || "",
    listUnsubscribe: headerMap.get("list-unsubscribe") || "",
    receivedAt: internalDate,
    snippet: payload.snippet || "",
    body: extractMessageBody(payload.payload),
    sourceUrl: payload.id ? `https://mail.google.com/mail/u/0/#inbox/${payload.id}` : ""
  };
}

function extractMessageBody(part) {
  if (!part) {
    return "";
  }

  if (part.body && part.body.data) {
    return decodeBase64Url(part.body.data);
  }

  if (Array.isArray(part.parts)) {
    return part.parts
      .map(extractMessageBody)
      .filter(Boolean)
      .join("\n")
      .slice(0, 8000);
  }

  return "";
}

function decodeBase64Url(value = "") {
  return Buffer.from(
    String(value).replace(/-/g, "+").replace(/_/g, "/"),
    "base64"
  ).toString("utf8");
}

async function fetchNormalizedItems(connection) {
  const settings = connection.settings || {};
  const query = buildGmailQuery(settings);
  const {
    labelIds,
    resolvedLabels,
    unmatchedLabels
  } = await resolveLabelFilterIds(connection, settings);

  if ((settings.labelFilters || []).length && !labelIds.length) {
    logger.info("integration.gmail.filter-summary", {
      connectionId: connection._id,
      provider: "gmail",
      savedSettings: {
        query: settings.query || "",
        senderFilters: settings.senderFilters || [],
        keywordFilters: settings.keywordFilters || [],
        labelFilters: settings.labelFilters || []
      },
      queryUsed: query,
      fetchedMessageCount: 0,
      matchedBySenderCount: 0,
      matchedByKeywordCount: 0,
      skippedUnrelatedEmailCount: 0,
      unmatchedLabels
    });

    return {
      normalizedItems: [],
      providerMetadata: {
        filterSettings: {
          query: settings.query || "",
          senderFilters: settings.senderFilters || [],
          keywordFilters: settings.keywordFilters || [],
          labelFilters: settings.labelFilters || []
        },
        queryUsed: query,
        resolvedLabels,
        unmatchedLabels,
        fetchedMessageCount: 0,
        matchedBySenderCount: 0,
        matchedByKeywordCount: 0,
        unrelatedSkippedCount: 0,
        assignmentCandidates: 0,
        reminderCandidates: 0,
        announcementCandidates: 0,
        message: "No Gmail labels matched the configured label filters."
      }
    };
  }

  const messageRefs = await listMessages(connection, { query, labelIds });
  const messages = [];
  const normalizedItems = [];
  const summary = {
    filterSettings: {
      query: settings.query || "",
      senderFilters: settings.senderFilters || [],
      keywordFilters: settings.keywordFilters || [],
      labelFilters: settings.labelFilters || []
    },
    queryUsed: query,
    resolvedLabels,
    unmatchedLabels,
    fetchedMessageCount: messageRefs.length,
    matchedBySenderCount: 0,
    matchedByKeywordCount: 0,
    unrelatedSkippedCount: 0,
    assignmentCandidates: 0,
    reminderCandidates: 0,
    announcementCandidates: 0
  };

  for (const ref of messageRefs) {
    const message = await getMessage(connection, ref.id);
    messages.push(message);
    const outcome = normalizeGmailMessage(message, settings, connection);

    if (outcome.diagnostics.senderMatched) {
      summary.matchedBySenderCount += 1;
    }

    if (outcome.diagnostics.keywordMatched) {
      summary.matchedByKeywordCount += 1;
    }

    if (!outcome.normalizedItem) {
      summary.unrelatedSkippedCount += 1;
      continue;
    }

    if (outcome.diagnostics.classification === "assignment") {
      summary.assignmentCandidates += 1;
    } else if (outcome.diagnostics.classification === "announcement") {
      summary.announcementCandidates += 1;
    } else {
      summary.reminderCandidates += 1;
    }

    normalizedItems.push(outcome.normalizedItem);
  }

  logger.info("integration.gmail.filter-summary", {
    connectionId: connection._id,
    provider: "gmail",
    savedSettings: summary.filterSettings,
    queryUsed: summary.queryUsed,
    fetchedMessageCount: summary.fetchedMessageCount,
    matchedBySenderCount: summary.matchedBySenderCount,
    matchedByKeywordCount: summary.matchedByKeywordCount,
    unrelatedSkippedCount: summary.unrelatedSkippedCount,
    assignmentCandidates: summary.assignmentCandidates,
    reminderCandidates: summary.reminderCandidates,
    announcementCandidates: summary.announcementCandidates
  });

  return {
    normalizedItems,
    providerMetadata: summary
  };
}

module.exports = {
  buildGmailQuery,
  fetchNormalizedItems,
  resolveLabelFilterIds
};

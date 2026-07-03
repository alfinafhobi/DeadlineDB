const { getValidGoogleAccessToken } = require("./googleOAuthService");
const {
  normalizeClassroomItem
} = require("./providerNormalizationService");
const logger = require("../utils/logger");

const CLASSROOM_API_BASE = "https://classroom.googleapis.com/v1";

function normalizeCourseToken(value = "") {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function buildCourseFilters(settings = {}, selectors = []) {
  return {
    courseIds: new Set((settings.courseIds || []).map((item) => String(item || "").trim()).filter(Boolean)),
    courseNames: new Set(
      [...(settings.courseNames || []), ...(selectors || [])]
        .map(normalizeCourseToken)
        .filter(Boolean)
    )
  };
}

function filterCourses(courses, settings = {}, selectors = []) {
  const filters = buildCourseFilters(settings, selectors);
  const hasFilters = filters.courseIds.size > 0 || filters.courseNames.size > 0;

  if (!hasFilters) {
    return {
      filters,
      matchedCourses: courses,
      skippedNonMatchingCourses: 0
    };
  }

  const matchedCourses = courses.filter((course) => {
    const courseId = String(course.id || "").trim();
    const normalizedName = normalizeCourseToken(course.name);
    return filters.courseIds.has(courseId) || filters.courseNames.has(normalizedName);
  });

  return {
    filters,
    matchedCourses,
    skippedNonMatchingCourses: Math.max(courses.length - matchedCourses.length, 0)
  };
}

async function classroomRequest(connection, path, params = {}) {
  const accessToken = await getValidGoogleAccessToken(connection);
  const url = new URL(`${CLASSROOM_API_BASE}${path}`);

  Object.entries(params).forEach(([key, value]) => {
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
    const error = new Error(payload.error && payload.error.message ? payload.error.message : "Google Classroom API request failed.");
    error.status = response.status;
    error.providerCode = payload.error && payload.error.status ? payload.error.status : "";
    throw error;
  }

  return payload;
}

async function fetchCourses(connection) {
  const courses = [];
  let pageToken = "";

  do {
    const payload = await classroomRequest(connection, "/courses", {
      pageSize: 100,
      courseStates: "ACTIVE",
      pageToken
    });

    courses.push(...(payload.courses || []));
    pageToken = payload.nextPageToken || "";
  } while (pageToken);

  return courses;
}

async function fetchCourseWork(connection, course) {
  const courseWork = [];
  let pageToken = "";

  do {
    const payload = await classroomRequest(connection, `/courses/${encodeURIComponent(course.id)}/courseWork`, {
      pageSize: 100,
      courseWorkStates: "PUBLISHED",
      orderBy: "dueDate asc",
      pageToken
    });

    courseWork.push(...(payload.courseWork || []));
    pageToken = payload.nextPageToken || "";
  } while (pageToken);

  return courseWork;
}

async function fetchAnnouncements(connection, course) {
  const announcements = [];
  let pageToken = "";

  do {
    const payload = await classroomRequest(connection, `/courses/${encodeURIComponent(course.id)}/announcements`, {
      pageSize: 100,
      announcementStates: "PUBLISHED",
      orderBy: "updateTime desc",
      pageToken
    });

    announcements.push(...(payload.announcements || []));
    pageToken = payload.nextPageToken || "";
  } while (pageToken);

  return announcements;
}

async function fetchNormalizedItems(connection) {
  const settings = connection.settings || {};
  const courses = await fetchCourses(connection);
  const {
    filters,
    matchedCourses: filteredCourses,
    skippedNonMatchingCourses
  } = filterCourses(courses, settings, connection.selectors || []);
  const normalizedItems = [];
  let courseworkFetchedCount = 0;
  let announcementsFetchedCount = 0;
  let announcementInstructionsPrepared = 0;
  let skippedAnnouncementsCount = 0;
  let skippedUnsupportedItemsCount = 0;
  const workTypeCounts = {};
  let announcementScopeWarning = "";

  for (const course of filteredCourses) {
    const courseWork = await fetchCourseWork(connection, course);
    courseworkFetchedCount += courseWork.length;

    for (const item of courseWork) {
      const normalized = normalizeClassroomItem({
        resourceType: "courseWork",
        course,
        item,
        connection
      });

      if (!normalized) {
        skippedUnsupportedItemsCount += 1;
        continue;
      }

      const workType = String(item.workType || "UNKNOWN");
      workTypeCounts[workType] = (workTypeCounts[workType] || 0) + 1;
      normalizedItems.push(normalized);
    }

    try {
      const announcements = await fetchAnnouncements(connection, course);
      announcementsFetchedCount += announcements.length;

      for (const item of announcements) {
        const normalized = normalizeClassroomItem({
          resourceType: "announcement",
          course,
          item,
          connection
        });

        if (!normalized) {
          skippedAnnouncementsCount += 1;
          continue;
        }

        announcementInstructionsPrepared += 1;
        normalizedItems.push(normalized);
      }
    } catch (error) {
      if (error.status === 403 || error.providerCode === "PERMISSION_DENIED") {
        announcementScopeWarning = "Reconnect Google Classroom OAuth to grant announcement read access.";
        logger.warn("integration.classroom.announcements.scope-missing", {
          connectionId: connection._id,
          provider: "google-classroom",
          courseId: course.id,
          message: error.message
        });
        continue;
      }

      throw error;
    }
  }

  logger.info("integration.classroom.filter-summary", {
    connectionId: connection._id,
    provider: "google-classroom",
    savedSettings: {
      selectors: connection.selectors || [],
      courseNames: settings.courseNames || [],
      courseIds: settings.courseIds || []
    },
    resolvedCourseNames: [...filters.courseNames],
    resolvedCourseIds: [...filters.courseIds],
    totalCoursesFetched: courses.length,
    matchedCourseCount: filteredCourses.length,
    skippedNonMatchingCourses,
    courseworkFetchedCount,
    announcementsFetchedCount,
    assignmentsPrepared: normalizedItems.filter((item) => item.importType === "assignment").length,
    announcementInstructionsPrepared,
    skippedAnnouncementsCount,
    skippedUnsupportedItemsCount
  });

  return {
    normalizedItems,
    providerMetadata: {
      filterSettings: {
        selectors: connection.selectors || [],
        courseNames: settings.courseNames || [],
        courseIds: settings.courseIds || []
      },
      resolvedCourseNames: [...filters.courseNames],
      resolvedCourseIds: [...filters.courseIds],
      availableCourses: courses.map((course) => ({
        id: course.id,
        name: course.name,
        section: course.section || "",
        alternateLink: course.alternateLink || ""
      })),
      totalCoursesFetched: courses.length,
      matchedCourseCount: filteredCourses.length,
      skippedNonMatchingCourses,
      syncedCourseCount: filteredCourses.length,
      courseworkFetchedCount,
      announcementsFetchedCount,
      assignmentsPrepared: normalizedItems.filter((item) => item.importType === "assignment").length,
      announcementInstructionsPrepared,
      skippedAnnouncementsCount,
      skippedUnsupportedItemsCount,
      announcementSupport: announcementScopeWarning ? "reconnect-required" : "instruction-announcements-imported",
      announcementScopeWarning,
      workTypeCounts,
      matchedCourses: filteredCourses.map((course) => ({
        id: course.id,
        name: course.name,
        section: course.section || ""
      }))
    }
  };
}

module.exports = {
  filterCourses,
  fetchCourses,
  fetchNormalizedItems
};

const Assignment = require("../models/Assignment");
const Reminder = require("../models/Reminder");
const Note = require("../models/Note");
const NotificationLog = require("../models/NotificationLog");
const Room = require("../models/Room");
const RoomAnnouncement = require("../models/RoomAnnouncement");
const RoomAssignment = require("../models/RoomAssignment");
const RoomAssignmentProgress = require("../models/RoomAssignmentProgress");
const SourceConnection = require("../models/SourceConnection");
const { calculateStreakSummary } = require("./streakService");
const { buildCalendarExport } = require("./calendarExportService");
const { buildFacultyOverview } = require("./roomAggregationService");
const { getRoomMembership, sanitizeRoom } = require("./roomAccessService");

function buildStatusGroups(assignments) {
  return assignments.reduce(
    (groups, assignment) => {
      groups[assignment.status].push(assignment);
      return groups;
    },
    {
      todo: [],
      "in-progress": [],
      completed: []
    }
  );
}

function formatCalendarItems(assignments) {
  return assignments.map((assignment) => ({
    id: assignment._id,
    title: assignment.title,
    dueDate: assignment.dueDate,
    dueTime: assignment.dueTime || "",
    dueDateTime: assignment.dueDateTime || assignment.dueDate || null,
    parseConfidence: assignment.parseConfidence || "",
    ambiguityFlags: assignment.ambiguityFlags || [],
    needsUserReview: Boolean(assignment.needsUserReview),
    subject: assignment.subject,
    course: assignment.course,
    source: assignment.source,
    status: assignment.status,
    priorityBand: assignment.priorityBand
  }));
}

function mapDeadlineItem(item) {
  return {
    id: item._id,
    title: item.title,
    subject: item.subject,
    course: item.course,
    dueDate: item.dueDate,
    dueTime: item.dueTime || "",
    dueDateTime: item.dueDateTime || item.dueDate || null,
    parseConfidence: item.parseConfidence || "",
    ambiguityFlags: item.ambiguityFlags || [],
    needsUserReview: Boolean(item.needsUserReview),
    source: item.source,
    priorityBand: item.priorityBand,
    status: item.status
  };
}

function mapNotificationPreview(log) {
  return {
    id: log._id,
    channel: log.channel,
    title: log.title,
    subject: log.subject,
    course: log.course,
    dueDate: log.dueDate,
    priorityBand: log.priorityBand,
    source: log.source,
    triggerType: log.triggerType,
    status: log.status,
    message: log.message,
    sentAt: log.sentAt
  };
}

function buildProviderCounts(assignments) {
  const emptyCounts = {
    Manual: 0,
    Gmail: 0,
    "Google Classroom": 0,
    Telegram: 0,
    Shared: 0,
    Official: 0
  };

  return assignments.reduce((counts, assignment) => {
    const key = assignment.source || "Manual";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, emptyCounts);
}

function mapIntegrationHealth(connection) {
  return {
    id: connection._id,
    provider: connection.provider || connection.type,
    label: connection.label,
    status: connection.status,
    health: connection.health,
    lastSyncedAt: connection.lastSyncedAt,
    lastSyncResult: connection.lastSyncResult,
    errorState: connection.errorState
  };
}

function mapSharedAssignment(item, roomSummary, progress) {
  const userStatus = progress ? progress.status : "not-started";

  return {
    id: item._id,
    title: item.title,
    instructions: item.instructions,
    description: item.instructions,
    dueDate: item.dueDate,
    dueTime: item.dueTime || "",
    dueDateTime: item.dueDateTime || item.dueDate || null,
    parseConfidence: item.parseConfidence || "",
    ambiguityFlags: item.ambiguityFlags || [],
    needsUserReview: Boolean(item.needsUserReview),
    subject: item.subject,
    course: item.course,
    difficulty: item.difficulty,
    weight: item.weight,
    urgency: item.urgency,
    priorityScore: item.priorityScore,
    priorityBand: item.priorityBand,
    source: item.source || "Room",
    room: roomSummary,
    postedBy: item.postedBy,
    postedAt: item.createdAt,
    referenceLinks: item.referenceLinks || [],
    userStatus,
    completedAt: progress ? progress.completedAt : null,
    isOverdue: item.dueDate ? new Date(item.dueDate) < new Date() && userStatus !== "completed" : false
  };
}

function mapOfficialAnnouncement(item, roomSummary) {
  return {
    id: item._id,
    title: item.title,
    message: item.message,
    category: item.category,
    pinned: item.pinned,
    showOnDashboard: item.showOnDashboard,
    postedBy: item.postedBy,
    createdAt: item.createdAt,
    dueDate: item.dueDate || null,
    dueTime: item.dueTime || "",
    dueDateTime: item.dueDateTime || item.dueDate || null,
    parseConfidence: item.parseConfidence || "",
    ambiguityFlags: item.ambiguityFlags || [],
    needsUserReview: Boolean(item.needsUserReview),
    source: "Official",
    room: roomSummary
  };
}

async function buildSharedWorkspace(user) {
  const rooms = await Room.find({
    "members.user": user._id,
    archived: false
  })
    .populate("owner", "name email role")
    .populate("members.user", "name email role")
    .sort({ createdAt: -1 });

  if (!rooms.length) {
    return {
      analytics: {
        activeRoomCount: 0,
        managedRoomCount: 0,
        sharedAssignmentCount: 0,
        overdueSharedCount: 0,
        officialAnnouncementCount: 0
      },
      rooms: [],
      sharedAssignments: [],
      upcomingSharedDeadlines: [],
      officialAnnouncements: [],
      managedRoomIds: []
    };
  }

  const roomIds = rooms.map((room) => room._id);
  const roomSummaries = rooms.map((room) => sanitizeRoom(room, user._id));
  const roomLookup = new Map(roomSummaries.map((room) => [String(room.id), room]));
  const managedRoomIds = rooms
    .filter((room) => {
      const membership = getRoomMembership(room, user._id);
      return membership && ["room-admin", "professor", "coordinator"].includes(membership.role);
    })
    .map((room) => String(room._id));

  const [roomAssignments, progressRecords, announcements] = await Promise.all([
    RoomAssignment.find({
      room: { $in: roomIds },
      archived: false
    })
      .populate("postedBy", "name email role")
      .sort({ dueDate: 1, createdAt: -1 }),
    RoomAssignmentProgress.find({
      room: { $in: roomIds },
      user: user._id
    }),
    RoomAnnouncement.find({
      room: { $in: roomIds },
      archived: false,
      showOnDashboard: true
    })
      .populate("postedBy", "name email role")
      .sort({ pinned: -1, createdAt: -1 })
  ]);

  const progressLookup = new Map(
    progressRecords.map((progress) => [String(progress.roomAssignment), progress])
  );
  const sharedAssignments = roomAssignments.map((assignment) =>
    mapSharedAssignment(
      assignment,
      roomLookup.get(String(assignment.room)),
      progressLookup.get(String(assignment._id))
    )
  );
  const actionableAssignments = sharedAssignments.filter(
    (assignment) => assignment.userStatus !== "completed"
  );
  const officialAnnouncements = announcements.map((announcement) =>
    mapOfficialAnnouncement(announcement, roomLookup.get(String(announcement.room)))
  );

  return {
    analytics: {
      activeRoomCount: roomSummaries.length,
      managedRoomCount: managedRoomIds.length,
      sharedAssignmentCount: sharedAssignments.length,
      overdueSharedCount: actionableAssignments.filter((assignment) => assignment.isOverdue).length,
      officialAnnouncementCount: officialAnnouncements.length
    },
    rooms: roomSummaries,
    managedRoomIds,
    sharedAssignments: actionableAssignments,
    upcomingSharedDeadlines: actionableAssignments
      .filter((assignment) => assignment.dueDate && new Date(assignment.dueDate) >= new Date())
      .slice(0, 6),
    officialAnnouncements: officialAnnouncements.slice(0, 8)
  };
}

async function buildDashboardOverview(userOrId) {
  const user = typeof userOrId === "object" && userOrId !== null
    ? userOrId
    : { _id: userOrId, role: "student" };
  const userId = user._id;
  const now = new Date();
  const weekAhead = new Date(now);
  weekAhead.setDate(now.getDate() + 7);

  const [assignments, reminders, notes, noteCount, notificationLogs, sourceConnections, sharedWorkspace] = await Promise.all([
    Assignment.find({ user: userId }).sort({ dueDate: 1, createdAt: -1 }),
    Reminder.find({ user: userId }).sort({ dueDate: 1, createdAt: -1 }),
    Note.find({ user: userId }).sort({ createdAt: -1 }).limit(8),
    Note.countDocuments({ user: userId }),
    NotificationLog.find({ user: userId }).sort({ sentAt: -1, createdAt: -1 }).limit(8),
    SourceConnection.find({ user: userId }).sort({ updatedAt: -1 }),
    buildSharedWorkspace(user)
  ]);

  const statusGroups = buildStatusGroups(assignments);
  const pendingReminders = reminders.filter((reminder) => reminder.status === "pending");
  const activeAssignments = assignments.filter((assignment) => assignment.status !== "completed");
  const dueThisWeek = activeAssignments.filter((assignment) => {
    const dueDate = new Date(assignment.dueDate);
    return dueDate >= now && dueDate <= weekAhead;
  });
  const overdueAssignments = activeAssignments.filter(
    (assignment) => assignment.dueDate && new Date(assignment.dueDate) < now
  );
  const subjects = [...new Set(assignments.map((assignment) => assignment.subject).filter(Boolean))];
  const streakSummary = calculateStreakSummary(assignments, now);
  const sourceCounts = buildProviderCounts(assignments);
  const integrationHealth = sourceConnections.map(mapIntegrationHealth);
  const upcomingDeadlines = activeAssignments
    .filter((assignment) => assignment.dueDate && new Date(assignment.dueDate) >= now)
    .slice(0, 6)
    .map(mapDeadlineItem);
  const exportPayload = buildCalendarExport(
    [
      ...assignments,
      ...sharedWorkspace.sharedAssignments.map((assignment) => ({
        _id: assignment.id,
        title: assignment.title,
        description: assignment.instructions,
        dueDate: assignment.dueDate,
        dueDateTime: assignment.dueDateTime || assignment.dueDate || null,
        course: assignment.course,
        subject: assignment.subject,
        source: `${assignment.source}:${assignment.room ? assignment.room.name : "room"}`,
        priorityBand: assignment.priorityBand,
        status: assignment.userStatus === "completed" ? "completed" : "todo"
      }))
    ],
    reminders,
    now
  );
  const facultyWorkspace = sharedWorkspace.managedRoomIds.length
    ? await buildFacultyOverview(user)
    : null;

  return {
    metrics: {
      totalAssignments: assignments.length,
      completedAssignments: statusGroups.completed.length,
      activeAssignments: activeAssignments.length,
      dueThisWeek: dueThisWeek.length,
      pendingReminders: pendingReminders.length,
      noteCount,
      overdueAssignments: overdueAssignments.length,
      currentStreak: streakSummary.currentStreak,
      bestStreak: streakSummary.bestStreak,
      completionRate: streakSummary.completionRate,
      activeRooms: sharedWorkspace.analytics.activeRoomCount,
      sharedAssignments: sharedWorkspace.analytics.sharedAssignmentCount,
      officialAnnouncements: sharedWorkspace.analytics.officialAnnouncementCount,
      importedAssignments:
        (sourceCounts.Gmail || 0) +
        (sourceCounts["Google Classroom"] || 0) +
        (sourceCounts.Telegram || 0),
      failedSyncs: integrationHealth.filter((item) => item.health === "error").length
    },
    kanban: statusGroups,
    calendar: formatCalendarItems(assignments),
    reminders: pendingReminders,
    notes,
    subjects,
    streakSummary,
    upcomingDeadlines,
    overdueSummary: {
      count: overdueAssignments.length,
      items: overdueAssignments.slice(0, 5).map(mapDeadlineItem)
    },
    notificationPreview: notificationLogs.map(mapNotificationPreview),
    sourceCounts,
    integrationHealth,
    sharedWorkspace,
    facultyWorkspace,
    calendarExport: {
      endpoint: "/api/exports/calendar",
      eventCount: exportPayload.eventCount
    }
  };
}

module.exports = {
  buildDashboardOverview,
  buildSharedWorkspace
};

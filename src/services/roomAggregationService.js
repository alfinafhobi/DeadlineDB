const Room = require("../models/Room");
const Note = require("../models/Note");
const RoomAnnouncement = require("../models/RoomAnnouncement");
const RoomAssignment = require("../models/RoomAssignment");
const RoomAssignmentProgress = require("../models/RoomAssignmentProgress");
const RoomActivityLog = require("../models/RoomActivityLog");
const { getRoomMembership, sanitizeRoom } = require("./roomAccessService");
const { startOfDay } = require("./streakService");

function normalizeId(value) {
  return String(value && value._id ? value._id : value);
}

function progressRecordMap(progressList) {
  return new Map(progressList.map((record) => [normalizeId(record.roomAssignment), record]));
}

function assignmentProgressSummary(room, assignment, progressList, currentUserId) {
  // Shared room content stays single-source, but each member keeps an independent progress row.
  const memberIds = (room.members || []).map((member) => normalizeId(member.user));
  const byUser = new Map(progressList.map((item) => [normalizeId(item.user), item]));
  const completedUsers = [];
  const pendingUsers = [];
  let completedCount = 0;
  let inProgressCount = 0;

  room.members.forEach((member) => {
    const progress = byUser.get(normalizeId(member.user));
    const status = progress ? progress.status : "not-started";

    if (status === "completed") {
      completedCount += 1;
      completedUsers.push({
        user: member.user,
        role: member.role,
        status
      });
      return;
    }

    if (status === "in-progress") {
      inProgressCount += 1;
    }

    pendingUsers.push({
      user: member.user,
      role: member.role,
      status
    });
  });

  const overdueCount =
    assignment.dueDate && new Date(assignment.dueDate) < new Date()
      ? pendingUsers.length
      : 0;
  const userProgress = byUser.get(normalizeId(currentUserId));

  return {
    id: assignment._id,
    title: assignment.title,
    instructions: assignment.instructions,
    dueDate: assignment.dueDate,
    dueTime: assignment.dueTime || "",
    dueDateTime: assignment.dueDateTime || assignment.dueDate || null,
    parseConfidence: assignment.parseConfidence || "",
    ambiguityFlags: assignment.ambiguityFlags || [],
    needsUserReview: Boolean(assignment.needsUserReview),
    difficulty: assignment.difficulty,
    weight: assignment.weight,
    urgency: assignment.urgency,
    priorityScore: assignment.priorityScore,
    priorityBand: assignment.priorityBand,
    subject: assignment.subject,
    course: assignment.course,
    source: assignment.source || "Room",
    referenceLinks: assignment.referenceLinks || [],
    postedBy: assignment.postedBy,
    postedAt: assignment.createdAt,
    archived: assignment.archived,
    userStatus: userProgress ? userProgress.status : "not-started",
    userCompletedAt: userProgress ? userProgress.completedAt : null,
    completion: {
      completedCount,
      inProgressCount,
      pendingCount: memberIds.length - completedCount,
      completionPercent: memberIds.length
        ? Math.round((completedCount / memberIds.length) * 100)
        : 0,
      overdueCount,
      completedUsers,
      pendingUsers
    }
  };
}

function buildRoomAnalytics(room, assignmentsWithProgress) {
  const activeMemberCount = (room.members || []).length;
  const totalAssignmentsPosted = assignmentsWithProgress.length;
  const totalCompletionPercent = totalAssignmentsPosted
    ? Math.round(
        assignmentsWithProgress.reduce(
          (sum, assignment) => sum + assignment.completion.completionPercent,
          0
        ) / totalAssignmentsPosted
      )
    : 0;
  const overdueCount = assignmentsWithProgress.reduce(
    (sum, assignment) => sum + assignment.completion.overdueCount,
    0
  );
  const mostUrgentDeadlines = assignmentsWithProgress
    .filter((assignment) => assignment.dueDate && new Date(assignment.dueDate) >= startOfDay(new Date()))
    .sort((left, right) => new Date(left.dueDate) - new Date(right.dueDate))
    .slice(0, 5)
    .map((assignment) => ({
      id: assignment.id,
      title: assignment.title,
      dueDate: assignment.dueDate,
      dueTime: assignment.dueTime || "",
      dueDateTime: assignment.dueDateTime || assignment.dueDate || null,
      parseConfidence: assignment.parseConfidence || "",
      ambiguityFlags: assignment.ambiguityFlags || [],
      needsUserReview: Boolean(assignment.needsUserReview),
      subject: assignment.subject,
      completionPercent: assignment.completion.completionPercent
    }));

  return {
    totalAssignmentsPosted,
    completionPercentage: totalCompletionPercent,
    overdueCount,
    activeMemberCount,
    mostUrgentDeadlines
  };
}

async function buildRoomDetail(roomId, user) {
  const room = await Room.findById(roomId)
    .populate("owner", "name email role")
    .populate("members.user", "name email role");

  if (!room) {
    return null;
  }

  const [assignments, progressRecords, announcements, sharedNotes, activity] =
    await Promise.all([
      RoomAssignment.find({ room: room._id, archived: false })
        .populate("postedBy", "name email role")
        .sort({ dueDate: 1, createdAt: -1 }),
      RoomAssignmentProgress.find({ room: room._id }).populate("user", "name email role"),
      RoomAnnouncement.find({ room: room._id, archived: false })
        .populate("postedBy", "name email role")
        .sort({ pinned: -1, createdAt: -1 }),
      Note.find({ room: room._id, isShared: true })
        .populate("user", "name email role")
        .populate("pinnedBy", "name email role")
        .sort({ pinned: -1, sharedAt: -1, createdAt: -1 }),
      RoomActivityLog.find({ room: room._id })
        .populate("actor", "name email role")
        .sort({ createdAt: -1 })
        .limit(12)
    ]);

  const groupedProgress = assignments.map((assignment) => {
    const progressForAssignment = progressRecords.filter(
      (record) => normalizeId(record.roomAssignment) === normalizeId(assignment._id)
    );

    return assignmentProgressSummary(room, assignment, progressForAssignment, user._id);
  });

  return {
    room: sanitizeRoom(room, user._id),
    membership: getRoomMembership(room, user._id),
    owner: room.owner,
    members: (room.members || []).map((member) => ({
      user: member.user,
      role: member.role,
      joinedAt: member.joinedAt
    })),
    assignments: groupedProgress,
    announcements: announcements.map((announcement) => ({
      id: announcement._id,
      title: announcement.title,
      message: announcement.message,
      category: announcement.category,
      postedBy: announcement.postedBy,
      showOnDashboard: announcement.showOnDashboard,
      pinned: announcement.pinned,
      createdAt: announcement.createdAt,
      dueDate: announcement.dueDate || null,
      dueTime: announcement.dueTime || "",
      dueDateTime: announcement.dueDateTime || announcement.dueDate || null,
      parseConfidence: announcement.parseConfidence || "",
      ambiguityFlags: announcement.ambiguityFlags || [],
      needsUserReview: Boolean(announcement.needsUserReview)
    })),
    sharedNotes: sharedNotes.map((note) => ({
      id: note._id,
      subject: note.subject,
      course: note.course,
      content: note.content,
      user: note.user,
      pinned: note.pinned,
      pinnedAt: note.pinnedAt,
      pinnedBy: note.pinnedBy,
      detectedKeywords: note.detectedKeywords,
      sharedAt: note.sharedAt || note.createdAt
    })),
    analytics: buildRoomAnalytics(room, groupedProgress),
    recentActivity: activity.map((entry) => ({
      id: entry._id,
      type: entry.type,
      message: entry.message,
      actor: entry.actor,
      metadata: entry.metadata,
      createdAt: entry.createdAt
    }))
  };
}

async function buildFacultyOverview(user) {
  const rooms = await Room.find({
    members: {
      $elemMatch: {
        user: user._id,
        role: { $in: ["room-admin", "professor", "coordinator"] }
      }
    },
    archived: false
  })
    .populate("owner", "name email role")
    .populate("members.user", "name email role")
    .sort({ createdAt: -1 });

  const roomIds = rooms.map((room) => room._id);

  const [assignments, progressRecords, announcements, activity] = await Promise.all([
    RoomAssignment.find({ room: { $in: roomIds }, archived: false }).sort({ dueDate: 1, createdAt: -1 }),
    RoomAssignmentProgress.find({ room: { $in: roomIds } }).populate("user", "name email role"),
    RoomAnnouncement.find({ room: { $in: roomIds }, archived: false })
      .populate("postedBy", "name email role")
      .sort({ createdAt: -1 })
      .limit(12),
    RoomActivityLog.find({ room: { $in: roomIds } })
      .populate("actor", "name email role")
      .sort({ createdAt: -1 })
      .limit(18)
  ]);

  // Faculty analytics are derived from the same room data contract used by students so both views stay aligned.
  const overviewRooms = rooms.map((room) => {
    const roomAssignments = assignments.filter(
      (assignment) => normalizeId(assignment.room) === normalizeId(room._id)
    );
    const roomProgress = progressRecords.filter(
      (progress) => normalizeId(progress.room) === normalizeId(room._id)
    );
    const assignmentBreakdown = roomAssignments.map((assignment) =>
      assignmentProgressSummary(
        room,
        assignment,
        roomProgress.filter(
          (progress) => normalizeId(progress.roomAssignment) === normalizeId(assignment._id)
        ),
        user._id
      )
    );

    return {
      room: sanitizeRoom(room, user._id),
      analytics: buildRoomAnalytics(room, assignmentBreakdown),
      assignmentsPosted: assignmentBreakdown.length,
      studentsJoined: (room.members || []).filter((member) => member.role === "student").length,
      recentAnnouncements: announcements
        .filter((announcement) => String(announcement.room) === String(room._id))
        .slice(0, 4)
        .map((announcement) => ({
          id: announcement._id,
          title: announcement.title,
          category: announcement.category,
          createdAt: announcement.createdAt,
          dueDate: announcement.dueDate || null,
          dueTime: announcement.dueTime || "",
          dueDateTime: announcement.dueDateTime || announcement.dueDate || null
        })),
      assignmentBreakdown: assignmentBreakdown.map((assignment) => ({
        id: assignment.id,
        title: assignment.title,
        dueDate: assignment.dueDate,
        completionPercent: assignment.completion.completionPercent,
        completedCount: assignment.completion.completedCount,
        pendingCount: assignment.completion.pendingCount,
        overdueCount: assignment.completion.overdueCount,
        subject: assignment.subject,
        course: assignment.course
      }))
    };
  });

  const totalAssignmentsPosted = overviewRooms.reduce(
    (sum, room) => sum + room.assignmentsPosted,
    0
  );
  const totalStudentsJoined = overviewRooms.reduce(
    (sum, room) => sum + room.studentsJoined,
    0
  );
  const totalOverdueStudents = overviewRooms.reduce(
    (sum, room) => sum + room.analytics.overdueCount,
    0
  );
  const averageCompletion = overviewRooms.length
    ? Math.round(
        overviewRooms.reduce((sum, room) => sum + room.analytics.completionPercentage, 0) /
          overviewRooms.length
      )
    : 0;
  const roomLookup = new Map(
    overviewRooms.map((entry) => [String(entry.room.id), entry.room])
  );

  return {
    roomCount: overviewRooms.length,
    summary: {
      managedRoomCount: overviewRooms.length,
      totalAssignmentsPosted,
      totalStudentsJoined,
      totalOverdueStudents,
      averageCompletion,
      recentActivityCount: activity.length
    },
    activeRooms: overviewRooms,
    recentAnnouncements: announcements.slice(0, 6).map((announcement) => ({
      id: announcement._id,
      room: roomLookup.get(String(announcement.room)) || {
        id: announcement.room
      },
      title: announcement.title,
      category: announcement.category,
      postedBy: announcement.postedBy,
      createdAt: announcement.createdAt,
      dueDate: announcement.dueDate || null,
      dueTime: announcement.dueTime || "",
      dueDateTime: announcement.dueDateTime || announcement.dueDate || null
    })),
    recentActivity: activity.map((entry) => ({
      id: entry._id,
      room: roomLookup.get(String(entry.room)) || {
        id: entry.room
      },
      type: entry.type,
      message: entry.message,
      actor: entry.actor,
      createdAt: entry.createdAt
    }))
  };
}

module.exports = {
  buildRoomDetail,
  buildFacultyOverview
};

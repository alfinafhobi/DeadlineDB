const express = require("express");
const mongoose = require("mongoose");

const appConfig = require("../config/appConfig");
const auth = require("../middleware/auth");
const validate = require("../middleware/validate");
const Note = require("../models/Note");
const Room = require("../models/Room");
const RoomAnnouncement = require("../models/RoomAnnouncement");
const RoomAssignment = require("../models/RoomAssignment");
const RoomAssignmentProgress = require("../models/RoomAssignmentProgress");
const RoomActivityLog = require("../models/RoomActivityLog");
const { getOrSetCache, invalidateUserViewCaches } = require("../services/cacheService");
const {
  logDeadlineExtraction,
  resolveDeadlineForRecord
} = require("../services/deadlineExtractionService");
const { calculatePriorityMetrics } = require("../services/priorityService");
const { generateRoomCode } = require("../services/roomCodeService");
const { logRoomActivity } = require("../services/roomActivityService");
const {
  buildFacultyOverview,
  buildRoomDetail
} = require("../services/roomAggregationService");
const {
  getRoomMembership,
  isRoomManager,
  isRoomMember,
  resolveCreatorRole,
  sanitizeRoom
} = require("../services/roomAccessService");
const {
  roomAnnouncementCreateSchema,
  roomAnnouncementUpdateSchema,
  roomAssignmentCreateSchema,
  roomAssignmentProgressSchema,
  roomAssignmentUpdateSchema,
  roomCreateSchema,
  roomJoinSchema,
  roomNotePinSchema
} = require("../validation/schemas");

const router = express.Router();

router.use(auth);

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }

  return fallback;
}

function normalizeReferenceLinks(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveJoinRole(userRole = "student") {
  if (userRole === "professor" || userRole === "coordinator") {
    return userRole;
  }

  return "student";
}

async function getRoomForRequest(roomId) {
  if (!isValidObjectId(roomId)) {
    return null;
  }

  return Room.findById(roomId)
    .populate("owner", "name email role")
    .populate("members.user", "name email role");
}

function ensureMembership(room, userId) {
  return isRoomMember(room, userId);
}

function ensureManager(room, user) {
  return isRoomManager(room, user._id, user.role);
}

function mapRoomSummary(room, userId) {
  return {
    ...sanitizeRoom(room, userId),
    owner: room.owner,
    membersPreview: (room.members || []).slice(0, 6).map((member) => ({
      user: member.user,
      role: member.role,
      joinedAt: member.joinedAt
    }))
  };
}

function invalidateRoomCaches(room) {
  const userIds = (room.members || []).map((member) => member.user && (member.user._id || member.user));
  invalidateUserViewCaches(userIds);
}

router.get("/faculty/overview", async (req, res, next) => {
  try {
    const overview = await getOrSetCache(
      `faculty:${req.user._id}`,
      appConfig.dashboardCacheTtlMs,
      () => buildFacultyOverview(req.user)
    );

    res.json({
      success: true,
      overview
    });
  } catch (error) {
    next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const summaries = await getOrSetCache(
      `rooms:${req.user._id}`,
      appConfig.dashboardCacheTtlMs,
      async () => {
        const rooms = await Room.find({
          "members.user": req.user._id,
          archived: false
        })
          .populate("owner", "name email role")
          .populate("members.user", "name email role")
          .sort({ createdAt: -1 });

        return rooms.map((room) => mapRoomSummary(room, req.user._id));
      }
    );

    res.json({
      success: true,
      rooms: summaries,
      managedRooms: summaries.filter((room) =>
        ["room-admin", "professor", "coordinator"].includes(room.membershipRole)
      ),
      joinedRooms: summaries.filter((room) => room.membershipRole === "student")
    });
  } catch (error) {
    next(error);
  }
});

router.post("/", validate(roomCreateSchema), async (req, res, next) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Room name is required."
      });
    }

    const room = await Room.create({
      name,
      description,
      shareCode: await generateRoomCode(),
      owner: req.user._id,
      members: [
        {
          user: req.user._id,
          role: resolveCreatorRole(req.user.role)
        }
      ]
    });

    await logRoomActivity({
      room: room._id,
      actor: req.user._id,
      type: "room-created",
      message: `${req.user.name} created ${name}.`,
      metadata: {
        roomName: name
      }
    });

    const detail = await buildRoomDetail(room._id, req.user);
    invalidateRoomCaches(room);

    res.status(201).json({
      success: true,
      room: detail
    });
  } catch (error) {
    next(error);
  }
});

router.post("/join", validate(roomJoinSchema), async (req, res, next) => {
  try {
    const shareCode = String(req.body.shareCode || "").trim().toUpperCase();

    if (!shareCode) {
      return res.status(400).json({
        success: false,
        message: "Share code is required."
      });
    }

    const room = await Room.findOne({
      shareCode,
      archived: false
    })
      .populate("owner", "name email role")
      .populate("members.user", "name email role");

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found for that code. Check the latest code from the room owner; local in-memory data resets after a server restart."
      });
    }

    if (isRoomMember(room, req.user._id)) {
      const detail = await buildRoomDetail(room._id, req.user);

      return res.json({
        success: true,
        message: "You are already part of this room.",
        room: detail
      });
    }

    room.members.push({
      user: req.user._id,
      role: resolveJoinRole(req.user.role)
    });
    await room.save();

    await logRoomActivity({
      room: room._id,
      actor: req.user._id,
      type: "room-joined",
      message: `${req.user.name} joined the room.`,
      metadata: {
        shareCode
      }
    });

    const detail = await buildRoomDetail(room._id, req.user);
    invalidateRoomCaches(room);

    res.json({
      success: true,
      message: "Joined room successfully.",
      room: detail
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const room = await getRoomForRequest(req.params.id);

    if (!room || room.archived) {
      return res.status(404).json({
        success: false,
        message: "Room not found."
      });
    }

    if (!ensureMembership(room, req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "Join the room to view its details."
      });
    }

    const detail = await getOrSetCache(
      `rooms:${req.user._id}:detail:${room._id}`,
      appConfig.dashboardCacheTtlMs,
      () => buildRoomDetail(room._id, req.user)
    );

    res.json({
      success: true,
      room: detail
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/activity", async (req, res, next) => {
  try {
    const room = await getRoomForRequest(req.params.id);

    if (!room || room.archived) {
      return res.status(404).json({
        success: false,
        message: "Room not found."
      });
    }

    if (!ensureMembership(room, req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "Join the room to view activity."
      });
    }

    const activity = await RoomActivityLog.find({ room: room._id })
      .populate("actor", "name email role")
      .sort({ createdAt: -1 })
      .limit(24);

    res.json({
      success: true,
      activity: activity.map((entry) => ({
        id: entry._id,
        type: entry.type,
        message: entry.message,
        actor: entry.actor,
        metadata: entry.metadata,
        createdAt: entry.createdAt
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/leave", async (req, res, next) => {
  try {
    const room = await getRoomForRequest(req.params.id);

    if (!room || room.archived) {
      return res.status(404).json({
        success: false,
        message: "Room not found."
      });
    }

    if (!ensureMembership(room, req.user._id)) {
      return res.status(404).json({
        success: false,
        message: "You are not a member of this room."
      });
    }

    if (String(room.owner._id || room.owner) === String(req.user._id)) {
      return res.status(400).json({
        success: false,
        message: "Room owners cannot leave their own room."
      });
    }

    room.members = (room.members || []).filter(
      (member) => String(member.user._id || member.user) !== String(req.user._id)
    );
    await room.save();

    await RoomAssignmentProgress.deleteMany({
      room: room._id,
      user: req.user._id
    });

    await logRoomActivity({
      room: room._id,
      actor: req.user._id,
      type: "room-left",
      message: `${req.user.name} left the room.`
    });
    invalidateRoomCaches(room);
    invalidateUserViewCaches([req.user._id]);

    res.json({
      success: true,
      message: "Left room successfully."
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/assignments", validate(roomAssignmentCreateSchema), async (req, res, next) => {
  try {
    const room = await getRoomForRequest(req.params.id);

    if (!room || room.archived) {
      return res.status(404).json({
        success: false,
        message: "Room not found."
      });
    }

    if (!ensureManager(room, req.user)) {
      return res.status(403).json({
        success: false,
        message: "Only room managers can post shared assignments."
      });
    }

    const {
      title,
      instructions,
      dueDate,
      difficulty,
      weight,
      subject,
      course,
      referenceLinks
    } = req.body;

    if (!title || !dueDate || !subject) {
      return res.status(400).json({
        success: false,
        message: "Title, due date, and subject are required."
      });
    }

    const deadline = resolveDeadlineForRecord({
      text: `${title}\n${instructions || ""}`,
      providedDueDate: dueDate,
      parseSource: "room-assignment"
    });
    const metrics = calculatePriorityMetrics({
      dueDate: deadline.dueDate || dueDate,
      difficulty,
      weight
    });

    const assignment = await RoomAssignment.create({
      room: room._id,
      title,
      instructions,
      dueDate: deadline.dueDate || dueDate,
      ...deadline.fields,
      difficulty,
      weight,
      subject,
      course,
      referenceLinks: normalizeReferenceLinks(referenceLinks),
      postedBy: req.user._id,
      ...metrics
    });

    await logRoomActivity({
      room: room._id,
      actor: req.user._id,
      type: "assignment-posted",
      message: `${req.user.name} posted assignment ${title}.`,
      metadata: {
        assignmentId: assignment._id,
        subject,
        dueDate: deadline.dueDate || dueDate
      }
    });
    logDeadlineExtraction(deadline.extraction, {
      entity: "room-assignment",
      route: "room.assignment.create",
      userId: req.user._id,
      roomId: room._id
    });
    invalidateRoomCaches(room);

    res.status(201).json({
      success: true,
      assignment
    });
  } catch (error) {
    next(error);
  }
});

router.put("/:id/assignments/:assignmentId", validate(roomAssignmentUpdateSchema), async (req, res, next) => {
  try {
    const room = await getRoomForRequest(req.params.id);

    if (!room || room.archived) {
      return res.status(404).json({
        success: false,
        message: "Room not found."
      });
    }

    if (!ensureManager(room, req.user)) {
      return res.status(403).json({
        success: false,
        message: "Only room managers can edit shared assignments."
      });
    }

    const assignment = await RoomAssignment.findOne({
      _id: req.params.assignmentId,
      room: room._id
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Shared assignment not found."
      });
    }

    const nextValues = {
      title: req.body.title ?? assignment.title,
      instructions: req.body.instructions ?? assignment.instructions,
      dueDate: req.body.dueDate ?? assignment.dueDate,
      difficulty: req.body.difficulty ?? assignment.difficulty,
      weight: req.body.weight ?? assignment.weight,
      subject: req.body.subject ?? assignment.subject,
      course: req.body.course ?? assignment.course,
      archived: req.body.archived ?? assignment.archived
    };
    const deadline = resolveDeadlineForRecord({
      text: `${nextValues.title}\n${nextValues.instructions || ""}`,
      providedDueDate: nextValues.dueDate,
      parseSource: "room-assignment"
    });
    nextValues.dueDate = deadline.dueDate || nextValues.dueDate;
    const metrics = calculatePriorityMetrics(nextValues);

    Object.assign(assignment, nextValues, deadline.fields, metrics);

    if (Object.prototype.hasOwnProperty.call(req.body, "referenceLinks")) {
      assignment.referenceLinks = normalizeReferenceLinks(req.body.referenceLinks);
    }

    await assignment.save();
    logDeadlineExtraction(deadline.extraction, {
      entity: "room-assignment",
      route: "room.assignment.update",
      userId: req.user._id,
      roomId: room._id,
      assignmentId: assignment._id
    });
    invalidateRoomCaches(room);

    res.json({
      success: true,
      assignment
    });
  } catch (error) {
    next(error);
  }
});

router.put("/:id/assignments/:assignmentId/progress", validate(roomAssignmentProgressSchema), async (req, res, next) => {
  try {
    const room = await getRoomForRequest(req.params.id);

    if (!room || room.archived) {
      return res.status(404).json({
        success: false,
        message: "Room not found."
      });
    }

    if (!ensureMembership(room, req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "Join the room to track assignment progress."
      });
    }

    const assignment = await RoomAssignment.findOne({
      _id: req.params.assignmentId,
      room: room._id,
      archived: false
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: "Shared assignment not found."
      });
    }

    const status = String(req.body.status || "").trim();

    if (!["not-started", "in-progress", "completed"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Progress status must be not-started, in-progress, or completed."
      });
    }

    const progress = await RoomAssignmentProgress.findOneAndUpdate(
      {
        room: room._id,
        roomAssignment: assignment._id,
        user: req.user._id
      },
      {
        status,
        completedAt: status === "completed" ? new Date() : null
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true
      }
    );

    await logRoomActivity({
      room: room._id,
      actor: req.user._id,
      type: "assignment-progress",
      message: `${req.user.name} marked ${assignment.title} as ${status}.`,
      metadata: {
        assignmentId: assignment._id,
        status
      }
    });
    invalidateRoomCaches(room);

    res.json({
      success: true,
      progress
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/announcements", validate(roomAnnouncementCreateSchema), async (req, res, next) => {
  try {
    const room = await getRoomForRequest(req.params.id);

    if (!room || room.archived) {
      return res.status(404).json({
        success: false,
        message: "Room not found."
      });
    }

    if (!ensureManager(room, req.user)) {
      return res.status(403).json({
        success: false,
        message: "Only room managers can post announcements."
      });
    }

    const { title, message, category, showOnDashboard, pinned } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        message: "Announcement title and message are required."
      });
    }

    const announcementDeadline = resolveDeadlineForRecord({
      text: `${title}\n${message}`,
      parseSource: "room-announcement"
    });
    const announcement = await RoomAnnouncement.create({
      room: room._id,
      title,
      message,
      dueDate: announcementDeadline.dueDate || null,
      ...announcementDeadline.fields,
      category: category || "general",
      postedBy: req.user._id,
      showOnDashboard: toBoolean(showOnDashboard, true),
      pinned: toBoolean(pinned, false)
    });
    logDeadlineExtraction(announcementDeadline.extraction, {
      entity: "room-announcement",
      route: "room.announcement.create",
      userId: req.user._id,
      roomId: room._id
    });

    await logRoomActivity({
      room: room._id,
      actor: req.user._id,
      type: "announcement-posted",
      message: `${req.user.name} posted announcement ${title}.`,
      metadata: {
        announcementId: announcement._id,
        category: announcement.category
      }
    });
    invalidateRoomCaches(room);

    res.status(201).json({
      success: true,
      announcement
    });
  } catch (error) {
    next(error);
  }
});

router.put("/:id/announcements/:announcementId", validate(roomAnnouncementUpdateSchema), async (req, res, next) => {
  try {
    const room = await getRoomForRequest(req.params.id);

    if (!room || room.archived) {
      return res.status(404).json({
        success: false,
        message: "Room not found."
      });
    }

    if (!ensureManager(room, req.user)) {
      return res.status(403).json({
        success: false,
        message: "Only room managers can edit announcements."
      });
    }

    const announcement = await RoomAnnouncement.findOne({
      _id: req.params.announcementId,
      room: room._id
    });

    if (!announcement) {
      return res.status(404).json({
        success: false,
        message: "Announcement not found."
      });
    }

    announcement.title = req.body.title ?? announcement.title;
    announcement.message = req.body.message ?? announcement.message;
    const announcementDeadline = resolveDeadlineForRecord({
      text: `${announcement.title}\n${announcement.message}`,
      parseSource: "room-announcement"
    });
    announcement.dueDate = announcementDeadline.dueDate || null;
    announcement.dueTime = announcementDeadline.fields.dueTime;
    announcement.dueDateTime = announcementDeadline.fields.dueDateTime;
    announcement.rawDetectedDeadlineText = announcementDeadline.fields.rawDetectedDeadlineText;
    announcement.parseConfidence = announcementDeadline.fields.parseConfidence;
    announcement.ambiguityFlags = announcementDeadline.fields.ambiguityFlags;
    announcement.parseSource = announcementDeadline.fields.parseSource;
    announcement.needsUserReview = announcementDeadline.fields.needsUserReview;
    announcement.deadlineExtraction = announcementDeadline.fields.deadlineExtraction;
    announcement.category = req.body.category ?? announcement.category;
    announcement.showOnDashboard = Object.prototype.hasOwnProperty.call(
      req.body,
      "showOnDashboard"
    )
      ? toBoolean(req.body.showOnDashboard, true)
      : announcement.showOnDashboard;
    announcement.pinned = Object.prototype.hasOwnProperty.call(req.body, "pinned")
      ? toBoolean(req.body.pinned, false)
      : announcement.pinned;
    announcement.archived = Object.prototype.hasOwnProperty.call(req.body, "archived")
      ? toBoolean(req.body.archived, false)
      : announcement.archived;

    await announcement.save();
    logDeadlineExtraction(announcementDeadline.extraction, {
      entity: "room-announcement",
      route: "room.announcement.update",
      userId: req.user._id,
      roomId: room._id,
      announcementId: announcement._id
    });
    invalidateRoomCaches(room);

    res.json({
      success: true,
      announcement
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/notes/:noteId/share", async (req, res, next) => {
  try {
    const room = await getRoomForRequest(req.params.id);

    if (!room || room.archived) {
      return res.status(404).json({
        success: false,
        message: "Room not found."
      });
    }

    if (!ensureMembership(room, req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "Join the room to share notes."
      });
    }

    const note = await Note.findOne({
      _id: req.params.noteId,
      user: req.user._id
    });

    if (!note) {
      return res.status(404).json({
        success: false,
        message: "Note not found."
      });
    }

    note.isShared = true;
    note.room = room._id;
    note.sharedAt = new Date();
    note.pinned = false;
    note.pinnedAt = null;
    note.pinnedBy = null;
    await note.save();

    await logRoomActivity({
      room: room._id,
      actor: req.user._id,
      type: "note-shared",
      message: `${req.user.name} shared a note for ${note.subject}.`,
      metadata: {
        noteId: note._id,
        subject: note.subject
      }
    });
    invalidateRoomCaches(room);

    res.json({
      success: true,
      note
    });
  } catch (error) {
    next(error);
  }
});

router.put("/:id/notes/:noteId/pin", validate(roomNotePinSchema), async (req, res, next) => {
  try {
    const room = await getRoomForRequest(req.params.id);

    if (!room || room.archived) {
      return res.status(404).json({
        success: false,
        message: "Room not found."
      });
    }

    if (!ensureManager(room, req.user)) {
      return res.status(403).json({
        success: false,
        message: "Only room managers can pin shared notes."
      });
    }

    const note = await Note.findOne({
      _id: req.params.noteId,
      room: room._id,
      isShared: true
    });

    if (!note) {
      return res.status(404).json({
        success: false,
        message: "Shared note not found."
      });
    }

    const pinned = toBoolean(req.body.pinned, true);
    note.pinned = pinned;
    note.pinnedAt = pinned ? new Date() : null;
    note.pinnedBy = pinned ? req.user._id : null;
    await note.save();

    await logRoomActivity({
      room: room._id,
      actor: req.user._id,
      type: "note-pinned",
      message: `${req.user.name} ${pinned ? "pinned" : "unpinned"} a shared note.`,
      metadata: {
        noteId: note._id,
        pinned
      }
    });
    invalidateRoomCaches(room);

    res.json({
      success: true,
      note
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

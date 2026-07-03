const bcrypt = require("bcryptjs");

const appConfig = require("../config/appConfig");
const User = require("../models/User");
const Assignment = require("../models/Assignment");
const Reminder = require("../models/Reminder");
const Note = require("../models/Note");
const Room = require("../models/Room");
const RoomAssignment = require("../models/RoomAssignment");
const RoomAssignmentProgress = require("../models/RoomAssignmentProgress");
const RoomAnnouncement = require("../models/RoomAnnouncement");
const RoomActivityLog = require("../models/RoomActivityLog");
const SourceConnection = require("../models/SourceConnection");
const NotificationLog = require("../models/NotificationLog");
const { calculatePriorityMetrics } = require("./priorityService");
const { applyAssignmentLifecycle } = require("./assignmentLifecycleService");
const logger = require("../utils/logger");

async function resetCollections() {
  await Promise.all([
    User.deleteMany({}),
    Assignment.deleteMany({}),
    Reminder.deleteMany({}),
    Note.deleteMany({}),
    Room.deleteMany({}),
    RoomAssignment.deleteMany({}),
    RoomAssignmentProgress.deleteMany({}),
    RoomAnnouncement.deleteMany({}),
    RoomActivityLog.deleteMany({}),
    SourceConnection.deleteMany({}),
    NotificationLog.deleteMany({})
  ]);
}

async function createUser(name, email, role, password) {
  return User.create({
    name,
    email,
    role,
    password: await bcrypt.hash(password, 10)
  });
}

async function seedDemoData(options = {}) {
  const { reset = false } = options;
  const demoPassword = appConfig.demoPassword;
  const existingStudent = await User.findOne({
    email: "student.demo@deadlinedb.local"
  }).select("_id email");
  const existingProfessor = await User.findOne({
    email: "prof.demo@deadlinedb.local"
  }).select("_id email");

  if (!reset && existingStudent && existingProfessor) {
    return {
      success: true,
      seeded: false,
      message: "Demo data already exists.",
      demoUsers: [
        {
          role: "student",
          email: existingStudent.email,
          password: demoPassword
        },
        {
          role: "professor",
          email: existingProfessor.email,
          password: demoPassword
        }
      ]
    };
  }

  if (reset || existingStudent || existingProfessor) {
    await resetCollections();
  }

  const [student, professor] = await Promise.all([
    createUser("Demo Student", "student.demo@deadlinedb.local", "student", demoPassword),
    createUser("Demo Professor", "prof.demo@deadlinedb.local", "professor", demoPassword)
  ]);

  const now = new Date();
  const inTwoDays = new Date(now);
  inTwoDays.setDate(now.getDate() + 2);
  const inFourDays = new Date(now);
  inFourDays.setDate(now.getDate() + 4);
  const inSixHours = new Date(now);
  inSixHours.setHours(now.getHours() + 6);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const manualAssignments = [
    {
      title: "DBMS Lab Report",
      description: "Normalize schemas and upload the PDF report.",
      dueDate: inTwoDays,
      difficulty: 4,
      weight: 5,
      subject: "DBMS",
      course: "CS-302",
      source: "Manual",
      status: "todo"
    },
    {
      title: "Operating Systems Quiz Prep",
      description: "Revise deadlocks and synchronization notes.",
      dueDate: inFourDays,
      difficulty: 3,
      weight: 3,
      subject: "Operating Systems",
      course: "CS-304",
      source: "Manual",
      status: "in-progress"
    },
    {
      title: "Networks Worksheet",
      description: "Complete the subnetting worksheet.",
      dueDate: yesterday,
      difficulty: 2,
      weight: 2,
      subject: "Computer Networks",
      course: "CS-306",
      source: "Email",
      status: "completed"
    }
  ];

  const createdAssignments = [];
  for (const item of manualAssignments) {
    const metrics = calculatePriorityMetrics(item);
    createdAssignments.push(
      await Assignment.create(
        applyAssignmentLifecycle(
          {
            user: student._id,
            ...item,
            ...metrics
          },
          null
        )
      )
    );
  }

  const connection = await SourceConnection.create({
    user: student._id,
    type: "telegram",
    provider: "telegram",
    label: "DBMS Telegram Notices",
    selectors: ["DBMS", "Section A"],
    syncMode: "webhook",
    status: "connected",
    health: "limited",
    providerAccountId: "-1001234567890",
    settings: {
      chatIds: ["-1001234567890"],
      botUsername: "deadlinedb_demo_bot",
      courseKeywords: ["DBMS", "Section A"],
      pollingEnabled: false
    },
    lastSyncResult: {
      importedCount: 1,
      skippedDuplicates: 0,
      updatedCount: 0,
      failedRecords: 0,
      message: "Demo Telegram bot source. Official Bot API webhook or polling is required for real imports."
    },
    lastSyncedAt: now
  });

  const importedMetrics = calculatePriorityMetrics({
    dueDate: inSixHours,
    difficulty: 4,
    weight: 4
  });
  const importedAssignment = await Assignment.create({
    user: student._id,
    title: "Mini Project Reminder",
    description: "Submit the ER model screenshots before the lab session.",
    dueDate: inSixHours,
    difficulty: 4,
    weight: 4,
    subject: "DBMS",
    course: "CS-302",
    source: "Telegram",
    ...importedMetrics,
    sourceRef: {
      externalKey: "demo-mini-project",
      selector: "DBMS",
      connection: connection._id
    }
  });

  await Reminder.insertMany([
    {
      user: student._id,
      title: "Bring lab record",
      description: "Carry the signed record for the DBMS lab.",
      dueDate: inSixHours,
      subject: "DBMS",
      course: "CS-302",
      source: "manual",
      priorityBand: "high"
    },
    {
      user: student._id,
      title: "Upcoming: Mini Project Reminder",
      description: "Imported from Telegram (DBMS).",
      dueDate: importedAssignment.dueDate,
      subject: importedAssignment.subject,
      course: importedAssignment.course,
      source: "integration",
      priorityBand: importedAssignment.priorityBand,
      assignment: importedAssignment._id
    }
  ]);

  await Note.create({
    user: student._id,
    subject: "Operating Systems",
    course: "CS-304",
    content: "Important: submit the process scheduling sheet by Friday.",
    detectedKeywords: ["important", "submit"]
  });

  const room = await Room.create({
    name: "Compiler Design Workspace",
    shareCode: "DEMO42",
    description: "Shared class room for announcements, assignments, and pinned notes.",
    owner: professor._id,
    members: [
      { user: professor._id, role: "professor" },
      { user: student._id, role: "student" }
    ]
  });

  const roomAssignmentMetrics = calculatePriorityMetrics({
    dueDate: inFourDays,
    difficulty: 5,
    weight: 5
  });
  const roomAssignment = await RoomAssignment.create({
    room: room._id,
    title: "LL(1) Parser Worksheet",
    instructions: "Submit the parser derivation steps and parse table.",
    dueDate: inFourDays,
    difficulty: 5,
    weight: 5,
    subject: "Compiler Design",
    course: "CS-402",
    referenceLinks: ["https://example.com/parser-demo"],
    postedBy: professor._id,
    ...roomAssignmentMetrics
  });

  await RoomAssignmentProgress.create({
    room: room._id,
    roomAssignment: roomAssignment._id,
    user: student._id,
    status: "in-progress"
  });

  await RoomAnnouncement.create({
    room: room._id,
    title: "Lab Schedule Update",
    message: "Tomorrow's class starts 30 minutes early. Bring your parser worksheet.",
    category: "urgent",
    postedBy: professor._id,
    showOnDashboard: true,
    pinned: true
  });

  const sharedNote = await Note.create({
    user: student._id,
    subject: "Compiler Design",
    course: "CS-402",
    content: "Important: due tomorrow, submit the parser worksheet and DFA notes.",
    detectedKeywords: ["important", "due", "submit"],
    isShared: true,
    room: room._id,
    sharedAt: now,
    pinned: true,
    pinnedAt: now,
    pinnedBy: professor._id
  });

  await RoomActivityLog.insertMany([
    {
      room: room._id,
      actor: professor._id,
      type: "room-created",
      message: "Demo Professor created Compiler Design Workspace."
    },
    {
      room: room._id,
      actor: professor._id,
      type: "assignment-posted",
      message: "Demo Professor posted LL(1) Parser Worksheet.",
      metadata: {
        assignmentId: roomAssignment._id
      }
    },
    {
      room: room._id,
      actor: student._id,
      type: "note-shared",
      message: "Demo Student shared a note for Compiler Design.",
      metadata: {
        noteId: sharedNote._id
      }
    }
  ]);

  await NotificationLog.create({
    user: student._id,
    channel: "email",
    entityType: "assignment",
    entityId: importedAssignment._id,
    title: importedAssignment.title,
    subject: importedAssignment.subject,
    course: importedAssignment.course,
    dueDate: importedAssignment.dueDate,
    priorityBand: importedAssignment.priorityBand,
    source: importedAssignment.source,
    triggerType: "due-in-6-hours",
    triggerKey: `assignment:${importedAssignment._id}:due-6h`,
    message: "Demo reminder for the imported assignment.",
    status: "simulated",
    simulated: true,
    sentAt: now
  });

  logger.info("demo.seeded", {
    roomCode: room.shareCode,
    studentEmail: student.email,
    professorEmail: professor.email
  });

  return {
    success: true,
    seeded: true,
    demoUsers: [
      {
        role: "student",
        email: student.email,
        password: demoPassword
      },
      {
        role: "professor",
        email: professor.email,
        password: demoPassword
      }
    ],
    roomCode: room.shareCode,
    seededAssignments: createdAssignments.length + 1,
    seededRoomAssignments: 1,
    seededAnnouncements: 1,
    seededNotes: 2
  };
}

module.exports = {
  seedDemoData
};

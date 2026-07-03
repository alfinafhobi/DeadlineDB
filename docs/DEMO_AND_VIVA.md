# Demo and Viva Prep

## 2 to 3 Minute Demo Script

“DeadlineDB is a college assignment aggregator and productivity dashboard. The main problem it solves is that students receive deadline updates from many places such as Telegram groups, Gmail, Google Classroom, and class notes. Instead of tracking everything manually, DeadlineDB converts those scattered updates into a single structured dashboard.

On the personal side, students can manage assignments, move them across a Kanban board, view deadlines in a calendar, store class notes, and automatically create reminders from keywords such as submit, due, and deadline. The system also runs cron-based reminder sweeps and tracks streaks and completion progress to improve follow-through.

The second part is collaboration. We added shared academic rooms so professors, coordinators, and study groups can post assignments, announcements, and pinned notes inside a class workspace. Shared assignments keep one common definition, but each student still tracks progress independently. Faculty also get an overview dashboard showing room activity, completion percentages, overdue counts, and engagement. So DeadlineDB combines personal planning, multi-source aggregation, and collaborative classroom coordination in one platform.” 

## Suggested Live Demo Flow

1. Log in as the seeded student user.
2. Show the dashboard:
   - personal metrics
   - Kanban board
   - calendar
   - shared assignments and official announcements
3. Open Notes:
   - type or show a note with `submit` and `deadline`
   - explain automatic reminder detection
4. Open Reminders:
   - show manual + auto reminders
5. Open Integrations:
   - explain official Google Classroom/Gmail OAuth plus Telegram Bot API sync
6. Open My Rooms:
   - show joined room and share code
7. Open Room Details:
   - show shared assignment
   - show per-student progress
   - show announcement board
   - show shared notes
8. Log in as the professor user:
   - open Faculty Overview
   - show room analytics and completion visibility

## Key Highlights to Mention

- Telegram, Gmail, and Google Classroom normalization
- note-to-reminder keyword detection
- Kanban + calendar hybrid planning
- cron-based smart reminders
- streak system and productivity metrics
- shared rooms with faculty visibility

## Common Viva Questions and Answers

### Why did you choose this project?

Students often miss deadlines because updates are scattered. I wanted to build one platform that combines deadline tracking, reminders, and collaborative classroom coordination.

### Why not connect directly to LMS portals?

The project requirement explicitly avoided extra LMS portals. We focused on Telegram, Gmail, and Google Classroom only.

### How do shared assignments work?

The assignment definition is stored once at room level, but student completion is stored separately in `RoomAssignmentProgress`, so every member can track status independently.

### How are reminders generated from notes?

When a note is saved, the backend scans it for keywords such as `submit`, `deadline`, `due`, `important`, and `assignment`. If a relevant phrase is found, a reminder card is created automatically.

### How does the scheduler avoid duplicate reminders?

Assignments and reminders store sent notification keys in `notificationState.sentKeys`, so the cron job can detect that a window such as `due-24h` or `overdue-1d` has already been sent.

### How is security handled?

The app uses JWT auth, Joi validation, request sanitization, Helmet, rate limiting, CORS control, and centralized error handling.

### What makes the faculty dashboard different from a grading system?

It is not designed for marks or grading. It focuses on deadline communication, room activity, completion visibility, and coordination.

### How would you scale it further?

I would replace in-memory caching with Redis, move notifications to a queue, add provider-level retry queues, and deploy MongoDB on Atlas with monitoring.

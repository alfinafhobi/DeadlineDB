(function () {
  const KEYWORDS = ["submit", "deadline", "due", "important", "reminder", "assignment"];
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const ROOM_MANAGER_ROLES = ["room-admin", "professor", "coordinator"];
  const state = {
    user: null,
    overview: null,
    assignments: [],
    reminders: [],
    notes: [],
    connections: [],
    rooms: [],
    managedRooms: [],
    joinedRooms: [],
    currentRoomId: null,
    currentRoom: null,
    facultyOverview: null,
    assignmentMap: new Map(),
    noteMap: new Map(),
    roomMap: new Map(),
    activeView: "dashboard",
    calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    selectedDateKey: toDateKey(new Date()),
    timer: null,
    bound: false,
    loadingDepth: 0
  };

  const presets = {
    telegram: {
      label: "Department Telegram Notices",
      selectors: "DBMS, Lab Section 3",
      hint: "Official Telegram Bot API only. Add approved chat IDs and topic/course keywords.",
      sample: "botToken=123456:ABC; chatIds=-1001234567890; pollingEnabled=true; webhookSecret=optional-secret"
    },
    gmail: {
      label: "Academic Gmail",
      selectors: "faculty@college.edu, assignments, deadline",
      hint: "Use OAuth, then choose Gmail sender, label, keyword, or search-query filters.",
      sample: "query=assignment OR deadline; senderFilters=faculty@college.edu; keywordFilters=submit,due"
    },
    "google-classroom": {
      label: "Google Classroom",
      selectors: "Cloud Computing, Section B",
      hint: "Use OAuth, then add optional course names or course IDs to limit sync.",
      sample: "courseNames=Cloud Computing,DBMS; courseIds=optional Classroom course IDs"
    }
  };

  function bindEvents() {
    if (state.bound) return;
    state.bound = true;

    $("#assignmentForm").on("submit", onAssignmentSubmit);
    $("#cancelAssignmentEdit").on("click", resetAssignmentForm);
    $("#noteForm").on("submit", onNoteSubmit);
    $("#reminderForm").on("submit", onReminderSubmit);
    $("#integrationForm").on("submit", onIntegrationSubmit);
    $("#createRoomForm").on("submit", onCreateRoomSubmit);
    $("#joinRoomForm").on("submit", onJoinRoomSubmit);
    $("#roomAssignmentForm").on("submit", onRoomAssignmentSubmit);
    $("#roomAnnouncementForm").on("submit", onRoomAnnouncementSubmit);
    $("#integrationType").on("change", syncPreset);
    $("#noteEditor").on("input", updateNotePreview);
    $("#shareNoteCheckbox").on("change", onShareNoteToggle);
    $(".editor-btn").on("click", onEditorButton);
    $("#syncAllBtn").on("click", onSyncAll);
    $("#exportCalendarBtn").on("click", onExportCalendar);
    $("#navNotificationsBtn").on("click", () => switchView("reminders"));
    $("#dashboardPrevMonthBtn, #calendarPrevMonthBtn").on("click", () => shiftMonth(-1));
    $("#dashboardNextMonthBtn, #calendarNextMonthBtn").on("click", () => shiftMonth(1));
    $(document).on("click", "[data-view]", onViewClick);
    $(document).on("click", "[data-action='edit-assignment']", onEditAssignment);
    $(document).on("click", "[data-action='delete-assignment']", onDeleteAssignment);
    $(document).on("click", "[data-action='cycle-status']", onCycleStatus);
    $(document).on("click", "[data-action='reminder-status']", onReminderStatus);
    $(document).on("click", "[data-action='delete-reminder']", onDeleteReminder);
    $(document).on("click", "[data-action='sync-connection']", onSyncConnection);
    $(document).on("click", "[data-action='connect-oauth']", onConnectOAuth);
    $(document).on("click", "[data-action='discover-telegram-chats']", onDiscoverTelegramChats);
    $(document).on("click", "[data-action='test-telegram-integration']", onTestTelegramIntegration);
    $(document).on("click", "[data-action='disconnect-connection']", onDisconnectConnection);
    $(document).on("click", "[data-action='open-room']", onOpenRoom);
    $(document).on("click", "[data-action='leave-room']", onLeaveRoom);
    $(document).on("click", "[data-action='room-progress']", onRoomProgress);
    $(document).on("click", "[data-action='pin-room-note']", onPinRoomNote);
    $(document).on("click", "[data-action='copy-room-code']", onCopyRoomCode);
    $(document).on("click", ".calendar-cell[data-date]", onCalendarDateClick);
  }

  function init(user) {
    state.user = user;
    bindEvents();
    resetAssignmentForm();
    resetRoomForms();
    syncPreset();
    updateProfile();
    switchView(state.activeView, false);
    clearInterval(state.timer);
    state.timer = setInterval(updateCountdowns, 60000);
    refresh();
  }

  function teardown() {
    state.user = null;
    state.overview = null;
    state.assignments = [];
    state.reminders = [];
    state.notes = [];
    state.connections = [];
    state.rooms = [];
    state.managedRooms = [];
    state.joinedRooms = [];
    state.currentRoomId = null;
    state.currentRoom = null;
    state.facultyOverview = null;
    state.assignmentMap = new Map();
    state.noteMap = new Map();
    state.roomMap = new Map();
    state.activeView = "dashboard";
    state.calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    state.selectedDateKey = toDateKey(new Date());
    state.loadingDepth = 0;
    clearInterval(state.timer);
    $("#syncAllBtn, #navNotificationsBtn, #profileMenu, #facultyNavBtn, #facultyNavBtnMobile").addClass("d-none");
    $("#loadingOverlay").removeClass("active");
    $("#notificationCount").text("0");
    $("#dashboardHeadline").text("Your semester at a glance");
    $("#noteEditor").empty();
    $("#shareNoteCheckbox").prop("checked", false);
    $("#noteShareRoom").prop("disabled", true).html('<option value="">Select room for shared note</option>');
    updateNotePreview();
    switchView("dashboard", false);
    $("#metricsRow, #streakSummaryCard, #upcomingDeadlinesList, #notificationPreviewList, #sharedAssignmentsList, #officialAnnouncementsList, #todoLane, #progressLane, #completedLane, #assignmentLibrary, #dashboardReminderList, #dashboardCalendarGrid, #dashboardDateTasks, #calendarGrid, #calendarDateTasks, #noteList, #reminderList, #connectionList, #roomSummaryMetrics, #roomList, #roomHeroCard, #roomAssignmentsList, #roomAnnouncementsList, #roomNotesList, #roomAnalyticsCard, #roomActivityList, #facultyMetricsRow, #facultyRoomList, #facultyAnnouncementList, #facultyActivityList").html("");
  }

  async function refresh() {
    setAppLoading(true, "Updating workspace...");
    try {
      const roomPromise = state.currentRoomId
        ? window.DeadlineDBAPI.getRoom(state.currentRoomId).catch(() => null)
        : Promise.resolve(null);
      const [overview, assignments, reminders, notes, connections, roomsResponse, roomDetail] =
        await Promise.all([
          window.DeadlineDBAPI.getOverview(),
          window.DeadlineDBAPI.getAssignments(),
          window.DeadlineDBAPI.getReminders(),
          window.DeadlineDBAPI.getNotes(),
          window.DeadlineDBAPI.listIntegrations(),
          window.DeadlineDBAPI.getRooms(),
          roomPromise
        ]);

      state.overview = overview.overview || {};
      state.assignments = (assignments.assignments || []).slice().sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
      state.reminders = (reminders.reminders || []).slice().sort((a, b) => reminderSortValue(a) - reminderSortValue(b));
      state.notes = notes.notes || [];
      state.connections = connections.connections || [];
      state.rooms = roomsResponse.rooms || [];
      state.managedRooms = roomsResponse.managedRooms || [];
      state.joinedRooms = roomsResponse.joinedRooms || [];
      state.facultyOverview = state.overview.facultyWorkspace || null;
      state.assignmentMap = new Map(state.assignments.map((item) => [item._id, item]));
      state.noteMap = new Map(state.notes.map((item) => [item._id, item]));
      state.roomMap = new Map(state.rooms.map((room) => [String(room.id), room]));

      if (state.currentRoomId) {
        if (roomDetail && roomDetail.room) {
          state.currentRoom = roomDetail.room;
        } else {
          state.currentRoomId = null;
          state.currentRoom = null;
          if (state.activeView === "roomDetail") {
            switchView("rooms");
          }
        }
      } else {
        state.currentRoom = null;
      }

      populateShareRoomOptions();
      renderMetrics(state.overview.metrics || {});
      renderDashboardInsights();
      renderKanban();
      renderAssignmentLibrary();
      renderReminders();
      renderNotes();
      renderConnections();
      renderRooms();
      renderCurrentRoom();
      renderFacultyOverview();
      renderCalendars();
      setCounts();
      updateRoleViews();
      updateCountdowns();
    } catch (error) {
      showToast(error.message, "danger");
    } finally {
      setAppLoading(false);
    }
  }

  function renderMetrics(metrics) {
    const items = [
      ["Active Assignments", metrics.activeAssignments || state.assignments.filter((item) => item.status !== "completed").length, "bi-lightning-charge"],
      ["Shared Assignments", metrics.sharedAssignments || sharedAssignments().length, "bi-people"],
      ["Active Rooms", metrics.activeRooms || state.rooms.length, "bi-door-open"],
      ["Due This Week", metrics.dueThisWeek || 0, "bi-calendar-event"],
      ["Overdue", metrics.overdueAssignments || 0, "bi-exclamation-octagon"],
      ["Imported", metrics.importedAssignments || 0, "bi-cloud-arrow-down"],
      ["Sync Warnings", metrics.failedSyncs || 0, "bi-exclamation-triangle"],
      ["Pending Reminders", pendingReminders().length, "bi-bell"],
      ["Current Streak", metrics.currentStreak || 0, "bi-fire"],
      ["Completion Rate", `${metrics.completionRate || 0}%`, "bi-graph-up-arrow"]
    ];

    $("#metricsRow").html(items.map(([label, value, icon]) => `
      <div class="col-12 col-sm-6 col-xl-3">
        <article class="metric-card">
          <div class="metric-label"><i class="bi ${icon}"></i>${escapeHtml(label)}</div>
          <h3>${value}</h3>
          <p class="mb-0 text-muted-app">Live from your workspace.</p>
        </article>
      </div>`).join(""));
  }

  function renderDashboardInsights() {
    renderStreakSummary();
    renderUpcomingDeadlines();
    renderNotificationPreview();
    renderSharedAssignmentsWidget();
    renderOfficialAnnouncementsWidget();
  }

  function renderStreakSummary() {
    const streak = state.overview && state.overview.streakSummary ? state.overview.streakSummary : null;
    if (!streak) {
      $("#streakSummaryCard").html('<div class="empty-state">No streak data yet.</div>');
      return;
    }

    const badges = streak.badges && streak.badges.length
      ? `<div class="badge-cloud">${streak.badges.map((badge) => `<span class="status-chip info">${escapeHtml(badge.label)}</span>`).join("")}</div>`
      : '<div class="text-muted-app">Complete assignments to unlock milestone badges.</div>';

    $("#streakSummaryCard").html(`
      <div class="summary-grid">
        <div class="summary-stat"><strong>${streak.currentStreak}</strong><span>Current streak</span></div>
        <div class="summary-stat"><strong>${streak.bestStreak}</strong><span>Best streak</span></div>
        <div class="summary-stat"><strong>${streak.totalCompletedAssignments}</strong><span>Total completed</span></div>
        <div class="summary-stat"><strong>${streak.daysWithCompletedTasks}</strong><span>Active completion days</span></div>
      </div>
      <div>
        <div class="d-flex justify-content-between align-items-center mb-2">
          <strong>Weekly progress</strong>
          <span class="text-muted-app">${streak.weeklyProgress.completedLast7Days}/${streak.weeklyProgress.weeklyTarget}</span>
        </div>
        <div class="progress-strip">
          <div class="progress-fill" style="width: ${streak.weeklyProgress.progressPercent}%"></div>
        </div>
      </div>
      <div class="text-muted-app">${escapeHtml(streak.dailyMomentumMessage || "Keep the streak going.")}</div>
      ${badges}
    `);
  }

  function renderUpcomingDeadlines() {
    const items = state.overview && Array.isArray(state.overview.upcomingDeadlines) ? state.overview.upcomingDeadlines : [];
    $("#upcomingDeadlinesList").html(items.length ? items.map((item) => `
      <article class="stack-card">
        <div class="card-topline">
          <div>
            <h3 class="card-title">${escapeHtml(item.title)}</h3>
            <p class="card-subject">Personal · ${escapeHtml(item.subject)}${item.course ? ` - ${escapeHtml(item.course)}` : ""}</p>
          </div>
          <span class="status-chip ${item.priorityBand}">${escapeHtml(item.priorityBand)}</span>
        </div>
        <div class="meta-row">
          <span class="meta-pill"><i class="bi bi-calendar-event"></i>${formatDeadline(item)}</span>
          <span class="meta-pill">${escapeHtml(item.source)}</span>
          ${deadlineStatusPills(item)}
        </div>
      </article>`).join("") : '<div class="empty-state">No upcoming personal deadlines.</div>');
  }

  function renderNotificationPreview() {
    const items = state.overview && Array.isArray(state.overview.notificationPreview) ? state.overview.notificationPreview : [];
    $("#notificationPreviewList").html(items.length ? items.map((item) => `
      <article class="stack-card">
        <div class="card-topline">
          <div>
            <h3 class="card-title">${escapeHtml(item.title)}</h3>
            <p class="card-subject">${escapeHtml(item.triggerType)}</p>
          </div>
          <span class="status-chip ${item.status === "sent" ? "info" : "medium"}">${escapeHtml(item.status)}</span>
        </div>
        <div class="log-meta">
          <span class="meta-pill">${escapeHtml(item.source || "system")}</span>
          <span class="meta-pill">${formatDateTime(item.sentAt)}</span>
        </div>
      </article>`).join("") : '<div class="empty-state">No notification activity yet.</div>');
  }

  function renderSharedAssignmentsWidget() {
    const items = sharedAssignments().slice(0, 6);
    $("#sharedAssignmentsList").html(items.length ? items.map((item) => `
      <article class="stack-card">
        <div class="card-topline">
          <div>
            <h3 class="card-title">${escapeHtml(item.title)}</h3>
            <p class="card-subject">Shared · ${escapeHtml(item.room ? item.room.name : "Room")}</p>
          </div>
          <span class="status-chip ${item.priorityBand || "medium"}">${escapeHtml(item.priorityBand || "medium")}</span>
        </div>
        <div class="meta-row">
          <span class="meta-pill"><i class="bi bi-calendar-event"></i>${formatDeadline(item)}</span>
          <span class="meta-pill">${escapeHtml(item.userStatus)}</span>
          ${deadlineStatusPills(item)}
        </div>
        <div class="action-row-wrap mt-2">
          ${roomProgressButtons(item.room ? item.room.id : "", item.id, item.userStatus)}
          <button class="btn-chip" type="button" data-action="open-room" data-id="${item.room ? item.room.id : ""}">Open Room</button>
        </div>
      </article>`).join("") : '<div class="empty-state">No shared assignments from your rooms yet.</div>');
  }

  function renderOfficialAnnouncementsWidget() {
    const items = officialAnnouncements().slice(0, 6);
    $("#officialAnnouncementsList").html(items.length ? items.map((item) => `
      <article class="stack-card">
        <div class="card-topline">
          <div>
            <h3 class="card-title">${escapeHtml(item.title)}</h3>
            <p class="card-subject">Official · ${escapeHtml(item.room ? item.room.name : "Room")}</p>
          </div>
          <span class="status-chip ${announcementTone(item.category)}">${escapeHtml(item.category)}</span>
        </div>
        <p class="card-description line-clamp-3">${escapeHtml(item.message)}</p>
        <div class="meta-row">
          <span class="meta-pill">${formatDateTime(item.createdAt)}</span>
          ${item.pinned ? '<span class="meta-pill"><i class="bi bi-pin-angle-fill"></i>Pinned</span>' : ""}
          ${item.dueDate || item.dueDateTime || item.dueTime ? `<span class="meta-pill"><i class="bi bi-calendar-event"></i>${formatDeadline(item)}</span>` : ""}
          ${deadlineStatusPills(item)}
        </div>
      </article>`).join("") : '<div class="empty-state">No official announcements yet.</div>');
  }

  function renderKanban() {
    renderLane("todo", "#todoLane", "#todoEmpty", "#countTodo");
    renderLane("in-progress", "#progressLane", "#progressEmpty", "#countProgress");
    renderLane("completed", "#completedLane", "#completedEmpty", "#countCompleted");
    initSortable();
  }

  function renderLane(status, laneSel, emptySel, countSel) {
    const items = state.assignments.filter((item) => item.status === status);
    $(countSel).text(items.length);
    $(laneSel).html(items.map((item) => assignmentCard(item)).join(""));
    $(emptySel).toggleClass("d-none", items.length > 0);
  }

  function renderAssignmentLibrary() {
    $("#assignmentLibrary").html(state.assignments.length ? state.assignments.map((item) => assignmentCard(item)).join("") : '<div class="empty-state">No assignments yet. Add one or sync a source.</div>');
  }

  function assignmentCard(item) {
    const next = item.status === "todo" ? ["Start", "in-progress"] : item.status === "in-progress" ? ["Complete", "completed"] : ["Reopen", "todo"];
    return `<article class="assignment-card" data-id="${item._id}" data-status="${item.status}">
      <div class="card-topline">
        <div>
          <h3 class="card-title">${escapeHtml(item.title)}</h3>
          <p class="card-subject">Personal · ${escapeHtml(item.subject)}${item.course ? ` - ${escapeHtml(item.course)}` : ""}</p>
        </div>
        <span class="status-chip ${item.priorityBand}">${escapeHtml(item.priorityBand)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-pill"><i class="bi bi-calendar-event"></i>${formatDeadline(item)}</span>
        <span class="meta-pill countdown-label" data-due-date="${escapeHtml(deadlineValue(item) || item.dueDate)}">Calculating...</span>
        <span class="meta-pill"><i class="bi bi-lightning-charge"></i>Score ${item.priorityScore || 0}</span>
        <span class="meta-pill">${escapeHtml(item.source)}</span>
        ${deadlineStatusPills(item)}
      </div>
      <p class="card-description">${escapeHtml(item.description || "No description provided.")}</p>
      <div class="card-actions">
        <button class="btn-chip" type="button" data-action="cycle-status" data-id="${item._id}" data-status="${next[1]}">${next[0]}</button>
        <button class="btn-chip" type="button" data-action="edit-assignment" data-id="${item._id}">Edit</button>
        <button class="btn-chip" type="button" data-action="delete-assignment" data-id="${item._id}">Delete</button>
      </div>
    </article>`;
  }

  function renderReminders() {
    const widget = pendingReminders().slice(0, 4);
    $("#dashboardReminderList").html(widget.length ? widget.map(reminderCard).join("") : '<div class="empty-state">No pending personal reminders right now.</div>');
    $("#reminderList").html(state.reminders.length ? state.reminders.map(reminderCard).join("") : '<div class="empty-state">No reminders yet.</div>');
  }

  function reminderCard(item) {
    const tone = item.status === "done" ? "done" : item.priorityBand || "info";
    return `<article class="stack-card">
      <div class="card-topline">
        <div>
          <h3 class="card-title">${escapeHtml(item.title)}</h3>
          <p class="card-subject">Personal · ${escapeHtml(item.source)} reminder</p>
        </div>
        <span class="status-chip ${tone}">${escapeHtml(item.status)}</span>
      </div>
      <div class="meta-row">
        <span class="meta-pill"><i class="bi bi-clock"></i>${formatDeadline(item)}</span>
        <span class="meta-pill">${escapeHtml(item.priorityBand || "medium")}</span>
        ${deadlineStatusPills(item)}
      </div>
      <p class="card-description">${escapeHtml(item.description || "No reminder details provided.")}</p>
      <div class="card-actions">
        <button class="btn-chip" type="button" data-action="reminder-status" data-id="${item._id}" data-status="done">Done</button>
        <button class="btn-chip" type="button" data-action="reminder-status" data-id="${item._id}" data-status="dismissed">Dismiss</button>
        <button class="btn-chip" type="button" data-action="delete-reminder" data-id="${item._id}">Delete</button>
      </div>
    </article>`;
  }

  function renderNotes() {
    $("#noteList").html(state.notes.length ? state.notes.map((note) => {
      const roomName = note.isShared && note.room ? getRoomName(note.room) : "";
      return `
      <article class="stack-card">
        <div class="card-topline">
          <div>
            <h3 class="card-title">${escapeHtml(note.subject)}${note.course ? ` - ${escapeHtml(note.course)}` : ""}</h3>
            <p class="card-subject">${formatDateTime(note.createdAt)}</p>
          </div>
          <span class="status-chip ${note.isShared ? "info" : "medium"}">${note.isShared ? "shared" : `${(note.detectedKeywords || []).length} tags`}</span>
        </div>
        <div class="meta-row">
          ${(note.detectedKeywords || []).map((word) => `<span class="meta-pill">${escapeHtml(word)}</span>`).join("") || '<span class="meta-pill">No keywords</span>'}
          ${roomName ? `<span class="meta-pill"><i class="bi bi-people"></i>${escapeHtml(roomName)}</span>` : ""}
        </div>
        <p class="card-description">${highlightKeywords(note.content || "")}</p>
      </article>`;
    }).join("") : '<div class="empty-state">No notes yet. Capture one to start the archive.</div>');
  }

  function renderConnections() {
    $("#connectionList").html(state.connections.length ? state.connections.map((conn) => `
      <article class="stack-card">
        <div class="card-topline">
          <div>
            <h3 class="card-title">${escapeHtml(conn.label)}</h3>
            <p class="card-subject">${escapeHtml(providerLabel(conn.provider || conn.type))} official connector</p>
          </div>
          <span class="status-chip ${conn.health === "error" ? "danger" : conn.health === "healthy" ? "success" : "info"}">${escapeHtml(conn.status || "setup-required")}</span>
        </div>
        <div class="meta-row">
          <span class="meta-pill">${lastSyncImportCount(conn)} imported last sync</span>
          <span class="meta-pill">${countImported(conn._id)} linked tasks</span>
          <span class="meta-pill">${escapeHtml((conn.selectors || []).join(", ") || providerGuidance(conn.provider || conn.type))}</span>
          <span class="meta-pill"><i class="bi bi-clock-history"></i>${conn.lastSyncedAt ? formatDateTime(conn.lastSyncedAt) : "Never synced"}</span>
        </div>
        ${conn.errorState && conn.errorState.code ? `<div class="meta-row mt-2"><span class="meta-pill error-code-pill">Code: ${escapeHtml(conn.errorState.code)}</span></div>` : ""}
        ${conn.errorState && conn.errorState.message ? `<div class="empty-state error-state">${escapeHtml(conn.errorState.message)}</div>` : ""}
        <p class="card-description">${escapeHtml(syncMessage(conn))}</p>
        ${connectionSummaryDetails(conn)}
        <div class="card-actions">
          ${isGoogleProvider(conn.provider || conn.type) ? `<button class="btn-chip" type="button" data-action="connect-oauth" data-provider="${conn.provider || conn.type}" data-id="${conn._id}">${conn.status === "connected" ? "Reconnect OAuth" : "Connect OAuth"}</button>` : ""}
          ${(conn.provider || conn.type) === "telegram" ? `<button class="btn-chip" type="button" data-action="test-telegram-integration" data-id="${conn._id}" ${conn.status === "disconnected" ? "disabled" : ""}>Test Telegram</button>` : ""}
          ${(conn.provider || conn.type) === "telegram" ? `<button class="btn-chip" type="button" data-action="discover-telegram-chats" data-id="${conn._id}" ${conn.status === "disconnected" ? "disabled" : ""}>Discover Chats</button>` : ""}
          <button class="btn-chip" type="button" data-action="sync-connection" data-id="${conn._id}" ${conn.status === "disconnected" ? "disabled" : ""}>Sync ${providerShortLabel(conn.provider || conn.type)}</button>
          <button class="btn-chip danger" type="button" data-action="disconnect-connection" data-id="${conn._id}">Disconnect</button>
        </div>
      </article>`).join("") : '<div class="empty-state">No connected sources yet. Add one and sync now.</div>');
  }

  function renderRooms() {
    const analytics = state.overview && state.overview.sharedWorkspace ? state.overview.sharedWorkspace.analytics || {} : {};
    $("#roomSummaryMetrics").html(`
      <div class="summary-grid">
        <div class="summary-stat"><strong>${analytics.activeRoomCount || 0}</strong><span>Active rooms</span></div>
        <div class="summary-stat"><strong>${analytics.managedRoomCount || 0}</strong><span>Managed rooms</span></div>
        <div class="summary-stat"><strong>${analytics.sharedAssignmentCount || 0}</strong><span>Shared tasks</span></div>
        <div class="summary-stat"><strong>${analytics.officialAnnouncementCount || 0}</strong><span>Official posts</span></div>
      </div>
      <div class="text-muted-app">${analytics.overdueSharedCount || 0} shared assignments are overdue across your rooms.</div>
    `);

    $("#roomList").html(state.rooms.length ? state.rooms.map((room) => `
      <article class="stack-card">
        <div class="card-topline">
          <div>
            <h3 class="card-title">${escapeHtml(room.name)}</h3>
            <p class="card-subject">${escapeHtml(room.description || "No description added yet.")}</p>
          </div>
          <span class="status-chip info">${escapeHtml(room.membershipRole || "student")}</span>
        </div>
        <div class="room-pill-row">
          <span class="meta-pill"><i class="bi bi-hash"></i>${escapeHtml(room.shareCode)}</span>
          <span class="meta-pill"><i class="bi bi-people"></i>${room.memberCount} members</span>
          <span class="meta-pill">Created ${formatDate(room.createdAt)}</span>
        </div>
        <div class="card-actions">
          <button class="btn-chip" type="button" data-action="open-room" data-id="${room.id}">Open Workspace</button>
          <button class="btn-chip" type="button" data-action="copy-room-code" data-code="${escapeHtml(room.shareCode)}">Copy Code</button>
          ${canLeaveRoom(room) ? `<button class="btn-chip" type="button" data-action="leave-room" data-id="${room.id}">Leave Room</button>` : ""}
        </div>
      </article>`).join("") : '<div class="empty-state">No rooms yet. Create one or join with a share code.</div>');
  }

  function renderCurrentRoom() {
    const detail = state.currentRoom;
    const hasRoom = Boolean(detail && detail.room);
    const canManage = hasRoom ? canManageRoom(detail) : false;
    [$("#roomAssignmentForm").closest(".panel"), $("#roomAnnouncementForm").closest(".panel")].forEach((panel) => panel.toggleClass("d-none", !hasRoom || !canManage));

    if (!hasRoom) {
      $("#roomHeroCard").html('<div class="empty-state">Open a room to view shared assignments, announcements, and notes.</div>');
      $("#roomAssignmentsList").html('<div class="empty-state">No room selected.</div>');
      $("#roomAnnouncementsList").html('<div class="empty-state">No room selected.</div>');
      $("#roomNotesList").html('<div class="empty-state">No room selected.</div>');
      $("#roomAnalyticsCard").html('<div class="empty-state">No room selected.</div>');
      $("#roomActivityList").html("");
      $("#roomDetailTitle").text("Shared room workspace");
      $("#roomDetailSubtitle").text("Shared assignments, official announcements, collaborative notes, and activity all in one place.");
      return;
    }

    const room = detail.room;
    $("#roomDetailTitle").text(room.name);
    $("#roomDetailSubtitle").text(room.description || "Shared room workspace");
    $("#roomHeroCard").html(`
      <div class="room-hero">
        <div>
          <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
            <span class="room-code"><i class="bi bi-hash"></i>${escapeHtml(room.shareCode)}</span>
            <span class="status-chip info">${escapeHtml(detail.membership ? detail.membership.role : "student")}</span>
            <span class="meta-pill"><i class="bi bi-people"></i>${detail.members.length} members</span>
          </div>
          <h2 class="mb-2">${escapeHtml(room.name)}</h2>
          <p class="text-muted-app mb-3">${escapeHtml(room.description || "No description added yet.")}</p>
          <div class="room-pill-row">
            ${detail.members.slice(0, 6).map((member) => `<span class="meta-pill">${escapeHtml(member.user.name)} · ${escapeHtml(member.role)}</span>`).join("")}
          </div>
        </div>
        <div class="room-meta-grid">
          <div class="room-meta-card"><strong>${detail.analytics.activeMemberCount}</strong><span>Active members</span></div>
          <div class="room-meta-card"><strong>${detail.analytics.totalAssignmentsPosted}</strong><span>Assignments posted</span></div>
          <div class="room-meta-card"><strong>${detail.analytics.completionPercentage}%</strong><span>Completion rate</span></div>
          <div class="room-meta-card"><strong>${detail.analytics.overdueCount}</strong><span>Overdue count</span></div>
        </div>
      </div>`);

    $("#roomAssignmentsList").html(detail.assignments.length ? detail.assignments.map((item) => `
      <article class="stack-card">
        <div class="card-topline">
          <div>
            <h3 class="card-title">${escapeHtml(item.title)}</h3>
            <p class="card-subject">${escapeHtml(item.subject)}${item.course ? ` - ${escapeHtml(item.course)}` : ""}</p>
          </div>
          <span class="status-chip ${item.priorityBand || "medium"}">${escapeHtml(item.priorityBand || "medium")}</span>
        </div>
        <div class="meta-row">
          <span class="meta-pill"><i class="bi bi-calendar-event"></i>${formatDeadline(item)}</span>
          <span class="meta-pill">${escapeHtml(item.userStatus)}</span>
          <span class="meta-pill">Done ${item.completion.completedCount}/${detail.members.length}</span>
          <span class="meta-pill">Overdue ${item.completion.overdueCount}</span>
          ${deadlineStatusPills(item)}
        </div>
        <p class="card-description">${escapeHtml(item.instructions || "No instructions shared.")}</p>
        ${item.referenceLinks && item.referenceLinks.length ? `<div class="meta-row">${item.referenceLinks.map((link) => `<span class="meta-pill">${escapeHtml(link)}</span>`).join("")}</div>` : ""}
        <div class="action-row-wrap mt-2">
          ${roomProgressButtons(room.id, item.id, item.userStatus)}
        </div>
      </article>`).join("") : '<div class="empty-state">No shared assignments have been posted yet.</div>');

    $("#roomAnnouncementsList").html(detail.announcements.length ? detail.announcements.map((item) => `
      <article class="stack-card">
        <div class="card-topline">
          <div>
            <h3 class="card-title">${escapeHtml(item.title)}</h3>
            <p class="card-subject">${item.postedBy ? escapeHtml(item.postedBy.name) : "Official"} · ${formatDateTime(item.createdAt)}</p>
          </div>
          <span class="status-chip ${announcementTone(item.category)}">${escapeHtml(item.category)}</span>
        </div>
        <p class="card-description">${escapeHtml(item.message)}</p>
        <div class="meta-row">
          ${item.showOnDashboard ? '<span class="meta-pill">Visible on dashboard</span>' : '<span class="meta-pill">Room only</span>'}
          ${item.pinned ? '<span class="meta-pill"><i class="bi bi-pin-angle-fill"></i>Pinned</span>' : ""}
          ${item.dueDate || item.dueDateTime || item.dueTime ? `<span class="meta-pill"><i class="bi bi-calendar-event"></i>${formatDeadline(item)}</span>` : ""}
          ${deadlineStatusPills(item)}
        </div>
      </article>`).join("") : '<div class="empty-state">No room announcements yet.</div>');

    $("#roomNotesList").html(detail.sharedNotes.length ? detail.sharedNotes.map((item) => `
      <article class="stack-card">
        <div class="card-topline">
          <div>
            <h3 class="card-title">${escapeHtml(item.subject)}${item.course ? ` - ${escapeHtml(item.course)}` : ""}</h3>
            <p class="card-subject">${item.user ? escapeHtml(item.user.name) : "Shared"} · ${formatDateTime(item.sharedAt)}</p>
          </div>
          <span class="status-chip ${item.pinned ? "high" : "info"}">${item.pinned ? "pinned" : "shared"}</span>
        </div>
        <div class="meta-row">
          ${(item.detectedKeywords || []).map((word) => `<span class="meta-pill">${escapeHtml(word)}</span>`).join("")}
        </div>
        <p class="card-description">${highlightKeywords(item.content || "")}</p>
        ${canManage ? `<div class="card-actions"><button class="btn-chip" type="button" data-action="pin-room-note" data-room-id="${room.id}" data-note-id="${item.id}" data-pinned="${item.pinned ? "false" : "true"}">${item.pinned ? "Unpin" : "Pin"} Note</button></div>` : ""}
      </article>`).join("") : '<div class="empty-state">No shared notes yet. Share one from the Notes page.</div>');

    $("#roomAnalyticsCard").html(`
      <div class="analytics-grid">
        <div class="analytic-tile"><strong>${detail.analytics.totalAssignmentsPosted}</strong><span>Total assignments posted</span></div>
        <div class="analytic-tile"><strong>${detail.analytics.completionPercentage}%</strong><span>Completion percentage</span></div>
        <div class="analytic-tile"><strong>${detail.analytics.overdueCount}</strong><span>Overdue students</span></div>
        <div class="analytic-tile"><strong>${detail.analytics.activeMemberCount}</strong><span>Active member count</span></div>
      </div>
      <div class="mt-3">
        <strong class="d-block mb-2">Most urgent deadlines</strong>
        ${detail.analytics.mostUrgentDeadlines.length ? detail.analytics.mostUrgentDeadlines.map((item) => `
            <div class="meta-row mb-2">
              <span class="meta-pill">${escapeHtml(item.title)}</span>
              <span class="meta-pill">${formatDeadline(item)}</span>
              <span class="meta-pill">${item.completionPercent}% done</span>
              ${deadlineStatusPills(item)}
            </div>`).join("") : '<div class="text-muted-app">No urgent deadlines right now.</div>'}
      </div>`);

    $("#roomActivityList").html(detail.recentActivity.length ? detail.recentActivity.map((item) => `
      <article class="stack-card">
        <div class="card-topline">
          <div>
            <h3 class="card-title">${escapeHtml(item.message)}</h3>
            <p class="card-subject">${item.actor ? escapeHtml(item.actor.name) : "System"}</p>
          </div>
          <span class="status-chip info">${escapeHtml(item.type)}</span>
        </div>
        <div class="meta-row">
          <span class="meta-pill">${formatDateTime(item.createdAt)}</span>
        </div>
      </article>`).join("") : '<div class="empty-state">No room activity yet.</div>');
  }

  function renderFacultyOverview() {
    const overview = state.facultyOverview;
    if (!overview || !overview.roomCount) {
      $("#facultyMetricsRow").html('<div class="col-12"><div class="empty-state">Manage a room to unlock the faculty overview.</div></div>');
      $("#facultyRoomList, #facultyAnnouncementList, #facultyActivityList").html("");
      return;
    }

    const summary = overview.summary || {};
    const cards = [
      ["Managed Rooms", summary.managedRoomCount || overview.roomCount || 0, "bi-easel2"],
      ["Assignments Posted", summary.totalAssignmentsPosted || 0, "bi-journal-richtext"],
      ["Students Joined", summary.totalStudentsJoined || 0, "bi-people-fill"],
      ["Overdue Students", summary.totalOverdueStudents || 0, "bi-exclamation-triangle"],
      ["Average Completion", `${summary.averageCompletion || 0}%`, "bi-bar-chart-line"],
      ["Recent Activity", summary.recentActivityCount || 0, "bi-activity"]
    ];

    $("#facultyMetricsRow").html(cards.map(([label, value, icon]) => `
      <div class="col-12 col-sm-6 col-xl-4">
        <article class="metric-card">
          <div class="metric-label"><i class="bi ${icon}"></i>${escapeHtml(label)}</div>
          <h3>${value}</h3>
          <p class="mb-0 text-muted-app">Across the rooms you manage.</p>
        </article>
      </div>`).join(""));

    $("#facultyRoomList").html(overview.activeRooms.length ? overview.activeRooms.map((item) => `
      <article class="stack-card">
        <div class="card-topline">
          <div>
            <h3 class="card-title">${escapeHtml(item.room.name)}</h3>
            <p class="card-subject">${escapeHtml(item.room.description || "No description added yet.")}</p>
          </div>
          <span class="status-chip info">${escapeHtml(item.room.membershipRole || "manager")}</span>
        </div>
        <div class="analytics-grid mb-3">
          <div class="analytic-tile"><strong>${item.analytics.activeMemberCount}</strong><span>Members</span></div>
          <div class="analytic-tile"><strong>${item.assignmentsPosted}</strong><span>Assignments</span></div>
          <div class="analytic-tile"><strong>${item.analytics.completionPercentage}%</strong><span>Completion</span></div>
          <div class="analytic-tile"><strong>${item.analytics.overdueCount}</strong><span>Overdue</span></div>
        </div>
        <div class="meta-row">
          ${(item.assignmentBreakdown || []).slice(0, 4).map((assignment) => `<span class="meta-pill">${escapeHtml(assignment.title)} · ${assignment.completionPercent}%</span>`).join("")}
        </div>
        <div class="card-actions">
          <button class="btn-chip" type="button" data-action="open-room" data-id="${item.room.id}">Open Room</button>
        </div>
      </article>`).join("") : '<div class="empty-state">No managed rooms yet.</div>');

    $("#facultyAnnouncementList").html(overview.recentAnnouncements.length ? overview.recentAnnouncements.map((item) => `
      <article class="stack-card">
        <div class="card-topline">
          <div>
            <h3 class="card-title">${escapeHtml(item.title)}</h3>
            <p class="card-subject">${escapeHtml(item.room ? item.room.name : "Room")}</p>
          </div>
          <span class="status-chip ${announcementTone(item.category)}">${escapeHtml(item.category)}</span>
        </div>
        <div class="meta-row">
          <span class="meta-pill">${formatDateTime(item.createdAt)}</span>
        </div>
      </article>`).join("") : '<div class="empty-state">No recent announcements.</div>');

    $("#facultyActivityList").html(overview.recentActivity.length ? overview.recentActivity.map((item) => `
      <article class="stack-card">
        <div class="card-topline">
          <div>
            <h3 class="card-title">${escapeHtml(item.message)}</h3>
            <p class="card-subject">${escapeHtml(item.room ? item.room.name : "Room")}</p>
          </div>
          <span class="status-chip info">${escapeHtml(item.type)}</span>
        </div>
        <div class="meta-row">
          <span class="meta-pill">${formatDateTime(item.createdAt)}</span>
        </div>
      </article>`).join("") : '<div class="empty-state">No room activity yet.</div>');
  }

  function renderCalendars() {
    renderCalendar("#dashboardCalendarMonth", "#dashboardCalendarGrid", "#dashboardSelectedDate", "#dashboardDateTasks");
    renderCalendar("#calendarMonthLabel", "#calendarGrid", "#calendarSelectedDate", "#calendarDateTasks");
  }

  function renderCalendar(monthSel, gridSel, titleSel, listSel) {
    const map = itemsByDate();
    const first = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth(), 1);
    const last = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 0);
    const todayKey = toDateKey(new Date());
    const html = DAYS.map((day) => `<div class="calendar-day-label">${day}</div>`);
    $(monthSel).text(state.calendarMonth.toLocaleString(undefined, { month: "long", year: "numeric" }));
    for (let index = 0; index < first.getDay(); index += 1) html.push('<div class="calendar-cell is-empty"></div>');
    for (let day = 1; day <= last.getDate(); day += 1) {
      const key = toDateKey(new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth(), day));
      const items = map[key] || [];
      const classes = ["calendar-cell"];
      if (key === todayKey) classes.push("is-today");
      if (key === state.selectedDateKey) classes.push("is-selected");
      if (items.length) classes.push("has-task");
      html.push(`<div class="${classes.join(" ")}" data-date="${key}">
        <span class="day-number">${day}</span>
        ${items.slice(0, 2).map((item) => `<span class="calendar-chip priority-${item.priorityBand || "medium"}">${escapeHtml(item.title)}</span>`).join("")}
        ${items.length > 2 ? `<small>+${items.length - 2} more</small>` : ""}
      </div>`);
    }
    $(gridSel).html(html.join(""));
    const current = map[state.selectedDateKey] || [];
    $(titleSel).text(fromDateKey(state.selectedDateKey).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }));
    $(listSel).html(current.length ? current.map((item) => `<article class="calendar-task-card">
      <div class="card-topline">
        <div>
          <h3 class="card-title">${escapeHtml(item.title)}</h3>
          <p class="card-subject">${escapeHtml(item.kind)} · ${escapeHtml(item.subject || item.roomName || "Room")}</p>
        </div>
        <span class="status-chip ${item.priorityBand || "medium"}">${escapeHtml(item.status || "todo")}</span>
      </div>
      <div class="meta-row">
        <span class="meta-pill">${escapeHtml(item.source || item.kind)}</span>
        ${item.roomName ? `<span class="meta-pill">${escapeHtml(item.roomName)}</span>` : ""}
      </div>
    </article>`).join("") : '<div class="empty-state">No tasks due on this date.</div>');
  }

  async function onAssignmentSubmit(event) {
    event.preventDefault();
    const form = serializeForm(event.currentTarget);
    const id = form.assignmentId;
    delete form.assignmentId;
    try {
      if (id) {
        await window.DeadlineDBAPI.updateAssignment(id, form);
        showToast("Assignment updated.");
      } else {
        await window.DeadlineDBAPI.createAssignment(form);
        showToast("Assignment created.");
      }
      resetAssignmentForm();
      await refresh();
    } catch (error) {
      showToast(error.message, "danger");
    }
  }

  async function onNoteSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const subject = form.subject.value.trim();
    const course = form.course.value.trim();
    const content = normalizeText($("#noteEditor").text());
    const shareWithRoom = $("#shareNoteCheckbox").is(":checked");
    const shareRoomId = $("#noteShareRoom").val();
    if (!subject || !content) {
      showToast("Subject and note content are required.", "danger");
      return;
    }
    if (shareWithRoom && !shareRoomId) {
      showToast("Choose a room before sharing this note.", "danger");
      return;
    }
    try {
      const response = await window.DeadlineDBAPI.createNote({ subject, course, content });
      let message = response.reminder ? "Note saved and reminder added." : "Note saved.";
      if (shareWithRoom && response.note && response.note._id) {
        await window.DeadlineDBAPI.shareNoteToRoom(shareRoomId, response.note._id);
        message = response.reminder ? "Note saved, reminder added, and shared to room." : "Note saved and shared to room.";
      }
      form.reset();
      $("#noteEditor").empty();
      $("#shareNoteCheckbox").prop("checked", false);
      $("#noteShareRoom").val("").prop("disabled", true);
      updateNotePreview();
      showToast(message);
      await refresh();
    } catch (error) {
      showToast(error.message, "danger");
    }
  }

  async function onReminderSubmit(event) {
    event.preventDefault();
    try {
      await window.DeadlineDBAPI.createReminder(serializeForm(event.currentTarget));
      event.currentTarget.reset();
      showToast("Reminder created.");
      await refresh();
    } catch (error) {
      showToast(error.message, "danger");
    }
  }

  async function onIntegrationSubmit(event) {
    event.preventDefault();
    const form = serializeForm(event.currentTarget);
    const settings = integrationSettingsFromForm(form);
    const existingConnection = findConnectionByProvider(form.type);
    try {
      if (isGoogleProvider(form.type)) {
        if (existingConnection) {
          await window.DeadlineDBAPI.updateIntegration(existingConnection._id, {
            label: form.label,
            selectors: form.selectors,
            settings
          });

          if (existingConnection.status === "connected") {
            event.currentTarget.reset();
            syncPreset();
            showToast(`${providerLabel(form.type)} filters saved. Click Sync to import only matching items.`);
            await refresh();
            return;
          }
        }

        const response = await window.DeadlineDBAPI.startIntegrationOAuth(form.type, existingConnection ? {
          connectionId: existingConnection._id
        } : {
          label: form.label,
          selectors: form.selectors,
          settings
        });
        showToast(`Saved ${providerLabel(form.type)} filters and opening secure OAuth...`);
        window.location.href = response.authUrl;
        return;
      }

      if (form.type === "telegram" && existingConnection) {
        await window.DeadlineDBAPI.updateIntegration(existingConnection._id, {
          label: form.label,
          selectors: form.selectors,
          settings
        });
        event.currentTarget.reset();
        syncPreset();
        showToast("Telegram settings saved. The app will discover visible chats automatically when possible.");
        await refresh();
        return;
      }

      const created = await window.DeadlineDBAPI.createIntegration({
        type: form.type,
        label: form.label,
        selectors: form.selectors,
        syncMode: form.type === "telegram" && !settings.pollingEnabled ? "webhook" : "api",
        providerAccountId: settings.chatIds && settings.chatIds[0] ? settings.chatIds[0] : "",
        settings
      });
      event.currentTarget.reset();
      syncPreset();
      showToast(created.connection.status === "setup-required"
        ? form.type === "telegram"
          ? "Telegram source saved. Add a bot token and approved chat IDs before syncing."
          : `${providerLabel(form.type)} source saved. Complete OAuth setup to start syncing.`
        : created.connection.health === "limited"
          ? form.type === "telegram"
            ? "Telegram source connected. If group messages do not appear, check bot privacy mode in BotFather."
            : `${providerLabel(form.type)} source connected with limited access.`
          : `${providerLabel(form.type)} source connected.`);
      await refresh();
    } catch (error) {
      showToast(error.message, "danger");
    }
  }

  async function onCreateRoomSubmit(event) {
    event.preventDefault();
    try {
      const response = await window.DeadlineDBAPI.createRoom(serializeForm(event.currentTarget));
      event.currentTarget.reset();
      state.currentRoomId = response.room && response.room.room ? response.room.room.id : null;
      showToast("Room created.");
      await refresh();
      if (state.currentRoomId) switchView("roomDetail");
    } catch (error) {
      showToast(error.message, "danger");
    }
  }

  async function onJoinRoomSubmit(event) {
    event.preventDefault();
    const shareCode = String(event.currentTarget.shareCode.value || "").trim();
    if (!shareCode) {
      showToast("Enter a room code to join.", "danger");
      return;
    }
    try {
      const response = await window.DeadlineDBAPI.joinRoom(shareCode);
      event.currentTarget.reset();
      state.currentRoomId = response.room && response.room.room ? response.room.room.id : null;
      showToast(response.message || "Joined room successfully.");
      await refresh();
      if (state.currentRoomId) switchView("roomDetail");
    } catch (error) {
      showToast(error.message, "danger");
    }
  }

  async function onRoomAssignmentSubmit(event) {
    event.preventDefault();
    if (!state.currentRoomId) {
      showToast("Open a room before posting assignments.", "danger");
      return;
    }
    try {
      await window.DeadlineDBAPI.createRoomAssignment(state.currentRoomId, serializeForm(event.currentTarget));
      event.currentTarget.reset();
      showToast("Shared assignment posted.");
      await refresh();
    } catch (error) {
      showToast(error.message, "danger");
    }
  }

  async function onRoomAnnouncementSubmit(event) {
    event.preventDefault();
    if (!state.currentRoomId) {
      showToast("Open a room before posting announcements.", "danger");
      return;
    }
    try {
      const payload = serializeForm(event.currentTarget);
      payload.pinned = $("#roomAnnouncementPinned").is(":checked");
      await window.DeadlineDBAPI.createRoomAnnouncement(state.currentRoomId, payload);
      event.currentTarget.reset();
      $("#roomAnnouncementPinned").prop("checked", false);
      showToast("Announcement posted.");
      await refresh();
    } catch (error) {
      showToast(error.message, "danger");
    }
  }

  function onEditAssignment() {
    const item = state.assignmentMap.get($(this).data("id"));
    if (!item) return;
    const form = $("#assignmentForm")[0];
    form.assignmentId.value = item._id;
    form.title.value = item.title;
    form.subject.value = item.subject;
    form.course.value = item.course || "";
    form.dueDate.value = toDateKey(item.dueDate);
    form.source.value = item.source || "Manual";
    form.difficulty.value = String(item.difficulty || 3);
    form.weight.value = String(item.weight || 3);
    form.status.value = item.status || "todo";
    form.description.value = item.description || "";
    switchView("assignments");
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function onDeleteAssignment() {
    try {
      await window.DeadlineDBAPI.deleteAssignment($(this).data("id"));
      showToast("Assignment deleted.");
      await refresh();
    } catch (error) {
      showToast(error.message, "danger");
    }
  }

  async function onCycleStatus() {
    try {
      await window.DeadlineDBAPI.updateAssignment($(this).data("id"), { status: $(this).data("status") });
      showToast("Assignment status updated.");
      await refresh();
    } catch (error) {
      showToast(error.message, "danger");
    }
  }

  async function onReminderStatus() {
    try {
      await window.DeadlineDBAPI.updateReminder($(this).data("id"), { status: $(this).data("status") });
      showToast("Reminder updated.");
      await refresh();
    } catch (error) {
      showToast(error.message, "danger");
    }
  }

  async function onDeleteReminder() {
    try {
      await window.DeadlineDBAPI.deleteReminder($(this).data("id"));
      showToast("Reminder deleted.");
      await refresh();
    } catch (error) {
      showToast(error.message, "danger");
    }
  }

  async function onSyncConnection() {
    const button = $(this);
    setButtonBusy(button, true, "Syncing...");
    try {
      const connectionId = button.data("id");
      const connection = state.connections.find((conn) => conn._id === connectionId);

      if (connection && connection.status === "disconnected") {
        showToast("This integration is disconnected. Reconnect before syncing.", "danger");
        return;
      }

      const result = await window.DeadlineDBAPI.syncIntegration(connectionId, {});
      showToast(describeSyncResult(result));
      await refresh();
    } catch (error) {
      await refresh().catch(() => {});
      showToast(error.message, "danger");
    } finally {
      setButtonBusy(button, false);
    }
  }

  async function onConnectOAuth() {
    try {
      const provider = $(this).data("provider");
      const response = await window.DeadlineDBAPI.startIntegrationOAuth(provider, {
        connectionId: $(this).data("id")
      });
      window.location.href = response.authUrl;
    } catch (error) {
      showToast(error.message, "danger");
    }
  }

  async function onDiscoverTelegramChats() {
    const button = $(this);
    setButtonBusy(button, true, "Checking...");
    try {
      const response = await window.DeadlineDBAPI.discoverTelegramChats(button.data("id"));
      showToast(response.message || "Telegram chat discovery completed.");
      await refresh();
    } catch (error) {
      await refresh().catch(() => {});
      showToast(error.message, "danger");
    } finally {
      setButtonBusy(button, false);
    }
  }

  async function onTestTelegramIntegration() {
    const button = $(this);
    setButtonBusy(button, true, "Testing...");
    try {
      const response = await window.DeadlineDBAPI.testTelegramIntegration(button.data("id"));
      showToast(response.message || "Telegram connectivity test completed.");
      await refresh();
    } catch (error) {
      await refresh().catch(() => {});
      showToast(error.message, "danger");
    } finally {
      setButtonBusy(button, false);
    }
  }

  async function onDisconnectConnection() {
    if (!window.confirm("Disconnect this provider? Tokens will be cleared and future syncs will stop.")) {
      return;
    }

    try {
      await window.DeadlineDBAPI.disconnectIntegration($(this).data("id"));
      showToast("Integration disconnected.");
      await refresh();
    } catch (error) {
      showToast(error.message, "danger");
    }
  }

  async function onSyncAll() {
    if (!state.connections.length) {
      showToast("No sources connected yet.", "danger");
      return;
    }
    const button = $("#syncAllBtn").prop("disabled", true).addClass("opacity-75");
    try {
      let total = 0;
      let skipped = 0;
      for (const conn of state.connections) {
        if (conn.status === "disconnected") {
          continue;
        }
        const result = await window.DeadlineDBAPI.syncIntegration(conn._id, {});
        total += result.importedCount || 0;
        skipped += result.skippedDuplicates || 0;
      }
      showToast(`All sources synced. Imported ${total}, skipped ${skipped}.`);
      await refresh();
    } catch (error) {
      showToast(error.message, "danger");
    } finally {
      button.prop("disabled", false).removeClass("opacity-75");
    }
  }

  async function onExportCalendar() {
    setAppLoading(true, "Preparing calendar export...");
    try {
      const exportPayload = await window.DeadlineDBAPI.exportCalendar();
      const blob = new Blob([JSON.stringify(exportPayload.events || [], null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "deadlinedb-calendar-export.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast(`Exported ${exportPayload.eventCount || 0} calendar events.`);
    } catch (error) {
      showToast(error.message, "danger");
    } finally {
      setAppLoading(false);
    }
  }

  async function onOpenRoom() {
    state.currentRoomId = $(this).data("id");
    switchView("roomDetail");
    await refresh();
  }

  async function onLeaveRoom() {
    const roomId = $(this).data("id");
    if (!window.confirm("Leave this room? Your personal progress for shared assignments will be removed.")) {
      return;
    }
    try {
      await window.DeadlineDBAPI.leaveRoom(roomId);
      if (state.currentRoomId === roomId) {
        state.currentRoomId = null;
        state.currentRoom = null;
        switchView("rooms");
      }
      showToast("Left room.");
      await refresh();
    } catch (error) {
      showToast(error.message, "danger");
    }
  }

  async function onRoomProgress() {
    const roomId = $(this).data("room-id");
    const assignmentId = $(this).data("assignment-id");
    const status = $(this).data("status");
    try {
      await window.DeadlineDBAPI.updateRoomAssignmentProgress(roomId, assignmentId, status);
      showToast("Shared assignment progress updated.");
      await refresh();
    } catch (error) {
      showToast(error.message, "danger");
    }
  }

  async function onPinRoomNote() {
    const roomId = $(this).data("room-id");
    const noteId = $(this).data("note-id");
    const pinned = String($(this).data("pinned")) === "true";
    try {
      await window.DeadlineDBAPI.pinRoomNote(roomId, noteId, pinned);
      showToast(pinned ? "Shared note pinned." : "Shared note unpinned.");
      await refresh();
    } catch (error) {
      showToast(error.message, "danger");
    }
  }

  async function onCopyRoomCode() {
    const code = String($(this).data("code") || "");
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(code);
        showToast("Room code copied.");
      } else {
        showToast(`Room code: ${code}`);
      }
    } catch (error) {
      showToast(`Room code: ${code}`);
    }
  }

  function onViewClick() {
    if (!$("#dashboardView").is(":visible")) return;
    const view = $(this).data("view");
    if (view) switchView(view);
  }

  function onCalendarDateClick() {
    state.selectedDateKey = $(this).data("date");
    renderCalendars();
  }

  function onEditorButton() {
    const command = $(this).data("command");
    const value = $(this).data("value");
    $("#noteEditor").trigger("focus");
    if (document.execCommand) document.execCommand(command, false, value || null);
    updateNotePreview();
  }

  function onShareNoteToggle() {
    $("#noteShareRoom").prop("disabled", !$("#shareNoteCheckbox").is(":checked"));
  }

  function updateNotePreview() {
    const text = normalizeText($("#noteEditor").text());
    const matches = detectKeywords(text);
    const preview = $("#noteDetectionPreview");
    const save = $("#saveNoteBtn");
    if (!text) {
      preview.removeClass("active").addClass("muted").html('<strong>No reminder keywords detected yet.</strong><p class="mb-0">Use words like submit, deadline, due, or important to trigger reminder awareness.</p>');
      save.text("Save Note");
      return;
    }
    if (!matches.length) {
      preview.removeClass("active").addClass("muted").html('<strong>Note ready to save.</strong><p class="mb-0">No reminder keywords found in this draft.</p>');
      save.text("Save Note");
      return;
    }
    preview.removeClass("muted").addClass("active").html(`<strong>Reminder detected -> add to dashboard?</strong><p class="mb-2">Saving this note will trigger reminder creation because it includes: ${matches.map((word) => `<span class="note-mark">${escapeHtml(word)}</span>`).join(", ")}.</p><p class="mb-0">${highlightKeywords(text)}</p>`);
    save.text("Save Note + Reminder");
  }

  function initSortable() {
    if (!$.fn.sortable) {
      console.warn("DeadlineDB: jQuery UI sortable is unavailable; Kanban drag-and-drop is disabled.");
      return;
    }

    $(".kanban-dropzone").each(function () {
      if ($(this).data("ui-sortable")) $(this).sortable("destroy");
    });
    $(".kanban-dropzone").sortable({
      connectWith: ".kanban-dropzone",
      placeholder: "ui-sortable-placeholder",
      items: ".assignment-card",
      tolerance: "pointer",
      start(event, ui) { ui.item.addClass("is-dragging"); },
      stop(event, ui) { ui.item.removeClass("is-dragging"); },
      receive: async function (event, ui) {
        try {
          await window.DeadlineDBAPI.updateAssignment(ui.item.data("id"), { status: $(this).data("status") });
          showToast("Assignment moved.");
          await refresh();
        } catch (error) {
          showToast(error.message, "danger");
          await refresh();
        }
      }
    }).disableSelection();
  }

  function switchView(view, close = true) {
    if (view === "roomDetail" && !state.currentRoomId) {
      view = "rooms";
    }
    if (view === "faculty" && !canSeeFacultyOverview()) {
      view = "rooms";
    }
    state.activeView = view;
    $(".content-section").addClass("d-none").removeClass("active");
    $(`#${view}Section`).removeClass("d-none").addClass("active");
    $(".sidebar-link").removeClass("active");
    $(`.sidebar-link[data-view='${view}']`).addClass("active");
    if (close && window.bootstrap) {
      const instance = window.bootstrap.Offcanvas.getInstance(document.getElementById("mobileSidebar"));
      if (instance) instance.hide();
    }
  }

  function shiftMonth(delta) {
    state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + delta, 1);
    state.selectedDateKey = toDateKey(state.calendarMonth);
    renderCalendars();
  }

  function setCounts() {
    const activeAssignments = state.assignments.filter((item) => item.status !== "completed").length;
    const reminderCount = pendingReminders().length;
    $("[data-counter='assignments']").text(activeAssignments);
    $("[data-counter='reminders']").text(reminderCount);
    $("[data-counter='rooms']").text(state.rooms.length);
    $("#notificationCount").text(reminderCount);
  }

  function updateProfile() {
    const initials = String(state.user.name || "DD").split(" ").filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("");
    const firstName = (state.user.name || "Student").split(" ")[0];
    $("#syncAllBtn, #navNotificationsBtn, #profileMenu").removeClass("d-none");
    $("#profileAvatar").text(initials || "DD");
    $("#profileName").text(state.user.name || "Student");
    $("#profileRole, #settingsRole").text(state.user.role || "student");
    $("#settingsName").text(state.user.name || "Student");
    $("#settingsEmail").text(state.user.email || "");
    $("#dashboardHeadline").text(`${firstName}, here is your workload focus`);
  }

  function updateRoleViews() {
    const showFaculty = canSeeFacultyOverview();
    $("#facultyNavBtn, #facultyNavBtnMobile").toggleClass("d-none", !showFaculty);
  }

  function updateCountdowns() {
    $(".countdown-label").each(function () {
      $(this).html(`<i class="bi bi-hourglass-split"></i>${countdownText($(this).data("due-date"))}`);
    });
  }

  function resetAssignmentForm() {
    const form = $("#assignmentForm")[0];
    if (!form) return;
    form.reset();
    form.assignmentId.value = "";
    form.source.value = "Manual";
    form.status.value = "todo";
    form.difficulty.value = "3";
    form.weight.value = "3";
  }

  function resetRoomForms() {
    $("#createRoomForm, #joinRoomForm, #roomAssignmentForm, #roomAnnouncementForm").each(function () {
      this.reset();
    });
    $("#roomAnnouncementPinned").prop("checked", false);
  }

  function syncPreset() {
    const type = $("#integrationType").val() || "telegram";
    const preset = presets[type];
    $("#integrationLabel").attr("placeholder", preset.label);
    $("#integrationSelectors").attr("placeholder", preset.selectors);
    $("#integrationHint").text(preset.hint);
    $("#integrationSample").attr("placeholder", preset.sample);
  }

  function integrationSettingsFromForm(form) {
    const extra = parseSettingsText(form.sampleText || "");
    const selectors = splitCsv(form.selectors || "");
    const explicitCourseNames = splitCsv(extra.courseNames || "");
    const explicitCourseIds = splitCsv(extra.courseIds || "");
    const explicitSenderFilters = splitCsv(extra.senderFilters || "");
    const explicitKeywordFilters = splitCsv(extra.keywordFilters || "");
    const explicitLabelFilters = splitCsv(extra.labelFilters || "");

    if (form.type === "google-classroom") {
      return {
        ...extra,
        courseNames: mergeFilterLists(explicitCourseNames, selectors),
        courseIds: explicitCourseIds
      };
    }

    if (form.type === "gmail") {
      return {
        ...extra,
        senderFilters: mergeFilterLists(explicitSenderFilters, selectors.filter((item) => item.includes("@"))),
        keywordFilters: mergeFilterLists(explicitKeywordFilters, selectors.filter((item) => !item.includes("@"))),
        labelFilters: explicitLabelFilters,
        query: extra.query || "",
        maxResults: parsePositiveInt(extra.maxResults)
      };
    }

    if (form.type === "telegram") {
      return {
        ...extra,
        courseKeywords: selectors,
        chatIds: splitCsv(extra.chatIds || extra.chatId || ""),
        botToken: extra.botToken || "",
        botUsername: extra.botUsername || "",
        webhookSecret: extra.webhookSecret || "",
        webhookUrl: extra.webhookUrl || "",
        pollingEnabled: parseFlexibleBoolean(extra.pollingEnabled, true),
        maxResults: parsePositiveInt(extra.maxResults)
      };
    }

    return {};
  }

  function parseSettingsText(text) {
    return String(text || "")
      .split(/[;\n]/)
      .map((line) => line.trim())
      .filter(Boolean)
      .reduce((settings, line) => {
        const [key, ...rest] = line.split("=");
        if (!key || !rest.length) return settings;
        settings[key.trim()] = rest.join("=").trim();
        return settings;
      }, {});
  }

  function splitCsv(value) {
    return String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function asList(value) {
    if (Array.isArray(value)) {
      return value.map((item) => String(item).trim()).filter(Boolean);
    }

    return splitCsv(value);
  }

  function mergeFilterLists(...lists) {
    const seen = new Set();

    return lists
      .flat()
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .filter((item) => {
        const key = item.toLowerCase();

        if (seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      });
  }

  function parsePositiveInt(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  }

  function parseFlexibleBoolean(value, fallback = undefined) {
    if (value === undefined || value === null || value === "") {
      return fallback;
    }

    if (typeof value === "boolean") {
      return value;
    }

    const normalized = String(value).trim().toLowerCase();

    if (["true", "1", "yes", "y", "on"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "n", "off"].includes(normalized)) {
      return false;
    }

    return fallback;
  }

  function isGoogleProvider(provider) {
    return provider === "google-classroom" || provider === "gmail";
  }

  function providerLabel(provider) {
    return {
      "google-classroom": "Google Classroom",
      gmail: "Gmail",
      telegram: "Telegram"
    }[provider] || provider;
  }

  function providerShortLabel(provider) {
    return {
      "google-classroom": "Classroom",
      gmail: "Gmail",
      telegram: "Telegram"
    }[provider] || "Source";
  }

  function providerGuidance(provider) {
    return provider === "telegram"
      ? "Bot API webhook or polling flow"
      : "OAuth connection required";
  }

  function findConnectionByProvider(provider) {
    return state.connections.find((connection) => (connection.provider || connection.type) === provider && connection.status !== "disconnected") || null;
  }

  function lastSyncImportCount(connection) {
    return connection && connection.lastSyncResult ? connection.lastSyncResult.importedCount || 0 : 0;
  }

  function connectionSummaryDetails(connection) {
    const metadata = connection && connection.settings ? connection.settings.providerMetadata || {} : {};
    const settings = connection && connection.settings ? connection.settings : {};
    const provider = connection ? (connection.provider || connection.type) : "";
    const pills = [];
    const notes = [];

    if (provider === "google-classroom" && (metadata.totalCoursesFetched || metadata.matchedCourseCount || metadata.courseworkFetchedCount)) {
      pills.push(`<span class="meta-pill">Courses ${metadata.matchedCourseCount || 0}/${metadata.totalCoursesFetched || 0}</span>`);
      pills.push(`<span class="meta-pill">Coursework ${metadata.courseworkFetchedCount || 0}</span>`);
      pills.push(`<span class="meta-pill">Assignments ${metadata.assignmentsPrepared || 0}</span>`);
      pills.push(`<span class="meta-pill">Instruction posts ${metadata.announcementInstructionsPrepared || 0}</span>`);
    }

    if (provider === "gmail" && (metadata.fetchedMessageCount || metadata.matchedBySenderCount || metadata.matchedByKeywordCount)) {
      pills.push(`<span class="meta-pill">Messages ${metadata.fetchedMessageCount || 0}</span>`);
      pills.push(`<span class="meta-pill">Sender matches ${metadata.matchedBySenderCount || 0}</span>`);
      pills.push(`<span class="meta-pill">Keyword matches ${metadata.matchedByKeywordCount || 0}</span>`);
      pills.push(`<span class="meta-pill">Skipped unrelated ${metadata.unrelatedSkippedCount || 0}</span>`);
    }

    if (provider === "telegram") {
      const configuredChatIds = asList(settings.chatIds);
      const discoveredChats = Array.isArray(settings.discoveredChats) ? settings.discoveredChats : [];
      const diagnostics = metadata.telegramDiagnostics || {};

      if (configuredChatIds.length) {
        pills.push(`<span class="meta-pill">Approved chats ${configuredChatIds.length}</span>`);
      }

      if (discoveredChats.length) {
        pills.push(`<span class="meta-pill">Visible chats ${discoveredChats.length}</span>`);
        notes.push(`<div class="meta-row mt-2">${discoveredChats.slice(0, 4).map((chat) => (
          `<span class="meta-pill">${escapeHtml(chat.title || chat.chatId)} · ${escapeHtml(chat.chatId)}</span>`
        )).join("")}${discoveredChats.length > 4 ? `<span class="meta-pill">+${discoveredChats.length - 4} more</span>` : ""}</div>`);
      }

      if (settings.lastChatDiscoveryMessage) {
        notes.push(`<div class="form-text mt-2">${escapeHtml(settings.lastChatDiscoveryMessage)}</div>`);
      }

      if (diagnostics.endpoint) {
        const tlsStage = diagnostics.tls && diagnostics.tls.attempted
          ? diagnostics.tls.ok
            ? "TLS ok"
            : "TLS failed"
          : "Direct TLS not probed";
        const dnsStage = diagnostics.dns && diagnostics.dns.ok ? "DNS ok" : "DNS failed";
        notes.push(`<div class="form-text mt-2">Connectivity: ${escapeHtml(dnsStage)} · ${escapeHtml(tlsStage)} · ${escapeHtml(diagnostics.endpoint)}</div>`);
      }
    }

    if (!pills.length && !notes.length) {
      return "";
    }

    const warning = metadata.announcementScopeWarning
      ? `<div class="form-text text-danger mt-2">${escapeHtml(metadata.announcementScopeWarning)}</div>`
      : "";

    return `${pills.length ? `<div class="meta-row mt-2">${pills.join("")}</div>` : ""}${notes.join("")}${warning}`;
  }

  function describeSyncResult(result) {
    const metadata = result.providerMetadata || {};

    if (metadata.totalCoursesFetched !== undefined) {
      const reconnectNotice = metadata.announcementScopeWarning ? ` ${metadata.announcementScopeWarning}` : "";
      return `Classroom sync complete. Courses matched ${metadata.matchedCourseCount || 0}/${metadata.totalCoursesFetched || 0}, coursework scanned ${metadata.courseworkFetchedCount || 0}, announcements scanned ${metadata.announcementsFetchedCount || 0}, assignments ${result.assignmentImports || 0}, instruction announcements ${result.announcementImports || 0}, skipped duplicates ${result.skippedDuplicates || 0}, updated ${result.updatedCount || 0}.${reconnectNotice}`;
    }

    if (metadata.fetchedMessageCount !== undefined) {
      return `Gmail sync complete. Messages fetched ${metadata.fetchedMessageCount || 0}, sender matches ${metadata.matchedBySenderCount || 0}, keyword matches ${metadata.matchedByKeywordCount || 0}, assignments ${result.assignmentImports || 0}, reminders ${result.reminderImports || 0}, announcements ${result.announcementImports || 0}, unrelated skipped ${metadata.unrelatedSkippedCount || 0}.`;
    }

    if (metadata.fetchedUpdates !== undefined) {
      return `Telegram sync complete. Updates fetched ${metadata.fetchedUpdates || 0}, approved chat matches ${metadata.matchedApprovedChats || 0}, ignored unapproved ${metadata.ignoredUnapprovedChats || 0}, imported ${result.importedCount || 0}, skipped duplicates ${result.skippedDuplicates || 0}, updated ${result.updatedCount || 0}.`;
    }

    return `Sync complete. Imported ${result.importedCount || 0}, skipped ${result.skippedDuplicates || 0}, updated ${result.updatedCount || 0}.`;
  }

  function syncMessage(connection) {
    if (connection.lastSyncResult && connection.lastSyncResult.message) {
      return connection.lastSyncResult.message;
    }

    if ((connection.provider || connection.type) === "telegram") {
      return "Telegram imports arrive through bot-visible messages. For groups, add the bot to the group and disable privacy mode if you need full group message capture.";
    }

    return "Use Connect OAuth, then Sync to import official provider data.";
  }

  function populateShareRoomOptions() {
    const options = ['<option value="">Select room for shared note</option>'].concat(
      state.rooms.map((room) => `<option value="${room.id}">${escapeHtml(room.name)} · ${escapeHtml(room.membershipRole || "student")}</option>`)
    );
    $("#noteShareRoom").html(options.join(""));
  }

  function itemsByDate() {
    return calendarItems().reduce((acc, item) => {
      const key = toDateKey(item.dueDate);
      acc[key] = acc[key] || [];
      acc[key].push(item);
      return acc;
    }, {});
  }

  function calendarItems() {
    const personal = state.assignments.map((item) => ({
      id: item._id,
      title: item.title,
      dueDate: item.dueDate,
      subject: item.subject,
      course: item.course,
      source: item.source,
      status: item.status,
      priorityBand: item.priorityBand,
      kind: "Personal"
    }));
    const shared = sharedAssignments().map((item) => ({
      id: item.id,
      title: item.title,
      dueDate: item.dueDate,
      subject: item.subject,
      course: item.course,
      source: item.source,
      status: item.userStatus,
      priorityBand: item.priorityBand,
      kind: "Shared",
      roomName: item.room ? item.room.name : "Room"
    }));
    return personal.concat(shared).sort((left, right) => new Date(left.dueDate) - new Date(right.dueDate));
  }

  function countImported(connectionId) {
    const assignmentCount = state.assignments.filter((item) => item.sourceRef && String(item.sourceRef.connection || "") === String(connectionId)).length;
    const reminderCount = state.reminders.filter((item) => item.sourceRef && String(item.sourceRef.connection || "") === String(connectionId)).length;
    return assignmentCount + reminderCount;
  }

  function pendingReminders() {
    return state.reminders.filter((item) => item.status === "pending");
  }

  function sharedAssignments() {
    return state.overview && state.overview.sharedWorkspace && Array.isArray(state.overview.sharedWorkspace.sharedAssignments) ? state.overview.sharedWorkspace.sharedAssignments : [];
  }

  function officialAnnouncements() {
    return state.overview && state.overview.sharedWorkspace && Array.isArray(state.overview.sharedWorkspace.officialAnnouncements) ? state.overview.sharedWorkspace.officialAnnouncements : [];
  }

  function detectKeywords(text) {
    const lower = String(text || "").toLowerCase();
    return KEYWORDS.filter((word) => lower.includes(word));
  }

  function highlightKeywords(text) {
    let safe = escapeHtml(text);
    KEYWORDS.forEach((word) => {
      safe = safe.replace(new RegExp(`\\b(${escapeRegExp(word)})\\b`, "gi"), '<span class="note-mark">$1</span>');
    });
    return safe.replace(/\n/g, "<br>");
  }

  function canManageRoom(detail) {
    const membershipRole = detail.membership ? detail.membership.role : "";
    return ROOM_MANAGER_ROLES.includes(membershipRole) || ["professor", "coordinator"].includes(state.user.role);
  }

  function canSeeFacultyOverview() {
    return Boolean(state.facultyOverview && state.facultyOverview.roomCount && state.facultyOverview.roomCount > 0);
  }

  function canLeaveRoom(room) {
    const ownerId = room.owner && (room.owner._id || room.owner.id || room.owner);
    return String(ownerId || "") !== String(state.user.id || state.user._id || "");
  }

  function getRoomName(roomId) {
    const room = state.roomMap.get(String(roomId));
    return room ? room.name : "Shared room";
  }

  function roomProgressButtons(roomId, assignmentId, currentStatus) {
    return ["not-started", "in-progress", "completed"].map((status) => {
      const active = currentStatus === status ? "active" : "";
      return `<button class="btn-chip ${active}" type="button" data-action="room-progress" data-room-id="${roomId}" data-assignment-id="${assignmentId}" data-status="${status}">${escapeHtml(status)}</button>`;
    }).join("");
  }

  function announcementTone(category) {
    if (category === "urgent") return "critical";
    if (category === "exam") return "high";
    if (category === "assignment") return "medium";
    if (category === "event") return "done";
    return "info";
  }

  function serializeForm(form) {
    return $(form).serializeArray().reduce((acc, field) => {
      acc[field.name] = field.value.trim();
      return acc;
    }, {});
  }

  function normalizeText(text) {
    return String(text || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function toDateKey(value) {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function fromDateKey(value) {
    const [year, month, day] = String(value || "").split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function deadlineValue(item) {
    return item && (item.dueDateTime || item.dueDate) ? (item.dueDateTime || item.dueDate) : "";
  }

  function formatDeadline(item) {
    const value = deadlineValue(item);

    if (value) {
      return formatDateTime(value);
    }

    if (item && item.dueTime) {
      return `Time detected ${escapeHtml(item.dueTime)}`;
    }

    return "No deadline set";
  }

  function deadlineStatusPills(item) {
    if (!item) {
      return "";
    }

    const pills = [];

    if (item.needsUserReview) {
      pills.push('<span class="meta-pill"><i class="bi bi-exclamation-circle"></i>Needs review</span>');
    }

    if (Array.isArray(item.ambiguityFlags) && item.ambiguityFlags.includes("default-time-applied")) {
      pills.push('<span class="meta-pill">Default time applied</span>');
    }

    return pills.join("");
  }

  function formatDate(value) {
    return value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "No date";
  }

  function formatDateTime(value) {
    return value ? new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "No deadline set";
  }

  function countdownText(value) {
    if (!value) return "No deadline";
    const diff = new Date(value).getTime() - Date.now();
    const hours = Math.round(Math.abs(diff) / 3600000);
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    if (diff < 0) return days > 0 ? `Overdue by ${days}d` : `Overdue by ${remainingHours}h`;
    if (hours <= 24) return hours === 0 ? "Due soon" : `${hours}h left`;
    return `${days}d ${remainingHours}h left`;
  }

  function reminderSortValue(item) {
    const priorityOffset = item.status === "pending" ? 0 : 8640000000;
    return priorityOffset + new Date(deadlineValue(item) || 0).getTime();
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function showToast(message, variant = "success") {
    const toast = $(`<div class="app-toast toast-${variant}"><strong class="d-block mb-1">${variant === "danger" ? "Action failed" : "Updated"}</strong><span>${escapeHtml(message)}</span></div>`);
    $("#toastHost").prepend(toast);
    setTimeout(() => toast.fadeOut(250, () => toast.remove()), 2800);
  }

  function setButtonBusy(buttonRef, isBusy, busyLabel = "Working...") {
    const button = $(buttonRef);

    if (!button.length) {
      return;
    }

    if (isBusy) {
      button.data("original-label", button.text());
      button.prop("disabled", true).addClass("is-loading").text(busyLabel);
      return;
    }

    const originalLabel = button.data("original-label");
    button.prop("disabled", false).removeClass("is-loading");

    if (originalLabel) {
      button.text(originalLabel);
      button.removeData("original-label");
    }
  }

  function setAppLoading(isLoading, message = "Updating workspace...") {
    state.loadingDepth = Math.max(0, state.loadingDepth + (isLoading ? 1 : -1));
    $("#loadingMessage").text(message);
    $("#loadingOverlay").toggleClass("active", state.loadingDepth > 0);
  }

  window.DeadlineDBDashboard = { init, teardown, refresh, showToast };
})();

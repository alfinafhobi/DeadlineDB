(function () {
  const TOKEN_KEY = "deadlinedb_token";

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
  }

  async function request(path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {})
    };

    const token = getToken();

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`/api${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(payload.message || "Request failed.");
      error.code = payload.code || "";
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  window.DeadlineDBAPI = {
    getToken,
    setToken,
    clearToken,
    register(data) {
      return request("/auth/register", {
        method: "POST",
        body: data
      });
    },
    login(data) {
      return request("/auth/login", {
        method: "POST",
        body: data
      });
    },
    forgotPassword(data) {
      return request("/auth/forgot-password", {
        method: "POST",
        body: data
      });
    },
    resetPassword(data) {
      return request("/auth/reset-password", {
        method: "POST",
        body: data
      });
    },
    getMe() {
      return request("/auth/me");
    },
    getOverview() {
      return request("/dashboard/overview");
    },
    getNotifications(limit = 20) {
      return request(`/notifications?limit=${limit}`);
    },
    exportCalendar() {
      return request("/exports/calendar");
    },
    getAssignments() {
      return request("/assignments");
    },
    createAssignment(data) {
      return request("/assignments", {
        method: "POST",
        body: data
      });
    },
    updateAssignment(id, data) {
      return request(`/assignments/${id}`, {
        method: "PUT",
        body: data
      });
    },
    deleteAssignment(id) {
      return request(`/assignments/${id}`, {
        method: "DELETE"
      });
    },
    getNotes() {
      return request("/notes");
    },
    createNote(data) {
      return request("/notes", {
        method: "POST",
        body: data
      });
    },
    getReminders() {
      return request("/reminders");
    },
    createReminder(data) {
      return request("/reminders", {
        method: "POST",
        body: data
      });
    },
    updateReminder(id, data) {
      return request(`/reminders/${id}`, {
        method: "PUT",
        body: data
      });
    },
    deleteReminder(id) {
      return request(`/reminders/${id}`, {
        method: "DELETE"
      });
    },
    listIntegrations() {
      return request("/integrations");
    },
    createIntegration(data) {
      return request("/integrations", {
        method: "POST",
        body: data
      });
    },
    updateIntegration(id, data) {
      return request(`/integrations/${id}`, {
        method: "PUT",
        body: data
      });
    },
    disconnectIntegration(id) {
      return request(`/integrations/${id}`, {
        method: "DELETE"
      });
    },
    startIntegrationOAuth(provider, data = {}) {
      return request(`/integrations/oauth/${provider}/start`, {
        method: "POST",
        body: data
      });
    },
    syncIntegration(id, data) {
      return request(`/integrations/${id}/sync`, {
        method: "POST",
        body: data
      });
    },
    discoverTelegramChats(id) {
      return request(`/integrations/${id}/telegram/discover-chats`, {
        method: "POST"
      });
    },
    testTelegramIntegration(id) {
      return request(`/integrations/${id}/telegram/test`, {
        method: "POST"
      });
    },
    getRooms() {
      return request("/rooms");
    },
    getRoom(id) {
      return request(`/rooms/${id}`);
    },
    getRoomActivity(id) {
      return request(`/rooms/${id}/activity`);
    },
    createRoom(data) {
      return request("/rooms", {
        method: "POST",
        body: data
      });
    },
    joinRoom(shareCode) {
      return request("/rooms/join", {
        method: "POST",
        body: { shareCode }
      });
    },
    leaveRoom(id) {
      return request(`/rooms/${id}/leave`, {
        method: "POST"
      });
    },
    createRoomAssignment(roomId, data) {
      return request(`/rooms/${roomId}/assignments`, {
        method: "POST",
        body: data
      });
    },
    updateRoomAssignment(roomId, assignmentId, data) {
      return request(`/rooms/${roomId}/assignments/${assignmentId}`, {
        method: "PUT",
        body: data
      });
    },
    updateRoomAssignmentProgress(roomId, assignmentId, status) {
      return request(`/rooms/${roomId}/assignments/${assignmentId}/progress`, {
        method: "PUT",
        body: { status }
      });
    },
    createRoomAnnouncement(roomId, data) {
      return request(`/rooms/${roomId}/announcements`, {
        method: "POST",
        body: data
      });
    },
    updateRoomAnnouncement(roomId, announcementId, data) {
      return request(`/rooms/${roomId}/announcements/${announcementId}`, {
        method: "PUT",
        body: data
      });
    },
    shareNoteToRoom(roomId, noteId) {
      return request(`/rooms/${roomId}/notes/${noteId}/share`, {
        method: "POST"
      });
    },
    pinRoomNote(roomId, noteId, pinned) {
      return request(`/rooms/${roomId}/notes/${noteId}/pin`, {
        method: "PUT",
        body: { pinned }
      });
    },
    getFacultyOverview() {
      return request("/rooms/faculty/overview");
    }
  };
})();

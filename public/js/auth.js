(function () {
  function showGuest() {
    $("#guestView").removeClass("d-none");
    $("#dashboardView").addClass("d-none");
    window.DeadlineDBDashboard.teardown();
  }

  function showDashboard(user) {
    $("#guestView").addClass("d-none");
    $("#dashboardView").removeClass("d-none");
    window.DeadlineDBDashboard.init(user);
  }

  async function restoreSession() {
    if (!window.DeadlineDBAPI.getToken()) {
      showGuest();
      return;
    }

    try {
      const response = await window.DeadlineDBAPI.getMe();
      showDashboard(response.user);
      showIntegrationRedirectStatus();
    } catch (error) {
      window.DeadlineDBAPI.clearToken();
      showGuest();
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    const formData = getFormData(event.currentTarget);

    try {
      const response = await window.DeadlineDBAPI.login(formData);
      window.DeadlineDBAPI.setToken(response.token);
      event.currentTarget.reset();
      showDashboard(response.user);
      window.DeadlineDBDashboard.showToast("Logged in successfully.");
    } catch (error) {
      window.DeadlineDBDashboard.showToast(error.message, "danger");
    }
  }

  async function handleRegister(event) {
    event.preventDefault();
    const formData = getFormData(event.currentTarget);

    try {
      const response = await window.DeadlineDBAPI.register(formData);
      window.DeadlineDBAPI.setToken(response.token);
      event.currentTarget.reset();
      showDashboard(response.user);
      window.DeadlineDBDashboard.showToast("Account created successfully.");
    } catch (error) {
      window.DeadlineDBDashboard.showToast(error.message, "danger");
    }
  }

  async function handleForgotPassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = getFormData(form);

    try {
      const response = await window.DeadlineDBAPI.forgotPassword(formData);
      $("#resetEmail").val(formData.email);

      if (response.debug && response.debug.resetToken) {
        $("#resetToken").val(response.debug.resetToken);
        $("#resetDebugToken")
          .removeClass("d-none")
          .html(`<strong>Demo reset token:</strong><code>${response.debug.resetToken}</code>`);
      } else {
        $("#resetDebugToken").addClass("d-none").empty();
      }

      form.reset();
      window.DeadlineDBDashboard.showToast(response.message || "Reset link prepared.");
    } catch (error) {
      window.DeadlineDBDashboard.showToast(error.message, "danger");
    }
  }

  async function handleResetPassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = getFormData(form);

    try {
      const response = await window.DeadlineDBAPI.resetPassword(formData);
      form.reset();
      $("#resetDebugToken").addClass("d-none").empty();
      const modal = window.bootstrap.Modal.getInstance(document.getElementById("resetPasswordModal"));
      if (modal) modal.hide();
      window.DeadlineDBDashboard.showToast(response.message || "Password reset successfully.");
    } catch (error) {
      window.DeadlineDBDashboard.showToast(error.message, "danger");
    }
  }

  function hydrateResetFromUrl() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("reset")) {
      return;
    }

    const resetParams = new URLSearchParams(params.get("reset"));
    const email = resetParams.get("email") || "";
    const token = resetParams.get("token") || "";

    if (email) $("#resetEmail").val(email);
    if (token) $("#resetToken").val(token);

    const modal = new window.bootstrap.Modal(document.getElementById("resetPasswordModal"));
    modal.show();
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  function showIntegrationRedirectStatus() {
    const params = new URLSearchParams(window.location.search);
    const connectedProvider = params.get("integrationConnected");
    const integrationError = params.get("integrationError");

    if (connectedProvider) {
      window.DeadlineDBDashboard.showToast(`${connectedProvider} connected. You can sync it now.`);
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (integrationError) {
      window.DeadlineDBDashboard.showToast(integrationError, "danger");
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }

  function handleLogout() {
    window.DeadlineDBAPI.clearToken();
    showGuest();
  }

  function getFormData(form) {
    return $(form)
      .serializeArray()
      .reduce((acc, field) => {
        acc[field.name] = field.value.trim();
        return acc;
      }, {});
  }

  $(function () {
    $("#loginForm").on("submit", handleLogin);
    $("#registerForm").on("submit", handleRegister);
    $("#forgotPasswordForm").on("submit", handleForgotPassword);
    $("#resetPasswordForm").on("submit", handleResetPassword);
    $("#logoutBtn").on("click", handleLogout);
    hydrateResetFromUrl();
    restoreSession();
  });
})();

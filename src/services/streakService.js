function toDateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function diffDays(a, b) {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86400000);
}

function calculateBestStreak(sortedKeys) {
  if (!sortedKeys.length) {
    return 0;
  }

  let best = 1;
  let current = 1;

  for (let index = 1; index < sortedKeys.length; index += 1) {
    const currentDate = startOfDay(sortedKeys[index]);
    const previousDate = startOfDay(sortedKeys[index - 1]);
    const difference = diffDays(currentDate, previousDate);

    if (difference === 1) {
      current += 1;
      best = Math.max(best, current);
    } else if (difference > 1) {
      current = 1;
    }
  }

  return best;
}

function calculateCurrentStreak(sortedKeys, referenceDate = new Date()) {
  if (!sortedKeys.length) {
    return 0;
  }

  // Treat yesterday as still "alive" so students do not lose a streak before finishing today's work.
  const today = startOfDay(referenceDate);
  let pointer = startOfDay(sortedKeys[sortedKeys.length - 1]);
  const gapFromToday = diffDays(today, pointer);

  if (gapFromToday > 1) {
    return 0;
  }

  let streak = 1;

  for (let index = sortedKeys.length - 2; index >= 0; index -= 1) {
    const candidate = startOfDay(sortedKeys[index]);
    const difference = diffDays(pointer, candidate);

    if (difference === 1) {
      streak += 1;
      pointer = candidate;
      continue;
    }

    if (difference > 1) {
      break;
    }
  }

  return streak;
}

function buildWeeklyProgress(completedAssignments, referenceDate = new Date()) {
  const today = startOfDay(referenceDate);
  const labels = [];
  const counts = [];

  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const key = toDateKey(date);
    labels.push(date.toLocaleDateString(undefined, { weekday: "short" }));
    counts.push(completedAssignments.filter((assignment) => toDateKey(assignment.completedAt || assignment.updatedAt) === key).length);
  }

  const completedLast7Days = counts.reduce((sum, count) => sum + count, 0);
  const weeklyTarget = 7;

  return {
    labels,
    counts,
    completedLast7Days,
    weeklyTarget,
    progressPercent: Math.min(100, Math.round((completedLast7Days / weeklyTarget) * 100))
  };
}

function buildBadges(summary) {
  const badges = [];

  if (summary.totalCompletedAssignments >= 1) {
    badges.push({
      key: "first-completion",
      label: "First Completion",
      description: "Completed your first assignment in DeadlineDB."
    });
  }

  if (summary.currentStreak >= 3) {
    badges.push({
      key: "three-day-streak",
      label: "3-Day Streak",
      description: "Completed work on three consecutive days."
    });
  }

  if (summary.currentStreak >= 7) {
    badges.push({
      key: "seven-day-streak",
      label: "7-Day Streak",
      description: "Maintained a full week of assignment momentum."
    });
  }

  if (summary.totalCompletedAssignments >= 25) {
    badges.push({
      key: "assignment-crusher",
      label: "Assignment Crusher",
      description: "Completed 25 assignments."
    });
  }

  return badges;
}

function calculateStreakSummary(assignments = [], referenceDate = new Date()) {
  const completedAssignments = assignments.filter(
    (assignment) => assignment.status === "completed" || assignment.completedAt
  );
  const completionKeys = [
    ...new Set(
      completedAssignments
        .map((assignment) => assignment.completedAt || assignment.updatedAt)
        .filter(Boolean)
        .map((value) => toDateKey(value))
    )
  ].sort();

  const totalCompletedAssignments = completedAssignments.length;
  const totalAssignments = assignments.length;
  const completionRate = totalAssignments
    ? Math.round((totalCompletedAssignments / totalAssignments) * 100)
    : 0;
  const completedToday = completedAssignments.filter(
    (assignment) => toDateKey(assignment.completedAt || assignment.updatedAt) === toDateKey(referenceDate)
  ).length;

  const summary = {
    daysWithCompletedTasks: completionKeys.length,
    currentStreak: calculateCurrentStreak(completionKeys, referenceDate),
    bestStreak: calculateBestStreak(completionKeys),
    totalCompletedAssignments,
    completionRate,
    completedToday,
    weeklyProgress: buildWeeklyProgress(completedAssignments, referenceDate)
  };

  summary.badges = buildBadges(summary);
  summary.dailyMomentumMessage =
    completedToday >= 3
      ? "3 tasks completed today."
      : completedToday > 0
        ? `${completedToday} task${completedToday === 1 ? "" : "s"} completed today.`
        : "No tasks completed yet today.";

  return summary;
}

module.exports = {
  calculateStreakSummary,
  toDateKey,
  startOfDay
};

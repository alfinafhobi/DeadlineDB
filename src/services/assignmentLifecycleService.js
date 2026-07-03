function applyAssignmentLifecycle(values = {}, existingAssignment = null) {
  const nextValues = { ...values };
  const previousStatus = existingAssignment ? existingAssignment.status : null;
  const nextStatus = nextValues.status || previousStatus || "todo";

  if (nextStatus === "completed") {
    nextValues.completedAt =
      existingAssignment && existingAssignment.completedAt
        ? existingAssignment.completedAt
        : new Date();
  } else {
    nextValues.completedAt = null;
  }

  return nextValues;
}

module.exports = {
  applyAssignmentLifecycle
};

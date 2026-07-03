function calculateUrgency(dueDate) {
  const now = new Date();
  const due = new Date(dueDate);
  const diffMs = due.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 1) {
    return 5;
  }

  if (diffDays <= 3) {
    return 4;
  }

  if (diffDays <= 7) {
    return 3;
  }

  if (diffDays <= 14) {
    return 2;
  }

  return 1;
}

function priorityBand(score) {
  if (score >= 75) {
    return "critical";
  }

  if (score >= 40) {
    return "high";
  }

  if (score >= 20) {
    return "medium";
  }

  return "low";
}

function calculatePriorityMetrics({
  dueDate,
  difficulty = 3,
  weight = 3
}) {
  const urgency = calculateUrgency(dueDate);
  const priorityScore = urgency * Number(difficulty) * Number(weight);

  return {
    urgency,
    priorityScore,
    priorityBand: priorityBand(priorityScore)
  };
}

module.exports = {
  calculatePriorityMetrics,
  calculateUrgency,
  priorityBand
};

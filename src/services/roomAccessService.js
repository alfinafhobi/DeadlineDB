function getRoomMembership(room, userId) {
  return (room.members || []).find(
    (member) => String(member.user && (member.user._id || member.user)) === String(userId)
  );
}

function isRoomMember(room, userId) {
  return Boolean(getRoomMembership(room, userId));
}

function isRoomManager(room, userId, globalRole = "student") {
  const membership = getRoomMembership(room, userId);

  if (!membership) {
    return false;
  }

  return ["room-admin", "professor", "coordinator"].includes(membership.role) ||
    ["professor", "coordinator"].includes(globalRole);
}

function resolveCreatorRole(userRole = "student") {
  if (userRole === "professor" || userRole === "coordinator") {
    return userRole;
  }

  return "room-admin";
}

function sanitizeRoom(room, userId) {
  const membership = getRoomMembership(room, userId);

  return {
    id: room._id,
    name: room.name,
    shareCode: room.shareCode,
    description: room.description,
    owner: room.owner,
    archived: room.archived,
    createdAt: room.createdAt,
    memberCount: (room.members || []).length,
    membershipRole: membership ? membership.role : null
  };
}

module.exports = {
  getRoomMembership,
  isRoomMember,
  isRoomManager,
  resolveCreatorRole,
  sanitizeRoom
};

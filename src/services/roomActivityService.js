const RoomActivityLog = require("../models/RoomActivityLog");

async function logRoomActivity({ room, actor, type, message, metadata = {} }) {
  return RoomActivityLog.create({
    room,
    actor,
    type,
    message,
    metadata
  });
}

module.exports = {
  logRoomActivity
};

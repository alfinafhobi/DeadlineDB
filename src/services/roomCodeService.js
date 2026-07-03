const Room = require("../models/Room");

function createCandidateCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let index = 0; index < 6; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return code;
}

async function generateRoomCode() {
  let attempts = 0;

  while (attempts < 20) {
    const candidate = createCandidateCode();
    const existing = await Room.findOne({ shareCode: candidate }).select("_id");

    if (!existing) {
      return candidate;
    }

    attempts += 1;
  }

  throw new Error("Unable to generate a unique room code.");
}

module.exports = {
  generateRoomCode
};

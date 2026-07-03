const jwt = require("jsonwebtoken");
const User = require("../models/User");
const appConfig = require("../config/appConfig");

module.exports = async function auth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authorization token is required."
      });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, appConfig.jwtSecret);
    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User session is no longer valid."
      });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: "Invalid or expired token."
    });
  }
};

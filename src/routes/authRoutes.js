const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const appConfig = require("../config/appConfig");
const User = require("../models/User");
const auth = require("../middleware/auth");
const validate = require("../middleware/validate");
const { authForgotPasswordSchema, authLoginSchema, authRegisterSchema, authResetPasswordSchema } = require("../validation/schemas");
const { sendPasswordResetEmail } = require("../services/passwordResetService");
const logger = require("../utils/logger");

const router = express.Router();
const RESET_TOKEN_EXPIRY_MINUTES = 60;

function createToken(id) {
  return jwt.sign({ id }, appConfig.jwtSecret, {
    expiresIn: appConfig.jwtExpiresIn
  });
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function buildResetUrl(req, email, token) {
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const params = new URLSearchParams({ email, token });
  return `${baseUrl}/?reset=${params.toString()}`;
}

router.post("/register", validate(authRegisterSchema), async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and password are required."
      });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists."
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role
    });

    res.status(201).json({
      success: true,
      message: "Account created successfully.",
      token: createToken(user._id),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/login", validate(authLoginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required."
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password."
      });
    }

    const matches = await bcrypt.compare(password, user.password);

    if (!matches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password."
      });
    }

    res.json({
      success: true,
      token: createToken(user._id),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/forgot-password", validate(authForgotPasswordSchema), async (req, res, next) => {
  try {
    const email = req.body.email.toLowerCase();
    const user = await User.findOne({ email });

    const baseResponse = {
      success: true,
      message: "If an account exists for that email, a password reset link has been prepared."
    };

    if (!user) {
      return res.json(baseResponse);
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenHash = hashResetToken(resetToken);
    const resetPasswordExpiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000);
    const resetUrl = buildResetUrl(req, user.email, resetToken);

    user.resetPasswordTokenHash = resetTokenHash;
    user.resetPasswordExpiresAt = resetPasswordExpiresAt;
    user.resetPasswordRequestedAt = new Date();
    await user.save();

    const delivery = await sendPasswordResetEmail({
      user,
      resetUrl,
      expiresInMinutes: RESET_TOKEN_EXPIRY_MINUTES
    });

    res.json({
      ...baseResponse,
      delivery,
      debug: appConfig.isProduction
        ? undefined
        : {
            resetToken,
            resetUrl,
            expiresAt: resetPasswordExpiresAt
          }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/reset-password", validate(authResetPasswordSchema), async (req, res, next) => {
  try {
    const email = req.body.email.toLowerCase();
    const tokenHash = hashResetToken(req.body.token);
    const user = await User.findOne({
      email,
      resetPasswordTokenHash: tokenHash,
      resetPasswordExpiresAt: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Reset token is invalid or expired."
      });
    }

    user.password = await bcrypt.hash(req.body.password, 10);
    user.resetPasswordTokenHash = "";
    user.resetPasswordExpiresAt = null;
    user.resetPasswordRequestedAt = null;
    await user.save();

    logger.info("auth.password-reset.completed", {
      userId: user._id,
      email: user.email
    });

    res.json({
      success: true,
      message: "Password reset successfully. You can log in with your new password."
    });
  } catch (error) {
    next(error);
  }
});

router.get("/me", auth, async (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

module.exports = router;

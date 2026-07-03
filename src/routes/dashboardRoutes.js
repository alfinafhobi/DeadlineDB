const express = require("express");

const appConfig = require("../config/appConfig");
const auth = require("../middleware/auth");
const { getOrSetCache } = require("../services/cacheService");
const { buildDashboardOverview } = require("../services/dashboardService");

const router = express.Router();

router.use(auth);

router.get("/overview", async (req, res, next) => {
  try {
    const overview = await getOrSetCache(
      `dashboard:${req.user._id}`,
      appConfig.dashboardCacheTtlMs,
      () => buildDashboardOverview(req.user)
    );

    res.json({
      success: true,
      overview
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

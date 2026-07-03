require("dotenv").config();

const mongoose = require("mongoose");

const connectDB = require("../src/config/db");
const { seedDemoData } = require("../src/services/demoSeedService");

async function run() {
  await connectDB();
  const result = await seedDemoData({ reset: true });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  await mongoose.disconnect();
  process.exit(1);
});

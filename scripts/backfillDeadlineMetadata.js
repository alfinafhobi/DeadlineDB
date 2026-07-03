require("dotenv").config();

const mongoose = require("mongoose");

const connectDB = require("../src/config/db");
const Assignment = require("../src/models/Assignment");
const Reminder = require("../src/models/Reminder");
const {
  deadlineFieldsFromExtraction,
  dueDateFromDateOnly,
  extractDeadlineFromText
} = require("../src/services/deadlineExtractionService");

async function backfillModel(Model, textBuilder, parseSource) {
  const records = await Model.find({
    $or: [
      { dueDateTime: null },
      { dueTime: { $exists: false } },
      { parseConfidence: { $in: ["", null] } }
    ]
  });

  let updated = 0;

  for (const record of records) {
    const text = textBuilder(record);
    const extraction = extractDeadlineFromText(text, record.dueDate || new Date());
    const fallbackDate = record.dueDate ? dueDateFromDateOnly(record.dueDate) : null;
    const resolvedDate = extraction.resolvedDateTime || record.dueDate || fallbackDate;

    if (!resolvedDate) {
      continue;
    }

    const mergedExtraction = {
      ...extraction,
      resolvedDateTime: extraction.resolvedDateTime || resolvedDate,
      dueDate: extraction.dueDate || [
        resolvedDate.getFullYear(),
        String(resolvedDate.getMonth() + 1).padStart(2, "0"),
        String(resolvedDate.getDate()).padStart(2, "0")
      ].join("-"),
      dueTime: extraction.dueTime || `${String(resolvedDate.getHours()).padStart(2, "0")}:${String(resolvedDate.getMinutes()).padStart(2, "0")}`
    };

    Object.assign(record, {
      dueDate: resolvedDate,
      ...deadlineFieldsFromExtraction(mergedExtraction, parseSource)
    });
    await record.save();
    updated += 1;
  }

  return updated;
}

async function run() {
  await connectDB();
  const assignmentsUpdated = await backfillModel(
    Assignment,
    (record) => `${record.title || ""}\n${record.description || ""}`,
    "migration-assignment"
  );
  const remindersUpdated = await backfillModel(
    Reminder,
    (record) => `${record.title || ""}\n${record.description || ""}`,
    "migration-reminder"
  );

  process.stdout.write(`${JSON.stringify({ assignmentsUpdated, remindersUpdated }, null, 2)}\n`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  await mongoose.disconnect();
  process.exit(1);
});

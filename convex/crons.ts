import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Every 3 minutes: resume lessons whose generation died (action timeout,
// backend/sandbox restart, retry schedule that never fired). See
// lessons.reviveStuck for the matching rules.
crons.interval("revive stuck generation queue", { minutes: 3 }, internal.lessons.reviveStuck);

export default crons;

const { autoCancelExpiredRequests, syncPaidRequestsToConfirmed } = require('./request-lifecycle.service');
const { sweepExpiredCheckIns } = require('./noshow.service');

let intervalHandle = null;
let lastPassAt = 0;
let isRunningPass = false;

async function runLifecyclePass() {
  if (isRunningPass) return;
  isRunningPass = true;
  try {
    await syncPaidRequestsToConfirmed();
    await autoCancelExpiredRequests();
    await sweepExpiredCheckIns();
  } catch (err) {
    console.error('Scheduler error in lifecycle pass:', err.message);
  } finally {
    isRunningPass = false;
    lastPassAt = Date.now();
  }
}

function runLifecyclePassThrottled(minIntervalMs = 60000) {
  if (Date.now() - lastPassAt < minIntervalMs || isRunningPass) return;
  lastPassAt = Date.now();
  runLifecyclePass().catch(() => {});
}

function startScheduler(intervalMs = 60000) { // Run check every 1 minute
  if (intervalHandle) return;
  console.log('⏰ Request Lifecycle Auto-Cancel & Auto-Approval Scheduler started.');

  // Run initial pass on startup
  runLifecyclePass();

  intervalHandle = setInterval(() => {
    runLifecyclePass();
  }, intervalMs);
}

function stopScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = {
  startScheduler,
  stopScheduler,
  runLifecyclePass,
  runLifecyclePassThrottled,
};

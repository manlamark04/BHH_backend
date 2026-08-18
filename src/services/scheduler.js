const { autoCancelExpiredRequests, syncPaidRequestsToConfirmed } = require('./request-lifecycle.service');

let intervalHandle = null;

function startScheduler(intervalMs = 60000) { // Run check every 1 minute
  if (intervalHandle) return;
  console.log('⏰ Request Lifecycle Auto-Cancel & Auto-Approval Scheduler started.');

  // Run initial pass on startup
  syncPaidRequestsToConfirmed();
  autoCancelExpiredRequests();

  intervalHandle = setInterval(async () => {
    try {
      await syncPaidRequestsToConfirmed();
      await autoCancelExpiredRequests();
    } catch (err) {
      console.error('Scheduler error in lifecycle interval:', err.message);
    }
  }, intervalMs);
}

function stopScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = { startScheduler, stopScheduler };

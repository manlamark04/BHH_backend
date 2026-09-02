const { autoCancelExpiredRequests, syncPaidRequestsToConfirmed } = require('./request-lifecycle.service');
const { sweepExpiredCheckIns } = require('./noshow.service');

let intervalHandle = null;

function startScheduler(intervalMs = 60000) { // Run check every 1 minute
  if (intervalHandle) return;
  console.log('⏰ Request Lifecycle Auto-Cancel & Auto-Approval Scheduler started.');

  // Run initial pass on startup
  syncPaidRequestsToConfirmed();
  autoCancelExpiredRequests();
  sweepExpiredCheckIns();

  intervalHandle = setInterval(async () => {
    try {
      await syncPaidRequestsToConfirmed();
      await autoCancelExpiredRequests();
      await sweepExpiredCheckIns();
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

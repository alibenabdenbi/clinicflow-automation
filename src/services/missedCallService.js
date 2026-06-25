// src/services/missedCallService.js
// Thin façade over patientRecoveryEngine — keeps all existing export names stable
// so server.js, Netlify functions, and resultsReportService don't need changes.
//
// All recovery logic lives in patientRecoveryEngine.js.

export {
  startRecoveryThread  as handleMissedCall,
  buildTwiML           as buildMissedCallTwiML,
  getMissedCallStats,
  getRecoveryStats,
  lookupPatient,
  classifyReply,
  buildWaveMessage,
  processIncomingReply,
  runScheduledFollowUps,
} from "./patientRecoveryEngine.js";

// sendFollowUpSMS is no longer exported — the engine handles this internally.
// logMissedCall is no longer exported — threads replace the old flat log.

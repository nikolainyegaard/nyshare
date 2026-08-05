'use strict';
// Admin audit trail: logins, failed logins, logouts, settings changes and
// admin deletions, each with actor, client IP and user agent where a request
// exists. Kept separate from the share activity feed so bulk share traffic
// can never push security events out of the cap.
module.exports = require('./jsonlLog')('.audit.jsonl');

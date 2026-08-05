'use strict';
// Share activity feed for the admin page (uploads, downloads, expiries,
// deletions). Security events go to auditLog.js instead.
module.exports = require('./jsonlLog')('.activity.jsonl');

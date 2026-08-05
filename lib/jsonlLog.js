'use strict';
const fs = require('fs');
const path = require('path');
const config = require('../config');

// Append-only JSONL event log factory; backs the admin activity feed and the
// audit log, one file per instance in the upload dir.
// ponytail: whole-file read on tail() and compact(); fine for capped
// personal-instance logs, move to a real store if one ever grows past MBs
module.exports = function jsonlLog(filename, maxEvents = 1000) {
  const LOG_FILE = path.join(config.uploadDir, filename);

  function record(type, data) {
    const line = JSON.stringify({ time: Date.now(), type, ...data });
    fs.appendFile(LOG_FILE, line + '\n', err => {
      if (err) console.error(err);
    });
  }

  /** Newest first */
  function tail(limit = 200) {
    let raw;
    try {
      raw = fs.readFileSync(LOG_FILE, 'utf8');
    } catch (e) {
      return [];
    }
    return raw.split('\n')
      .filter(Boolean)
      .slice(-limit)
      .reverse()
      .map(l => {
        try { return JSON.parse(l); }
        catch (e) { return null; }
      })
      .filter(Boolean);
  }

  /** Trim the file to the newest maxEvents entries. Called once at startup. */
  function compact() {
    const events = tail(maxEvents).reverse();
    try {
      fs.writeFileSync(LOG_FILE, events.map(e => JSON.stringify(e)).join('\n') + (events.length ? '\n' : ''));
    } catch (e) {
      if (e.code !== 'ENOENT') console.error(e);
    }
  }

  return { record, tail, compact };
};

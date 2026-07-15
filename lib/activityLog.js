'use strict';
const fs = require('fs');
const path = require('path');
const config = require('../config');

// Append-only JSONL event feed for the admin page.
// ponytail: whole-file read on tail() and compact(); fine for a capped
// personal-instance log, move to a real store if this ever grows past MBs
const LOG_FILE = path.join(config.uploadDir, '.activity.jsonl');
const MAX_EVENTS = 1000;

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

/** Trim the file to the newest MAX_EVENTS entries. Called once at startup. */
function compact() {
  const events = tail(MAX_EVENTS).reverse();
  try {
    fs.writeFileSync(LOG_FILE, events.map(e => JSON.stringify(e)).join('\n') + (events.length ? '\n' : ''));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(e);
  }
}

module.exports = { record, tail, compact };

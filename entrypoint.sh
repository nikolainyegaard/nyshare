#!/bin/sh
chown node:node /data
exec su-exec node node app.js

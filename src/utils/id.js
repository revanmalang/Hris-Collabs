const { v4: uuidv4 } = require('uuid');

function newId() {
  return uuidv4();
}

function todayStr(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = { newId, todayStr, nowIso };

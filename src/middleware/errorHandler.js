const { ZodError } = require('zod');

class ApiError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// Never leaks stack traces or raw DB errors to the client (spec #37).
//
// mysql2 reports constraint violations via standard MySQL error codes
// (ER_DUP_ENTRY for UNIQUE, ER_NO_REFERENCED_ROW[_2] / ER_ROW_IS_REFERENCED[_2]
// for FOREIGN KEY, ER_BAD_NULL_ERROR for NOT NULL) - mapped here to the
// right HTTP status instead of leaking a raw 500 for what's really a client
// error (e.g. a duplicate name).
const MYSQL_DUPLICATE = 'ER_DUP_ENTRY';
const MYSQL_FK_VIOLATION = new Set(['ER_NO_REFERENCED_ROW', 'ER_NO_REFERENCED_ROW_2', 'ER_ROW_IS_REFERENCED', 'ER_ROW_IS_REFERENCED_2']);
const MYSQL_NOT_NULL = 'ER_BAD_NULL_ERROR';

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validation failed', details: err.flatten() });
  }
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err && err.code === MYSQL_DUPLICATE) {
    return res.status(409).json({ error: 'Duplicate value violates a unique constraint' });
  }
  if (err && MYSQL_FK_VIOLATION.has(err.code)) {
    return res.status(409).json({ error: 'Related record not found or still referenced' });
  }
  if (err && err.code === MYSQL_NOT_NULL) {
    return res.status(400).json({ error: 'A required field was missing' });
  }
  if (err && typeof err.code === 'string' && err.code.startsWith('ER_')) {
    console.error('[mysql]', err.code, err.sqlMessage || err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }

  console.error('[unhandled]', err);
  return res.status(500).json({ error: 'Internal server error' });
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not found' });
}

module.exports = { errorHandler, notFoundHandler, ApiError };

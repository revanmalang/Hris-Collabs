const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { apiLimiter } = require('./middleware/rateLimiter');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const apiRouter = require('./routes/index');

const app = express();

app.disable('x-powered-by');

// Secure headers. CSP allows the first-party app, inline UI handlers, the
// JS/CDN vendors below, and Google Fonts (Inter) used by the frontend.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.socket.io', 'https://cdn.jsdelivr.net'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:', 'https://cdn.socket.io', 'https://cdn.jsdelivr.net'],
      },
    },
  })
);

app.use(cors({ origin: process.env.CORS_ORIGIN || true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '8mb' })); // generous enough for base64 selfie photos
app.use(express.urlencoded({ extended: true }));
app.use('/api', apiLimiter);

app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use('/api', apiRouter);

app.use('/api', notFoundHandler);
app.use(errorHandler);

module.exports = app;

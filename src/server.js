require('dotenv').config();
const http = require('http');
const app = require('./app');
const { initSocket } = require('./realtime/socket');
const { loadCache } = require('./services/permissions');

const PORT = process.env.PORT || 4000;

async function main() {
  // Loads the role->permission matrix into memory once at boot so
  // hasPermission() can stay synchronous everywhere it's used (rbac.js,
  // every requirePermission(...) route gate). Must run before the server
  // accepts any requests, or the very first request could see an empty
  // matrix. Re-run `npm run db:migrate` and restart after directly editing
  // role_permissions outside the app; normal edits via Settings > Hak
  // Akses update this cache immediately without a restart.
  await loadCache();

  const server = http.createServer(app);
  initSocket(server, process.env.CORS_ORIGIN || true);

  server.listen(PORT, () => {
    console.log(`EmployeeHub HRIS server listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  const { explainDbError } = require('./db/friendlyErrors');
  const friendly = explainDbError(err);
  if (friendly) {
    console.error('\n❌ Server gagal jalan:\n');
    console.error(friendly);
    console.error('');
  } else {
    console.error('Failed to start server:', err);
  }
  process.exit(1);
});

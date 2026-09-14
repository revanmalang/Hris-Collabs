const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { newId } = require('../utils/id');

const ROOT = path.join(__dirname, '..', '..', 'uploads');

const ALLOWED_IMAGE = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_DOC = [...ALLOWED_IMAGE, 'application/pdf'];

function makeStorage(subdir) {
  const dir = path.join(ROOT, subdir);
  fs.mkdirSync(dir, { recursive: true });
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${newId()}${ext}`);
    },
  });
}

function fileFilterFor(allowed) {
  return (req, file, cb) => {
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
    cb(null, true);
  };
}

const uploadPhoto = multer({
  storage: makeStorage('photos'),
  fileFilter: fileFilterFor(ALLOWED_IMAGE),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const uploadAttendancePhoto = multer({
  storage: makeStorage('attendance'),
  fileFilter: fileFilterFor(ALLOWED_IMAGE),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const uploadDocument = multer({
  storage: makeStorage('documents'),
  fileFilter: fileFilterFor(ALLOWED_DOC),
  limits: { fileSize: 10 * 1024 * 1024 },
});

module.exports = { uploadPhoto, uploadAttendancePhoto, uploadDocument };

const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024, // 8MB
  },
  fileFilter: (req, file, cb) => {
    const allowed = new Set([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ]);

    if (allowed.has(file.mimetype)) return cb(null, true);
    return cb(new Error('Unsupported file type'), false);
  },
});

module.exports = { upload };


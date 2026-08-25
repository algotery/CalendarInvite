const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'avatars');
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

async function saveAvatar(fileBuffer, mimetype, profileId) {
  ensureUploadDir();

  if (!ALLOWED_TYPES.includes(mimetype)) {
    throw new Error('Invalid file type. Allowed: JPEG, PNG, WebP, GIF');
  }

  if (fileBuffer.length > MAX_FILE_SIZE) {
    throw new Error('File too large. Maximum size is 5MB');
  }

  const ext = mimetype.split('/')[1] === 'jpeg' ? 'jpg' : mimetype.split('/')[1];
  const hash = crypto.createHash('md5').update(fileBuffer).digest('hex').slice(0, 8);
  const filename = `${profileId}-${hash}.${ext}`;
  const filepath = path.join(UPLOAD_DIR, filename);

  fs.writeFileSync(filepath, fileBuffer);

  return `/uploads/avatars/${filename}`;
}

function deleteAvatar(avatarUrl) {
  if (!avatarUrl || !avatarUrl.startsWith('/uploads/avatars/')) return;
  const filepath = path.join(__dirname, '..', '..', 'public', avatarUrl);
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
  }
}

module.exports = { saveAvatar, deleteAvatar, MAX_FILE_SIZE, ALLOWED_TYPES };

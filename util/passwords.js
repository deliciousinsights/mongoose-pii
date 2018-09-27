const bcrypt = require('bcryptjs')
const { createHash } = require('crypto')

const MAX_BCRYPT_USED_BYTES = 72
const ROUNDS = process.env.NODE_ENV === 'production' ? 10 : 2

async function checkPassword(clearText, hash) {
  return bcrypt.compare(clearText, hash)
}

function hashPassword(clearText, { rounds = ROUNDS, sync = false } = {}) {
  const buf = Buffer.from(clearText, 'utf8')
  if (buf.length > MAX_BCRYPT_USED_BYTES) {
    const processor = createHash('sha512')
    processor.update(clearText)
    clearText = processor.digest('base64')
  }

  return sync
    ? bcrypt.hashSync(clearText, rounds)
    : bcrypt.hash(clearText, rounds)
}

module.exports = { checkPassword, hashPassword }

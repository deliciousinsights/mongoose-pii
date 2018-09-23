const {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} = require('crypto')

const ALGORITHM = 'aes-256-cbc'
const IV_BYTES = 16 // 128 / 8
const IV_BYTES_BASE64 = 22 // ceil(16 * 4 / 3), we strip the '==' suffix

function cipher(key, clearText, { deriveIV = true } = {}) {
  let iv

  if (deriveIV) {
    const hasher = createHash('sha512')
    hasher.update(clearText)
    iv = Buffer.alloc(IV_BYTES)
    hasher.digest().copy(iv, 0, 0, IV_BYTES)
  } else {
    iv = randomBytes(IV_BYTES)
  }

  const processor = createCipheriv(ALGORITHM, key, iv)
  const data = Buffer.concat([processor.update(clearText), processor.final()])
  const result = iv.toString('base64').slice(0, -2) + data.toString('base64')
  return result.toString('utf8')
}

function decipher(key, obscured) {
  const iv = Buffer.from(obscured.slice(0, IV_BYTES_BASE64) + '==', 'base64')
  const processor = createDecipheriv(ALGORITHM, key, iv)
  const data = Buffer.from(obscured.slice(IV_BYTES_BASE64), 'base64')
  const result = Buffer.concat([processor.update(data), processor.final()])
  return result.toString('utf8')
}

module.exports = { cipher, decipher }

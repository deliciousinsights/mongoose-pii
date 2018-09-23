const { checkPassword, hashPassword } = require('../util/passwords')
const { cipher, decipher } = require('../util/ciphers')

console.log('-- PII CIPHERING ------------------------------')

const key = '59aad44db330ad2bf34f6730e50c0058'

const clearText = 'hello world this is nice'
const obscured = cipher(key, clearText)
console.log(clearText, '->', obscured)

const deciphered = decipher(key, obscured)
console.log(obscured, '->', deciphered)

console.log('-- PASSWORDS ----------------------------------')

passDemo()

async function passDemo() {
  const hash = await hashPassword(clearText)
  console.log(clearText, '->', hash)

  console.log(clearText, '<>', hash, '->', await checkPassword(clearText, hash))
}

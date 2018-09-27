const { cipher, decipher } = require('./ciphers')

const key = '126d8cf92d95941e9907b0d9913ce00e'

describe('Cipher Utils', () => {
  const REGEX_OBSCURED = /^[\w/+]{38,}=*$/

  describe('cipher', () => {
    it('should use stable, derived IVs by default', () => {
      const obscured1 = cipher(key, 'foo@bar.com')
      const obscured2 = cipher(key, 'foo@bar.com')
      expect(obscured1).toMatch(REGEX_OBSCURED)
      expect(obscured2).toMatch(REGEX_OBSCURED)
      expect(obscured1).toEqual(obscured2)
    })

    it('should allow stable, derived IVs', () => {
      const obscured1 = cipher(key, 'foo@bar.com', { deriveIV: false })
      const obscured2 = cipher(key, 'foo@bar.com', { deriveIV: false })
      expect(obscured1).toMatch(REGEX_OBSCURED)
      expect(obscured2).toMatch(REGEX_OBSCURED)
      expect(obscured1).not.toEqual(obscured2)
    })
  })

  describe('decipher', () => {
    it('should work on both derived and random IV obscured texts', () => {
      expect(
        decipher(key, '2ZXfUUBPTPaETqXIA33bRwQNnif1/u/axrI84yQShR9Q==')
      ).toEqual('foo@bar.com')
      expect(
        decipher(key, 'Zj6jEHwYOGVDT92Dg9rKFw8DdfreEhm4pB4qtq6CdAFw==')
      ).toEqual('foo@bar.com')
    })
  })
})

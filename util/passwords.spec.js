const crypto = require('crypto')
const spy = jest.spyOn(crypto, 'createHash')
const { checkPassword, hashPassword } = require('./passwords')

describe('Password Utils', () => {
  describe('checkPassword', () => {
    it('should resolve to true on a matching hash', () => {
      expect(
        checkPassword(
          'secret',
          '$2a$04$VX4I2s9192QIuOLYdYw0aO.mc1GlnpgpLRzF8D7BpNxl/ficBIt4y'
        )
      ).resolves.toBeTruthy()
    })

    it('should resolve to false on a non-matching hash', () => {
      expect(
        checkPassword(
          'secret',
          '$2a$04$VX4I2s9192QIuOLYdYw0aO.mc1GlnpgpLRzF8D7BpNxl/xxxxxxxx'
        )
      ).resolves.toBeFalsy()

      expect(checkPassword('secret', '')).resolves.toBeFalsy()
    })
  })

  describe('hashPassword', () => {
    // function hashPassword(clearText, { rounds = ROUNDS, sync = false } = {})
    it('should default to 4 rounds outside production', () => {
      expect(hashPassword('secret')).resolves.toMatch(/^\$2a\$04\$/)
    })

    it('should default to 10 rounds in production', () => {
      jest.resetModules()
      const oldEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'
      try {
        const { hashPassword } = require('./passwords')
        expect(hashPassword('secret')).resolves.toMatch(/^\$2a\$10\$/)
      } finally {
        process.env.NODE_ENV = oldEnv
      }
    })

    it('should accept custom rounds', () => {
      expect(hashPassword('secret', { rounds: 6 })).resolves.toMatch(
        /^\$2a\$06\$/
      )
    })

    it('should allow synchronous usage', () => {
      expect(hashPassword('secret', { sync: true })).toMatch(/^\$2a\$04\$/)
    })

    it('should SHA512 its input if it’s above maximum bcrypt input size, to preserve entropy', () => {
      spy.mockClear()
      const input = crypto.randomBytes(256).toString('utf8')
      hashPassword(input, { sync: true })

      expect(spy).toHaveBeenCalledWith('sha512')
    })
  })
})

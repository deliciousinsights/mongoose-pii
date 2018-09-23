describe('cipherObject', () => {
  const key = '59aad44db330ad2bf34f6730e50c0058'
  let cipherObject

  beforeAll(() => {
    jest.resetModules()
    jest.doMock('./util/ciphers', () => ({
      cipher(_, clearText) {
        return `CIPHERED:${clearText}`
      },
    }))

    cipherObject = require('./markFieldsAsPII').tests.cipherObject
  })

  afterAll(() => {
    jest.dontMock('./util/ciphers')
  })

  it('should only cipher specified fields', () => {
    const obj = { firstName: 'John', lastName: 'Smith', age: 42 }
    const expected = {
      firstName: 'CIPHERED:John',
      lastName: 'CIPHERED:Smith',
      age: 42,
    }
    cipherObject(obj, { fields: ['firstName', 'lastName'], key })

    expect(obj).toEqual(expected)
  })

  it('should dive into operator descriptors', () => {
    const update = { $set: { age: 18, firstName: 'Mark' } }
    const expected = {
      $set: { age: 18, firstName: 'CIPHERED:Mark' },
    }
    cipherObject(update, { fields: ['firstName', 'lastName'], key })

    expect(update).toEqual(expected)
  })

  it('should dive into object values', () => {
    const obj = {
      identity: { firstName: 'John', lastName: 'Smith' },
      firstName: 'Mark',
    }
    const expected = {
      identity: {
        firstName: 'CIPHERED:John',
        lastName: 'CIPHERED:Smith',
      },
      firstName: 'CIPHERED:Mark',
    }
    cipherObject(obj, { fields: ['firstName', 'lastName'], key })

    expect(obj).toEqual(expected)
  })

  it('should dive into array values', () => {
    const obj = {
      aliases: ['Killer', 'Boss', 'Spy'],
      firstName: 'John',
      lastName: 'Smith',
    }
    const expected = {
      aliases: ['CIPHERED:Killer', 'CIPHERED:Boss', 'CIPHERED:Spy'],
      firstName: 'CIPHERED:John',
      lastName: 'CIPHERED:Smith',
    }
    cipherObject(obj, { fields: ['aliases', 'firstName', 'lastName'], key })

    expect(obj).toEqual(expected)
  })

  it('should handle nested field descriptors', () => {
    const obj = {
      identity: { firstName: 'John', lastName: 'Smith' },
      age: 42,
      firstName: 'Mark',
    }
    const expected = {
      identity: {
        firstName: 'CIPHERED:John',
        lastName: 'CIPHERED:Smith',
      },
      age: 42,
      firstName: 'Mark',
    }
    cipherObject(obj, {
      fields: ['identity.firstName', 'identity.lastName'],
      key,
    })

    expect(obj).toEqual(expected)
  })
})

describe('cipherValue', () => {
  const { cipherValue } = require('./markFieldsAsPII').tests
  const key = '126d8cf92d95941e9907b0d9913ce00e'

  it('should handle Buffer values', () => {
    const actual = cipherValue(key, Buffer.from('yowza', 'utf8'))
    const expected = 'SaUyLkjzcKSwx9PY2c6A5geG7Ydb0nOAFiwQqJZweE+Q=='
    expect(actual).toEqual(expected)
  })

  it('should handle String values', () => {
    const actual = cipherValue(key, 'yowza')
    const expected = 'SaUyLkjzcKSwx9PY2c6A5geG7Ydb0nOAFiwQqJZweE+Q=='
    expect(actual).toEqual(expected)
  })

  it('should handle non-Buffer, non-String values', () => {
    expect(cipherValue(key, 42)).toEqual(
      'Ocp86ezGn2lr99ILsj3RUgDAN6Jv5s8/5L00TeTW6Zmg=='
    )
    expect(cipherValue(key, new Date('2018-09-21T10:33:50Z'))).toEqual(
      '0jnFzuxuTv5lUbXF7cEyZAZwGFkI0ksYPnsc/95+kSuIUHzP6VaLAmFaHqfLFnqa402SdL0LAE93jiZn7OMW9L'
    )
  })

  it('should be stable across calls for the same value', () => {
    const expected = 'SaUyLkjzcKSwx9PY2c6A5geG7Ydb0nOAFiwQqJZweE+Q=='
    for (let index = 0; index < 10; ++index) {
      const actual = cipherValue(key, 'yowza')
      expect(actual).toEqual(expected)
    }
  })
})

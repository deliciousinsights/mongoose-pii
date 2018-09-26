const MongoDBMemoryServer = require('mongodb-memory-server').default
const mongoose = require('mongoose')

describe('markFieldsAsPII plugin', () => {
  let connection
  let server
  let User
  let userCollection

  beforeAll(async () => {
    // DEV NOTE: do NOT resetModules() here, as it'll impact Mongoose’s
    // internal driver initialization, leading to weird "Decimal128 of null"
    // errors -- this one was tough to hunt down…
    jest.dontMock('./util/ciphers')
    const { markFieldsAsPII } = require('./markFieldsAsPII')

    server = new MongoDBMemoryServer()
    const url = await server.getConnectionString()
    connection = await mongoose.createConnection(url, {
      autoReconnect: true,
      connectTimeoutMS: 1000,
      reconnectInterval: 100,
      reconnectTries: Number.MAX_VALUE,
      useNewUrlParser: true,
    })
    const schema = new mongoose.Schema({
      email: String,
      firstName: String,
      historySize: Number,
      lastName: String,
      role: String,
    })

    const key = '126d8cf92d95941e9907b0d9913ce00e'
    schema.plugin(markFieldsAsPII, {
      fields: ['email', 'firstName', 'lastName'],
      key,
    })

    User = connection.model('User', schema)
    userCollection = connection.collection('users')
  })

  afterAll(() => {
    connection.close()
    server.stop()
  })

  it('should cipher DB fields on create', async () => {
    const user = await User.create({
      email: 'foo@bar.com',
      firstName: 'John',
      historySize: 100,
      lastName: 'Smith',
      role: 'guest',
    })

    // Instance fields were deciphered back again
    expect(user.email).toEqual('foo@bar.com')
    expect(user.firstName).toEqual('John')
    expect(user.lastName).toEqual('Smith')

    // DB fields were ciphered
    const doc = await rawDocFor(user)
    expect(doc.email).toEqual('2ZXfUUBPTPaETqXIA33bRwQNnif1/u/axrI84yQShR9Q==')
    expect(doc.firstName).toEqual(
      'QbbQzV3asVB0+Ivxw1bonAIjsLZzhRCjyMoCeHeAE8Lg=='
    )
    expect(doc.historySize).toEqual(100)
    expect(doc.lastName).toEqual(
      'L0H0hF8b4HZSxYiKRbMntQsLUZRGr6OpauwAEWsAP4jA=='
    )
    expect(doc.role).toEqual('guest')
  })

  it('should cipher DB fields on save', async () => {
    const user = new User({
      email: 'foo@bar.com',
      firstName: 'John',
      historySize: 100,
      lastName: 'Smith',
      role: 'guest',
    })
    await user.save()

    // Instance fields were deciphered back again
    expect(user.email).toEqual('foo@bar.com')
    expect(user.firstName).toEqual('John')
    expect(user.lastName).toEqual('Smith')

    // DB fields were ciphered
    const doc = await rawDocFor(user)
    expect(doc.email).toEqual('2ZXfUUBPTPaETqXIA33bRwQNnif1/u/axrI84yQShR9Q==')
    expect(doc.firstName).toEqual(
      'QbbQzV3asVB0+Ivxw1bonAIjsLZzhRCjyMoCeHeAE8Lg=='
    )
    expect(doc.historySize).toEqual(100)
    expect(doc.lastName).toEqual(
      'L0H0hF8b4HZSxYiKRbMntQsLUZRGr6OpauwAEWsAP4jA=='
    )
    expect(doc.role).toEqual('guest')
  })

  it('should cipher DB fields on insertMany', async () => {
    const data = [
      {
        email: [
          'foo@bar.com',
          '2ZXfUUBPTPaETqXIA33bRwQNnif1/u/axrI84yQShR9Q==',
        ],
        firstName: ['John', 'QbbQzV3asVB0+Ivxw1bonAIjsLZzhRCjyMoCeHeAE8Lg=='],
        lastName: ['Smith', 'L0H0hF8b4HZSxYiKRbMntQsLUZRGr6OpauwAEWsAP4jA=='],
      },
      {
        email: [
          'mark@example.com',
          'qdxEGhjGiXX8dQvjEFp4yASg5f8rgyBzDF0X9l7T1jbhG+Dbajz5EENQ0TEpaxOlc=',
        ],
        firstName: ['Mark', 'Aj6ic0IkuWp3LV5P31i76Q1+eHIACe7wck3uM0vfBu1Q=='],
        lastName: ['Roberts', 'tmoDgrAWHw60SdZPl4pJLgfGmzIAYRuPiGCuK3JtgxTQ=='],
      },
    ]
    for (const datum of data) {
      datum.historySize = [100, 100]
      datum.role = ['guest', 'guest']
    }

    // Insert data descriptors should not use [clearText, ciphered] pairs, but
    // just clearText values, so let's derive a proper descriptor array from above.
    const insertData = data.map((desc) =>
      Object.entries(desc).reduce((obj, [field, [clearText]]) => {
        obj[field] = clearText
        return obj
      }, {})
    )
    const users = await User.insertMany(insertData)

    // And now let's check all the fields across both Mongoose Documents
    // and stored raw MongoDB documents.
    for (const [index, user] of users.entries()) {
      const doc = await rawDocFor(user)
      for (const [field, [clearText, ciphered]] of Object.entries(
        data[index]
      )) {
        // It stinks to high Heaven that Jasmine/Jest matchers do not allow
        // a custom failure message, like, say, Chai or RSpec would. Unbelievable.
        // jest-expect-message is a solution, but putting the message *inside expect*
        // instead of as a last arg in the matcher just looks fugly.
        expect(user[field]).toEqual(clearText)
        expect(doc[field]).toEqual(ciphered)
      }
    }
  })

  it('should uncipher fields on finds', async () => {
    const { ops: docs } = await userCollection.insertMany([
      {
        email: '2ZXfUUBPTPaETqXIA33bRwQNnif1/u/axrI84yQShR9Q==',
        firstName: 'QbbQzV3asVB0+Ivxw1bonAIjsLZzhRCjyMoCeHeAE8Lg==',
        historySize: 100,
        lastName: 'L0H0hF8b4HZSxYiKRbMntQsLUZRGr6OpauwAEWsAP4jA==',
        role: 'guest',
      },
      {
        email:
          'qdxEGhjGiXX8dQvjEFp4yASg5f8rgyBzDF0X9l7T1jbhG+Dbajz5EENQ0TEpaxOlc=',
        firstName: 'Aj6ic0IkuWp3LV5P31i76Q1+eHIACe7wck3uM0vfBu1Q==',
        historySize: 100,
        lastName: 'tmoDgrAWHw60SdZPl4pJLgfGmzIAYRuPiGCuK3JtgxTQ==',
        role: 'guest',
      },
    ])

    const users = await User.find({ _id: docs.map(({ _id }) => _id) })
    expect(users[0]).toMatchObject({
      email: 'foo@bar.com',
      firstName: 'John',
      historySize: 100,
      lastName: 'Smith',
      role: 'guest',
    })
    expect(users[1]).toMatchObject({
      email: 'mark@example.com',
      firstName: 'Mark',
      historySize: 100,
      lastName: 'Roberts',
      role: 'guest',
    })
  })

  it('should cipher queries for finds', async () => {
    const {
      ops: [doc],
    } = await userCollection.insertOne({
      email: '2ZXfUUBPTPaETqXIA33bRwQNnif1/u/axrI84yQShR9Q==',
      firstName: 'QbbQzV3asVB0+Ivxw1bonAIjsLZzhRCjyMoCeHeAE8Lg==',
      historySize: 100,
      lastName: 'L0H0hF8b4HZSxYiKRbMntQsLUZRGr6OpauwAEWsAP4jA==',
      role: 'guest',
    })

    for (const result of await Promise.all([
      User.find({ _id: doc._id, email: 'foo@bar.com', role: 'guest' }),
      User.findOne({ _id: doc._id, email: 'foo@bar.com', role: 'guest' }),
      User.findOneAndDelete({
        _id: doc._id,
        email: 'foo@bar.com',
        role: 'guest',
      }),
    ])) {
      const user = Array.isArray(result) ? result[0] : result
      expect(user).toMatchObject({
        email: 'foo@bar.com',
        firstName: 'John',
        historySize: 100,
        lastName: 'Smith',
        role: 'guest',
      })
    }
  })

  it('should cipher updates for findOneAndUpdate', async () => {
    const {
      ops: [doc],
    } = await userCollection.insertOne({
      email: '2ZXfUUBPTPaETqXIA33bRwQNnif1/u/axrI84yQShR9Q==',
      firstName: 'QbbQzV3asVB0+Ivxw1bonAIjsLZzhRCjyMoCeHeAE8Lg==',
      historySize: 100,
      lastName: 'L0H0hF8b4HZSxYiKRbMntQsLUZRGr6OpauwAEWsAP4jA==',
      role: 'guest',
    })

    const user = await User.findOneAndUpdate(
      { _id: doc._id },
      {
        email: 'foo@bar.net',
        role: 'admin',
      },
      { new: true }
    )
    expect(user).toMatchObject({
      email: 'foo@bar.net',
      firstName: 'John',
      historySize: 100,
      lastName: 'Smith',
      role: 'admin',
    })

    const updatedDoc = await userCollection.findOne({ _id: doc._id })
    expect(updatedDoc).toMatchObject({
      email: 'YQ3zjPwlyq6xP8+Aq4uSrwEmOooRV/uaPioRQog9zoBQ==',
      role: 'admin',
    })
  })

  it('should cipher queries for counts', async () => {
    const attrs = {
      email: '2ZXfUUBPTPaETqXIA33bRwQNnif1/u/axrI84yQShR9Q==',
      firstName: 'QbbQzV3asVB0+Ivxw1bonAIjsLZzhRCjyMoCeHeAE8Lg==',
      historySize: 150,
      lastName: 'L0H0hF8b4HZSxYiKRbMntQsLUZRGr6OpauwAEWsAP4jA==',
      role: 'countable',
    }
    const descriptors = [1, 2, 3].map(() => ({ ...attrs }))
    const { ops: docs } = await userCollection.insertMany(descriptors)

    expect(
      await User.count({ email: 'foo@bar.com', role: 'countable' })
    ).toEqual(descriptors.length)
    expect(
      await User.countDocuments({ firstName: 'John', role: 'countable' })
    ).toEqual(descriptors.length)
  })

  it('should cipher queries for updates and replaces', async () => {
    const attrs = {
      email: '2ZXfUUBPTPaETqXIA33bRwQNnif1/u/axrI84yQShR9Q==',
      firstName: 'QbbQzV3asVB0+Ivxw1bonAIjsLZzhRCjyMoCeHeAE8Lg==',
      historySize: 100,
      lastName: 'L0H0hF8b4HZSxYiKRbMntQsLUZRGr6OpauwAEWsAP4jA==',
      role: 'updatable',
    }
    const descriptors = [1, 2, 3, 4, 5].map(() => ({ ...attrs }))
    const { ops: docs } = await userCollection.insertMany(descriptors)

    const result = await Promise.all([
      User.replaceOne(
        { _id: docs[0]._id, email: 'foo@bar.com', role: 'updatable' },
        {
          ...attrs,
          role: 'updated',
        }
      ),
      User.update(
        { _id: docs[1]._id, email: 'foo@bar.com', role: 'updatable' },
        {
          $set: { role: 'updated' },
        }
      ),
      User.updateOne(
        { _id: docs[2]._id, email: 'foo@bar.com', role: 'updatable' },
        {
          $set: { role: 'updated' },
        }
      ),
      User.updateMany(
        {
          _id: docs.slice(3).map(({ _id }) => _id),
          email: 'foo@bar.com',
          role: 'updatable',
        },
        {
          $set: { role: 'updated' },
        }
      ),
    ])

    expect(result).toMatchObject([
      { n: 1, nModified: 1 },
      { n: 1, nModified: 1 },
      { n: 1, nModified: 1 },
      { n: 2, nModified: 2 },
    ])
  })

  it('should cipher updates on updates and replaces', async () => {
    const attrs = {
      email: '2ZXfUUBPTPaETqXIA33bRwQNnif1/u/axrI84yQShR9Q==',
      firstName: 'QbbQzV3asVB0+Ivxw1bonAIjsLZzhRCjyMoCeHeAE8Lg==',
      historySize: 100,
      lastName: 'L0H0hF8b4HZSxYiKRbMntQsLUZRGr6OpauwAEWsAP4jA==',
      role: 'updateCipherable',
    }
    const descriptors = [1, 2, 3, 4, 5].map(() => ({ ...attrs }))
    const { ops: docs } = await userCollection.insertMany(descriptors)

    await Promise.all([
      User.replaceOne({ _id: docs[0]._id }, { ...attrs, email: 'foo@bar.net' }),
      User.update({ _id: docs[1]._id }, { $set: { firstName: 'Mark' } }),
      User.updateOne({ _id: docs[2]._id }, { $set: { lastName: 'Roberts' } }),
      User.updateMany(
        { _id: docs.slice(3).map(({ _id }) => _id) },
        { $set: { email: 'foo@bar.net' } }
      ),
    ])

    const updatedDocs = await userCollection
      .find({ role: 'updateCipherable' })
      .toArray()
    expect(updatedDocs).toMatchObject([
      { email: 'YQ3zjPwlyq6xP8+Aq4uSrwEmOooRV/uaPioRQog9zoBQ==' },
      { firstName: 'Aj6ic0IkuWp3LV5P31i76Q1+eHIACe7wck3uM0vfBu1Q==' },
      { lastName: 'tmoDgrAWHw60SdZPl4pJLgfGmzIAYRuPiGCuK3JtgxTQ==' },
      { email: 'YQ3zjPwlyq6xP8+Aq4uSrwEmOooRV/uaPioRQog9zoBQ==' },
      { email: 'YQ3zjPwlyq6xP8+Aq4uSrwEmOooRV/uaPioRQog9zoBQ==' },
    ])
  })

  function rawDocFor(modelDoc) {
    return userCollection.findOne({ _id: modelDoc._id })
  }
})

describe('Helper functions', () => {
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

  describe('processObject', () => {
    const key = '59aad44db330ad2bf34f6730e50c0058'
    let processObject

    beforeAll(() => {
      jest.resetModules()
      jest.doMock('./util/ciphers', () => ({
        cipher(_, clearText) {
          return `CIPHERED:${clearText}`
        },
        decipher(_, obscured) {
          return `DECIPHERED:${obscured}`
        },
      }))

      processObject = require('./markFieldsAsPII').tests.processObject
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
      processObject(obj, { fields: ['firstName', 'lastName'], key })

      expect(obj).toEqual(expected)
    })

    it('should dive into operator descriptors', () => {
      const update = { $set: { age: 18, firstName: 'Mark' } }
      const expected = {
        $set: { age: 18, firstName: 'CIPHERED:Mark' },
      }
      processObject(update, { fields: ['firstName', 'lastName'], key })

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
      processObject(obj, { fields: ['firstName', 'lastName'], key })

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
      processObject(obj, { fields: ['aliases', 'firstName', 'lastName'], key })

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
      processObject(obj, {
        fields: ['identity.firstName', 'identity.lastName'],
        key,
      })

      expect(obj).toEqual(expected)
    })

    it('should work in decipher mode', () => {
      const obj = {
        identity: {
          aliases: ['Killer', 'Boss', 'Spy'],
          firstName: 'John',
          lastName: 'Smith',
        },
        firstName: 'Mark',
      }
      const expected = {
        identity: {
          aliases: ['DECIPHERED:Killer', 'DECIPHERED:Boss', 'DECIPHERED:Spy'],
          firstName: 'DECIPHERED:John',
          lastName: 'DECIPHERED:Smith',
        },
        firstName: 'Mark',
      }

      processObject(obj, {
        fields: ['aliases', 'identity.firstName', 'lastName'],
        key,
        mode: 'decipher',
      })

      expect(obj).toEqual(expected)
    })

    it('should work in document mode', () => {
      const obj = {
        identity: { aliases: ['Foo', 'Bar'] },
        trap: { firstName: 'Mark', lastName: 'Roberts' },
        firstName: 'John',
        lastName: 'Smith',
      }
      const expected = {
        identity: { aliases: ['CIPHERED:Foo', 'CIPHERED:Bar'] },
        trap: { firstName: 'Mark', lastName: 'Roberts' },
        firstName: 'CIPHERED:John',
        lastName: 'CIPHERED:Smith',
      }
      processObject(obj, {
        fields: ['identity.aliases', 'firstName', 'lastName'],
        key,
        isDocument: true,
      })

      expect(obj).toEqual(expected)
    })
  })
})

const MongoDBMemoryServer = require('mongodb-memory-server').default
const mongoose = require('mongoose')

describe('markFieldsAsPII plugin', () => {
  let connection
  let server

  beforeAll(async () => {
    // DEV NOTE: do NOT resetModules() here, as it'll impact Mongoose’s
    // internal driver initialization, leading to weird "Decimal128 of null"
    // errors -- this one was tough to hunt down…
    jest.dontMock('./util/ciphers')

    server = new MongoDBMemoryServer()
    const url = await server.getConnectionString()
    connection = await mongoose.createConnection(url, {
      autoReconnect: true,
      connectTimeoutMS: 1000,
      reconnectInterval: 100,
      reconnectTries: Number.MAX_VALUE,
      useNewUrlParser: true,
    })
  })

  afterAll(() => {
    connection.close()
    server.stop()
  })

  describe('when checking its options', () => {
    const { markFieldsAsPII } = require('./markFieldsAsPII')

    it('should mandate either a `fields` or `passwordFields` option', () => {
      expect(() => markFieldsAsPII({})).toThrowError(
        /at least one of.*fields.*passwordFields/
      )
    })

    it('should mandate a `key` setting when `fields` is provided', () => {
      expect(() => markFieldsAsPII({}, { fields: ['email'] })).toThrowError(
        /Missing required.*key/
      )
    })
  })

  describe('when dealing with PII fields', () => {
    let User
    let userCollection

    beforeAll(() => {
      const { markFieldsAsPII } = require('./markFieldsAsPII')
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

      User = connection.model('PIIUser', schema)
      userCollection = new User().collection
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
      expect(doc.email).toEqual(
        '2ZXfUUBPTPaETqXIA33bRwQNnif1/u/axrI84yQShR9Q=='
      )
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
      expect(doc.email).toEqual(
        '2ZXfUUBPTPaETqXIA33bRwQNnif1/u/axrI84yQShR9Q=='
      )
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
          lastName: [
            'Roberts',
            'tmoDgrAWHw60SdZPl4pJLgfGmzIAYRuPiGCuK3JtgxTQ==',
          ],
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

      // We serialize this to avoid deletion happening before another find
      // completes (due to the parallel execution of `Promise.all`), which
      // would cause random failures as we've routinely seen on Travis :-/
      const results = [
        ...(await User.find({
          _id: doc._id,
          email: 'foo@bar.com',
          role: 'guest',
        })),
        await User.findOne({
          _id: doc._id,
          email: 'foo@bar.com',
          role: 'guest',
        }),
        await User.findOneAndDelete({
          _id: doc._id,
          email: 'foo@bar.com',
          role: 'guest',
        }),
      ]
      for (const user of results) {
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
      await userCollection.insertMany(descriptors)

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
        User.replaceOne(
          { _id: docs[0]._id },
          { ...attrs, email: 'foo@bar.net' }
        ),
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
      return modelDoc.collection.findOne({ _id: modelDoc._id })
    }
  })

  describe('when dealing with password fields', () => {
    let User
    let userCollection

    beforeAll(() => {
      const { markFieldsAsPII } = require('./markFieldsAsPII')
      const schema = new mongoose.Schema({
        admin: { password: String, role: String },
        a: { b: { secret: String } },
        email: String,
        password: String,
      })

      schema.plugin(markFieldsAsPII, {
        passwordFields: ['password', 'admin.password', 'a.b.secret'],
      })

      User = connection.model('PassUser', schema)
      userCollection = new User().collection
    })

    it('should hash on save', async () => {
      const user = new User({
        email: 'foo@bar.com',
        password: 'foobar',
        admin: { role: 'manager', password: 'foobar42' },
      })
      await user.save()
      const doc = await userCollection.findOne({ _id: user._id })

      expect(user.email).toEqual('foo@bar.com')
      expect(user.admin.role).toEqual('manager')
      expect(user.password).toMatch(/^\$2a\$\d{2}\$.{53}$/)
      expect(doc.password).toEqual(user.password)
      expect(user.admin.password).toMatch(/^\$2a\$\d{2}\$.{53}$/)
      expect(doc.admin.password).toEqual(user.admin.password)
    })

    it('should not double-hash', async () => {
      const user = await User.create({ password: 'foobar' })
      const pwd = user.password

      await user.save()
      expect(user.password).toEqual(pwd)
    })

    it('should hash on insertMany', async () => {
      const users = await User.insertMany([
        { email: 'foo@bar.net', password: 'kapoué' },
        { email: 'foo@bar.org', password: 'yolo' },
      ])
      const docs = await User.find({ email: users.map(({ email }) => email) })

      for (const [index, user] of users.entries()) {
        expect(user.password).toMatch(/^\$2a\$\d{2}\$.{53}$/)
        expect(docs[index].password).toEqual(user.password)
      }
    })

    it('should not use stable hashes', async () => {
      const descriptors = Array(10)
        .fill(true)
        .map(() => ({ password: 'foobar' }))
      const users = await User.insertMany(descriptors)
      const uniqueHashes = new Set(users.map(({ password }) => password))

      expect(uniqueHashes.size).toEqual(descriptors.length)
    })

    it('should provide a static authenticate method for models', () => {
      expect(User).toHaveProperty('authenticate')
      expect(User.authenticate).toBeInstanceOf(Function)
    })

    it('should require at least one defined password field', () => {
      expect(User.authenticate({ email: 'foo@bar.com' })).rejects.toThrowError(
        /No password field.*found/
      )
    })

    it('should authenticate honoring query fields', async () => {
      const users = await User.insertMany([
        { email: 'query@example.com', password: 'query' },
        { email: 'query@example.net', password: 'query' },
      ])

      expect(await User.authenticate({ password: 'query' })).toMatchObject(
        users[0].toJSON()
      )
      expect(
        await User.authenticate({ password: 'query' }, { single: false })
      ).toHaveLength(2)
      expect(
        await User.authenticate({
          email: 'query@example.com',
          password: 'query',
        })
      ).toMatchObject(users[0].toJSON())
      expect(
        await User.authenticate({
          email: 'query@example.org',
          password: 'query',
        })
      ).toBeNull()
    })

    it('should be able to authenticate across multiple password fields', async () => {
      const users = await User.insertMany([
        { password: 'toplevel' },
        { password: 'toplevel', a: { b: { secret: 'yo' } } },
      ])

      expect(
        await User.authenticate({
          password: 'toplevel',
          a: { b: { secret: 'yo' } },
        })
      ).toMatchObject(users[1].toJSON())
    })
  })

  describe('when dealing with both PII and password fields', () => {
    it('should be able to authenticate with queries that need ciphering', async () => {
      const { markFieldsAsPII } = require('./markFieldsAsPII')
      const schema = new mongoose.Schema({
        email: String,
        password: String,
        kind: String,
      })

      schema.plugin(markFieldsAsPII, {
        fields: 'email',
        key: '126d8cf92d95941e9907b0d9913ce00e',
        passwordFields: 'password',
      })

      const User = connection.model('HardUser', schema)

      const user = await User.create({
        email: 'foo@bar.com',
        kind: 'hard',
        password: 'foobar',
      })

      const users = await User.authenticate({
        kind: 'hard',
        email: 'foo@bar.com',
        password: 'foobar',
      })
      expect(users).toMatchObject(user.toJSON())
    })
  })
})

describe('pluginWasUsedOn', () => {
  let markFieldsAsPII
  let pluginWasUsedOn

  beforeAll(() => {
    ;({ markFieldsAsPII, pluginWasUsedOn } = require('./markFieldsAsPII'))
  })

  it('should return true on Schemas that use the plugin', () => {
    const schema = new mongoose.Schema({ name: String, password: String })
    schema.plugin(markFieldsAsPII, { passwordFields: 'password' })

    expect(pluginWasUsedOn(schema)).toBeTruthy()
  })

  it('should return true on Models whose schemas use the plugin', () => {
    const schema = new mongoose.Schema({ name: String, password: String })
    schema.plugin(markFieldsAsPII, { passwordFields: 'password' })
    const Model = mongoose.model('UsingPlugin', schema)

    expect(pluginWasUsedOn(Model)).toBeTruthy()
  })

  it('should return false on Schemas that don’t use the plugin', () => {
    const schema = new mongoose.Schema({ name: String })

    expect(pluginWasUsedOn(schema)).toBeFalsy()
  })

  it('should return false on Models whose schemas don’t use the plugin', () => {
    const schema = new mongoose.Schema({ name: String })
    const Model = mongoose.model('NotUsingPlugin', schema)

    expect(pluginWasUsedOn(Model)).toBeFalsy()
  })
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
      expect(cipherValue(key, /foobar/)).toEqual(
        'KS13lM9qZVEPZ9eVFTUisQXbLWlfJ394d0C+WgbYMe3w=='
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

    it('should refuse invalid modes', () => {
      expect(() => processObject({}, { mode: 'yolo' })).toThrowError(
        'Unknown processObject mode: yolo'
      )
    })

    it('should only cipher specified fields', () => {
      const obj = { firstName: 'John', lastName: 'Smith', age: 42 }
      const expected = {
        firstName: 'CIPHERED:John',
        lastName: 'CIPHERED:Smith',
        age: 42,
      }
      processObject(obj, {
        fields: ['firstName', 'lastName'],
        key,
        mode: 'cipher',
      })

      expect(obj).toEqual(expected)
    })

    it('should dive into operator descriptors', () => {
      const update = { $set: { age: 18, firstName: 'Mark' } }
      const expected = {
        $set: { age: 18, firstName: 'CIPHERED:Mark' },
      }
      processObject(update, {
        fields: ['firstName', 'lastName'],
        key,
        mode: 'cipher',
      })

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
      processObject(obj, {
        fields: ['firstName', 'lastName'],
        key,
        mode: 'cipher',
      })

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
      processObject(obj, {
        fields: ['aliases', 'firstName', 'lastName'],
        key,
        mode: 'cipher',
      })

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
        mode: 'cipher',
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
        mode: 'cipher',
      })

      expect(obj).toEqual(expected)
    })
  })

  describe('splitAuthenticationFields', () => {
    const { splitAuthenticationFields } = require('./markFieldsAsPII').tests

    it('should split toplevel fields', () => {
      const fields = { email: 'foo@bar.com', password: 'foobar' }
      const passwordFields = ['password']

      expect(splitAuthenticationFields({ fields, passwordFields })).toEqual({
        query: { email: 'foo@bar.com' },
        passwords: { password: 'foobar' },
      })
    })

    it('should split nested fields', () => {
      const fields = {
        email: 'foo@bar.com',
        password: 'foobar',
        admin: { role: 'manager', password: 'quuxdoo' },
      }
      const passwordFields = ['password', 'admin.password']

      expect(splitAuthenticationFields({ fields, passwordFields })).toEqual({
        query: { email: 'foo@bar.com', admin: { role: 'manager' } },
        passwords: { password: 'foobar', admin: { password: 'quuxdoo' } },
      })
    })
  })

  describe('updateObject', () => {
    const { updateObject } = require('./markFieldsAsPII').tests

    it('should work on existing containers', () => {
      const obj = { foo: 'bar', xyz: 123 }

      updateObject(obj, 'foo', 'baz')
      expect(obj).toEqual({ foo: 'baz', xyz: 123 })

      obj.nested = { abc: 'def', ghi: 'jkl' }
      updateObject(obj, 'nested.ghi', 'JKL')
      updateObject(obj, 'nested.mno', 'pqr')
      expect(obj.nested).toEqual({ abc: 'def', ghi: 'JKL', mno: 'pqr' })
    })

    it('should create missing containers on-the-fly', () => {
      const obj = { foo: 'bar', xyz: 123, nested: { abc: 'def' } }

      updateObject(obj, 'nested.deeper.wow', 'much win')
      updateObject(obj, 'parallel.yowza', 'such code')
      expect(obj).toEqual({
        foo: 'bar',
        xyz: 123,
        nested: { abc: 'def', deeper: { wow: 'much win' } },
        parallel: { yowza: 'such code' },
      })
    })
  })

  describe('walkDocumentPasswordFields', () => {
    const { walkDocumentPasswordFields } = require('./markFieldsAsPII').tests

    it('should produce pairs of cleartext/hash, including nested fields', () => {
      const doc = {
        password: 'hashedPassword',
        admin: { password: 'hashedAdminPassword' },
        foo: 'bar',
      }
      const passwords = {
        password: 'password',
        admin: { password: 'adminPassword' },
      }

      expect(walkDocumentPasswordFields(doc, passwords)).toEqual([
        ['password', 'hashedPassword'],
        ['adminPassword', 'hashedAdminPassword'],
      ])
    })

    it('should default missing hashed values to an empty string', () => {
      const doc = {
        password: 'hashedPassword',
        foo: 'bar',
      }
      const passwords = {
        password: 'password',
        admin: { password: 'adminPassword' },
      }

      expect(walkDocumentPasswordFields(doc, passwords)).toEqual([
        ['password', 'hashedPassword'],
        ['adminPassword', ''],
      ])
    })
  })
})

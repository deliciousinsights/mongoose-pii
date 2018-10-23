const { Cursor } = require('mongodb')
const MongoDBMemoryServer = require('mongodb-memory-server').default
const mongoose = require('mongoose')

const { checkPassword } = require('./passwords')
const { convertDataForModel } = require('./convert')
const { decipher } = require('./ciphers')
const { markFieldsAsPII } = require('../markFieldsAsPII')

describe('convert() utility', () => {
  let connection
  let pswMock
  let server

  beforeAll(async () => {
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

  beforeEach(() => {
    pswMock = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => {})
      .mockName('process.stdout.write')
  })

  afterEach(() => {
    pswMock.mockRestore()
  })

  it('should detect that the plugin was not registered', async () => {
    const Model = connection.model(
      'PluginLess',
      new mongoose.Schema({ name: String })
    )

    await expect(convertDataForModel(Model)).rejects.toThrow(
      /PluginLess’s schema did not register the markFieldsAsPII plugin/
    )
  })

  it('should short-circuit on no-document situations', async () => {
    const schema = new mongoose.Schema({ name: String, password: String })
    schema.plugin(markFieldsAsPII, { passwordFields: 'password' })
    const Model = connection.model('WithPlugin', schema)

    await expect(convertDataForModel(Model)).resolves.toEqual(0)
  })

  describe('along the way', () => {
    const DOCS = [
      { email: 'john@example.com', name: 'John', password: 'secret' },
      { email: 'mark@example.com', name: 'Mark', password: 'secret' },
      { email: 'suzy@example.com', name: 'Suzy', password: 'secret' },
    ]
    const KEY = 'I just luv mongodb-memory-server'

    it('should properly cipher documents', async () => {
      const schema = new mongoose.Schema({ name: String, email: String })
      schema.plugin(markFieldsAsPII, { fields: 'email', key: KEY })
      const Model = connection.model('Ciphered', schema)
      await Model.collection.insertMany(DOCS)

      await expect(convertDataForModel(Model)).resolves.toEqual(DOCS.length)

      for (const [
        index,
        { email },
      ] of (await Model.collection.find().toArray()).entries()) {
        // It should look like a ciphertext -- this early check avoid cryptic errors
        // on deciphering later.
        expect(email).toMatch(/^[A-Za-z0-9+/]{25,}={0,2}$/)
        // Deciphering should work
        expect(decipher(KEY, email)).toEqual(DOCS[index].email)
      }
    })

    it('should properly hash password fields', async () => {
      const schema = new mongoose.Schema({ name: String, password: String })
      schema.plugin(markFieldsAsPII, { passwordFields: 'password' })
      const Model = connection.model('Hashed', schema)
      await Model.collection.insertMany(DOCS)

      await expect(convertDataForModel(Model)).resolves.toEqual(DOCS.length)

      for (const [
        index,
        { password },
      ] of (await Model.collection.find().toArray()).entries()) {
        // It should look like a hashed Bcrypt -- this early check avoid cryptic errors
        // on checkPassword later.
        expect(password).toMatch(/^\$2a\$\d{2}\$/)
        // It should be a valid hash of the source password
        await expect(
          checkPassword(DOCS[index].password, password)
        ).resolves.toEqual(true)
      }
    })

    describe('when reporting progress', () => {
      describe('when reporting to the console because no emitter is passed', () => {
        const output = process.stderr
        let displayWidth
        let Model

        beforeAll(() => {
          const schema = new mongoose.Schema({ name: String, password: String })
          schema.plugin(markFieldsAsPII, { passwordFields: 'password' })
          Model = connection.model('Consoled', schema)
          displayWidth = output.columns
        })

        afterAll(() => {
          output.columns = displayWidth
        })

        beforeEach(async () => {
          await Model.collection.deleteMany({})
          await Model.collection.insertMany(DOCS)
        })

        it('should use a maximum of 100 chars on wider displays', async () => {
          output.columns = 160

          await convertDataForModel(Model)
          expect(pswMock.mock.calls).toEqual([
            ['\n['],
            ['='.repeat(32)],
            ['='.repeat(33)],
            ['='.repeat(33)],
            [']\n'],
          ])
        })

        it('should ensure it doesn’t write too much on narrow displays', async () => {
          output.columns = 4

          await convertDataForModel(Model)
          expect(pswMock.mock.calls).toEqual([['\n['], ['='], ['='], [']\n']])
        })

        it('should default to 80 chars when display width is unknown', async () => {
          output.columns = undefined

          await convertDataForModel(Model)
          expect(pswMock.mock.calls).toEqual([
            ['\n['],
            ['='.repeat(26)],
            ['='.repeat(25)],
            ['='.repeat(27)],
            [']\n'],
          ])
        })
      })

      describe('when reporting as events because an emitter is passed', () => {
        let Model

        beforeAll(() => {
          const schema = new mongoose.Schema({ name: String, password: String })
          schema.plugin(markFieldsAsPII, { passwordFields: 'password' })
          Model = connection.model('Emitted', schema)
        })

        beforeEach(async () => {
          await Model.collection.deleteMany({})
        })

        it('should emit both events on every doc for small-enough datasets', async () => {
          await Model.collection.insertMany(DOCS)
          const emitter = { emit: jest.fn().mockName('emit') }

          await convertDataForModel(Model, emitter)
          expect(emitter.emit.mock.calls).toEqual([
            ['docs', 1],
            ['progress', 33],
            ['docs', 2],
            ['progress', 66],
            ['docs', 3],
            ['progress', 100],
          ])
        })

        it('should only emit progress events when the percentage changes', async () => {
          const dataset = new Array(110).fill(null).map((_, index) => ({
            email: `john${index}@example.com`,
            name: `John ${index}`,
            password: 'secret',
          }))
          await Model.collection.insertMany(dataset)
          const emitter = { emit: jest.fn().mockName('emit') }

          await convertDataForModel(Model, emitter)
          const calls = emitter.emit.mock.calls

          // One doc call per document, with its one-based converted index
          const docCalls = calls.filter(([kind]) => kind === 'docs')
          expect(docCalls).toEqual(
            dataset.map((_, index) => ['docs', index + 1])
          )

          // One progress call per percentage change, with values from 1 to 100
          const progressCalls = calls.filter(([kind]) => kind === 'progress')
          expect(progressCalls).toEqual(
            dataset.slice(0, 100).map((_, index) => ['progress', index + 1])
          )
        })
      })
    })
  })

  it('should report errors, if any', async () => {
    const schema = new mongoose.Schema({ name: String, password: String })
    schema.plugin(markFieldsAsPII, { passwordFields: 'password' })
    const Model = connection.model('Erroneous', schema)
    await Model.collection.insertOne({ name: 'John', password: 'secret' })

    const oldNext = Cursor.prototype.next

    try {
      // When an error come up, throw it!
      Cursor.prototype.next = jest
        .fn(() => Promise.reject(new Error('Oops')))
        .mockName('next')
      await expect(convertDataForModel(Model)).rejects.toThrow('Oops')
    } finally {
      Cursor.prototype.next = oldNext
    }

    await expect(convertDataForModel(Model)).resolves.toEqual(1)
  })
})

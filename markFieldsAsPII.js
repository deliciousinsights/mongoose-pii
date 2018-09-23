const { cipher, decipher } = require('./util/ciphers')

const settings = new WeakMap()

const QUERY_METHODS = [
  'count',
  'countDocuments',
  // Mongoose has no deleteMany / insertMany hooks?!
  'estimatedDocumentCount',
  'find',
  'findOne',
  'findOneAndDelete',
  'findOneAndRemove',
  'findOneAndUpdate',
  'replaceOne',
  'update',
  'updateOne',
  'updateMany',
]

function markFieldsAsPII(schema, { fields, key } = {}) {
  if (typeof fields === 'string') {
    fields = fields.trim().split(/\s+/)
  }
  fields = [...new Set(fields || [])].sort()

  if (fields.length === 0) {
    throw new Error('Missing required `fields` option for markFieldsAsPII')
  }

  if (!key) {
    throw new Error('Missing required `key` option for markFieldsAsPII')
  }

  settings[schema] = { fields, key }

  schema.pre('insertMany', cipherDocumentFields)
  schema.pre('save', cipherDocumentFields)
  schema.post('insertMany', decipherDocumentFields)
  schema.post('save', decipherDocumentFields)
  schema.post('init', decipherDocumentFields)

  for (const method of QUERY_METHODS) {
    schema.pre(method, cipherQueryFields)
  }
}

function cipherDocumentFields(next, docs) {
  const { fields, key } = settings[this.schema] || {}
  if (!fields) {
    return next()
  }

  // If `this` is a Model, we're on `Model.insertMany` and `docs` is an Array.
  // Otherwise we're on `Document#save/Model.create`, `docs` is missing and
  // `this` is a Document.
  if (!Array.isArray(docs)) {
    docs = [this]
  }
  if (docs.length === 0) {
    return
  }

  // Just in case we have the same original descriptor object
  // multiple times: only cipher once per instance!
  docs = [...new Set(docs)]

  processDocs(docs, { fields, key, mode: 'cipher' })
  next()
}

function cipherQueryFields(next) {
  // this is the Query -- we're on finder methods
  const { fields, key } = settings[this.schema] || {}
  if (!fields) {
    return next()
  }

  const query = this.getQuery()
  cipherObject(query, { fields, key })

  const update = this.getUpdate()
  if (update) {
    cipherObject(update, { fields, key })
  }

  next()
}

function cipherObject(obj, { fields, key, prefix = null }) {
  for (const objKey of Object.keys(obj)) {
    const fieldName =
      objKey[0] === '$' ? prefix : prefix ? `${prefix}.${objKey}` : objKey
    const value = obj[objKey]
    if (typeof value === 'object') {
      // Dive into objects/arrays
      cipherObject(value, { fields, key, prefix: fieldName })
    } else if (value != null) {
      const fieldMatches =
        fields.includes(fieldName) ||
        fields.includes(objKey) ||
        (Array.isArray(obj) && fields.includes(prefix))
      if (fieldMatches) {
        obj[objKey] = cipherValue(key, value)
      }
    }
  }
}

function cipherValue(key, value) {
  if (!(value instanceof Buffer)) {
    value = String(value)
  }
  return cipher(key, value, { deriveIV: true })
}

function decipherDocumentFields(docs) {
  // If `this` is a Model, we're on `Model.insertMany` and `docs` is an Array.
  // Otherwise we're on `Document#save/Model.create`, `docs` is a single
  // Document and is `this` as well.
  const { fields, key } = settings[this.schema] || {}
  if (!fields) {
    return next()
  }

  if (!Array.isArray(docs)) {
    docs = [docs]
  }

  processDocs(docs, { fields, key, mode: 'decipher' })
}

function processDocs(docs, { fields, key, mode }) {
  for (const doc of docs) {
    // FIXME: WE NEED TO HANDLE NESTED FIELDS AND ARRAY VALUES
    for (const field of fields) {
      const value = doc[field]
      if (value != null) {
        if (mode === 'cipher') {
          doc[field] = cipherValue(key, value)
        } else {
          doc[field] = decipher(key, value)
        }
      }
    }
  }
}

module.exports = {
  tests: { cipherObject, cipherValue },
  markFieldsAsPII,
}

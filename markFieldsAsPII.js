const { cipher, decipher } = require('./util/ciphers')

const settings = new WeakMap()

const QUERY_METHODS = [
  'count',
  'countDocuments',
  // Mongoose has no deleteMany hooks?!
  // estimatedDocumentCount does not accept a filter, so no need…
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

// 1. Hook functions
// -----------------

// Ciphers document fields pre-insert and pre-save, so they're stored
// ciphered in the database.
function cipherDocumentFields(next, docs) {
  const { fields, key } = settings[this.schema] || {}
  if (!fields) {
    return next()
  }

  // If we're on `Model.insertMany`, `this` is a Model and `docs` is an Array.
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

// Ciphers query, and possibly update, fields for any
// finder/updater/replacer/counter method that does provide
// a hook (not all of them so far, check out `QUERY_METHODS`
// further above).
//
// Ciphering the query ensures we do a proper match on what is
// actually stored in the database.  This is mostly useful for
// equality/inclusion operations, but loses meaning for matching,
// starting/ending and other partial ops.
//
// Ciphering the update ensures that updated/replaced data is
// indeed stored ciphered in the database, like we did
// at first save through the `cipherDocumentFields` hook above.
function cipherQueryFields(next) {
  // this is the Query -- we're on finder methods
  const { fields, key } = settings[this.schema] || {}
  if (!fields) {
    return next()
  }

  const query = this.getQuery()
  processObject(query, { fields, key, mode: 'cipher' })

  const update = this.getUpdate()
  if (update) {
    processObject(update, { fields, key, mode: 'cipher' })
  }

  next()
}

// This third and final hook deciphers document fields post-load,
// so we get cleartext data for fetched documents (through the *post* `init`
// hook), and also for just-created documents that were ciphered pre-save
// (through `save` and `insertMany` *post* hooks).
function decipherDocumentFields(docs) {
  // If we're on `Model.insertMany`, `this` is a Model and `docs` is an Array.
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

// Internal helper functions
// -------------------------

// Ciphers a value in a consistent way (same cipher for the same value, which is
// critical for enabling query ciphering).
//
// Buffers are left as-is, but anything other that is not a String is turned into
// one (numbers, dates, regexes, etc.) as underlying crypto ciphering mandates
// either a Buffer or a String.  Note that deciphering will not restore the original
// data type, but always yield a String; still, it is anticipated that non-String
// values are less likely to be PII, as most sensitive information is usually strings
// or “patterned numbers” (SSN, CC#, etc.) stored as strings.
function cipherValue(key, value) {
  if (!(value instanceof Buffer)) {
    value = String(value)
  }
  return cipher(key, value, { deriveIV: true })
}

// A quick helper to iterate over a series of documents for (de)ciphering.
// All options are forwarded to `processObject`, the actual workhorse.
function processDocs(docs, { fields, key, mode }) {
  for (const doc of docs) {
    processObject(doc, { fields, key, mode, isDocument: true })
  }
}

// This is **the core function** for this entire plugin.  It is used to cipher
// and decipher, both queries/updates objects and actual documents (that are not
// to be traversed in the same way).
//
// Due to Mongoose plugin limitations, this has to **modify the object in-place**,
// which isn't ideal and yields several caveats, but can't be worked around.
// Therefore this doesn't return anything, it just mutates its `obj` argument.
//
// @param  obj (Object) The object or document to be processed.
// @option fields (Array) The list of field paths provided to the plugin.
// @option key (String|Buffer) The ciphering key.
// @option isDocument (Boolean) Whether to traverse `obj` as a query/update object
//                    (false) or as a Document (true).
// @option mode ('cipher'|'decipher') Whether to cipher or decipher values.
// @option prefix (String|null) A path prefix for the current level of recursive
//                object traversal.  Top-level calls have it `null`, deeper levels
//                use the caller’s current path context.
function processObject(
  obj,
  { fields, key, isDocument = false, mode, prefix = null }
) {
  // Define what object keys to iterate over, depending on whether we’re
  // processing a Document or query/update object.
  const keyList = produceKeyList(obj, { fields, isDocument, prefix })

  for (const objKey of keyList) {
    // Compute the current field path. Operators (that start with '$')
    // do not augment the path.
    const fieldPath =
      objKey[0] === '$' ? prefix : prefix ? `${prefix}.${objKey}` : objKey
    const value = obj[objKey]
    if (typeof value === 'object') {
      // Dive into objects/arrays, recursively.
      processObject(value, { fields, key, isDocument, mode, prefix: fieldPath })
    } else if (value != null) {
      // Null/undefined values need no processing, for the others, let's see
      // if the current field matches our path list.  "Relative" paths
      // (simple field names) can be matched regardless of depth, hence the
      // two first condition elements.  Paths that result in arrays mean all
      // items in the array are to be processed.
      const parentFieldName = (prefix || '').split('.').slice(-1)[0]
      const fieldMatches =
        fields.includes(fieldPath) ||
        fields.includes(objKey) ||
        (Array.isArray(obj) &&
          (fields.includes(prefix) || fields.includes(parentFieldName)))

      if (fieldMatches) {
        if (mode === 'decipher') {
          obj[objKey] = decipher(key, value)
        } else {
          obj[objKey] = cipherValue(key, value)
        }
      }
    }
  }
}

// Produces a relevant object key list to be traversed for an object,
// depending on whether we regard it as a Document or a query/update descriptor.
//
// - Documents should only have their current-level fields inspected, as it
//   is likely that `Object.keys()` would return waaaay too many technical
//   Mongoose fields on them, and not the synthetic document property accessors,
//   that are not enumerable.
// - Query/Update object descriptors should be traversed by inspecting all their
//   keys, conversely.
function produceKeyList(obj, { fields, isDocument, prefix }) {
  if (!isDocument) {
    return Object.keys(obj)
  }

  // Document mode:
  // 1. Filter field paths based on the current prefix, if any
  const baseList = prefix
    ? fields.filter((path) => path === prefix || path.startsWith(prefix + '.'))
    : fields
  // 2. Strip prefix and deeper path levels to retain only current-level fields
  const prefixRegex = prefix
    ? new RegExp('^' + escapeRegexp(prefix) + '.?')
    : ''
  const currentLevelFields = baseList
    .map((path) => path.replace(prefixRegex, '').split('.')[0])
    .filter(Boolean)

  // 3. If there are no current-level fields and we're on an Array, this
  // means all the array items need processing, so `Object.keys()` is fine.
  if (currentLevelFields.length === 0 && Array.isArray(obj)) {
    return Object.keys(obj)
  }

  // 4. Otherwise, ensure uniqueness to avoid double processing
  return [...new Set(currentLevelFields)]
}

function escapeRegexp(text) {
  return text.replace(/[\](){}.?+*]/g, '\\$&')
}

module.exports = {
  tests: { cipherValue, processObject },
  markFieldsAsPII,
}

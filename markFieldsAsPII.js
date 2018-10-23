const { cipher, decipher } = require('./util/ciphers')
const { checkPassword, hashPassword } = require('./util/passwords')

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

function markFieldsAsPII(schema, { fields, key, passwordFields } = {}) {
  fields = normalizeFieldList('fields', fields)
  passwordFields = normalizeFieldList('passwordFields', passwordFields)

  if (fields.length === 0 && passwordFields.length === 0) {
    throw new Error(
      'Using markFieldsAsPII assumes at least one of `fields` or `passwordFields`'
    )
  }

  if (fields.length > 0 && !key) {
    throw new Error(
      'Missing required `key` option for ciphering `fields` in markFieldsAsPII'
    )
  }

  settings.set(schema, { fields, key, passwordFields })

  if (fields.length > 0) {
    schema.pre('insertMany', cipherDocumentFields)
    schema.pre('save', cipherDocumentFields)
    schema.post('insertMany', decipherDocumentFields)
    schema.post('save', decipherDocumentFields)
    schema.post('init', decipherDocumentFields)

    for (const method of QUERY_METHODS) {
      schema.pre(method, cipherQueryFields)
    }
  }

  if (passwordFields.length > 0) {
    schema.pre('insertMany', hashDocumentPasswords)
    schema.pre('save', hashDocumentPasswords)
    schema.statics.authenticate = authenticate
  }
}

// 1. Hook functions
// -----------------

// Ciphers document fields pre-insert and pre-save, so they're stored
// ciphered in the database.
function cipherDocumentFields(next, docs) {
  const { fields, key } = settings.get(this.schema)

  // If we're on `Model.insertMany`, `this` is a Model and `docs` is an Array.
  // Otherwise we're on `Document#save/Model.create`, `docs` is missing and
  // `this` is a Document.
  if (!Array.isArray(docs)) {
    docs = [this]
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
  const { fields, key } = settings.get(this.schema)

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
  const { fields, key } = settings.get(this.schema)

  if (!Array.isArray(docs)) {
    docs = [docs]
  }

  processDocs(docs, { fields, key, mode: 'decipher' })
}

// Hashes document password fields pre-insert and pre-save,
// so they're stored hashed in the database.
function hashDocumentPasswords(next, docs) {
  const { passwordFields } = settings.get(this.schema)

  // If we're on `Model.insertMany`, `this` is a Model and `docs` is an Array.
  // Otherwise we're on `Document#save/Model.create`, `docs` is missing and
  // `this` is a Document.
  if (!Array.isArray(docs)) {
    docs = [this]
  }

  // Just in case we have the same original descriptor object
  // multiple times: only cipher once per instance!
  docs = [...new Set(docs)]

  processDocs(docs, { fields: passwordFields, mode: 'hash' })
  next()
}

// Schema static methods
// ---------------------

// A static method added to schemas that define password fields.
// Returns documents that match the query fields (that are not
// password fields) and check out on *all* provided password
// fields.  It is expected that password field values be passed
// as clear text; there will usually be just one password field,
// and often just one query field (e-mail or other identifier),
// but this allows any number of both query and password fields
// for matching.
//
// @param `fields` a single descriptor that can mix query fields
//        (that will be ciphered if necessary) and password
//        fields (that will be securely compared).
// @option `single` if true (default), the method will either
//         return the first matching document, or `null`. If
//         false, it will always return an array of matching
//         documents, potentially empty.
async function authenticate(fields, { single = true } = {}) {
  const { passwordFields } = settings.get(this.schema)

  const { query, passwords } = splitAuthenticationFields({
    fields,
    passwordFields,
  })

  const result = []
  for (const doc of await this.find(query)) {
    const passwordPairs = walkDocumentPasswordFields(doc, passwords)
    const allPasswordsChecks = await Promise.all(
      passwordPairs.map(([clearText, hashed]) =>
        checkPassword(clearText, hashed)
      )
    )
    if (allPasswordsChecks.every((match) => match)) {
      if (single) {
        return doc
      }

      result.push(doc)
    }
  }

  return single ? null : result
}

// An internal-use, exported function that our convert utility
// can use to ensure this plugin was registered on a given model or schema.
function pluginWasUsedOn(modelOrSchema) {
  const schema = modelOrSchema.schema || modelOrSchema
  return settings.has(schema)
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

// Tiny internal helper to escape a text to be inserted in a regexp.
function escapeRegexp(text) {
  return text.replace(/[\](){}.?+*]/g, '\\$&')
}

const REGEX_BCRYPT_HASH = /^\$2a\$\d{2}\$[\w./]{53}$/

// Hashes a password value… unless it's a hash already!
function hashValue(value) {
  return REGEX_BCRYPT_HASH.test(value)
    ? value
    : hashPassword(value, { sync: true })
}

// Simple field-list option normalization.  This way fields can be passed as
// a whitespace- or comma-separated string, or as an Array.
function normalizeFieldList(name, value) {
  if (typeof value === 'string') {
    value = value.trim().split(/[\s,]+/)
  }
  value = [...new Set(value || [])].sort()

  return value
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
// @option mode ('cipher'|'decipher'|'hash') Whether to cipher, decipher or hash values.
// @option prefix (String|null) A path prefix for the current level of recursive
//                object traversal.  Top-level calls have it `null`, deeper levels
//                use the caller’s current path context.
function processObject(
  obj,
  { fields, key, isDocument = false, mode, prefix = null }
) {
  if (mode !== 'cipher' && mode !== 'decipher' && mode !== 'hash') {
    throw new Error(`Unknown processObject mode: ${mode}`)
  }

  // Define what object keys to iterate over, depending on whether we’re
  // processing a Document or query/update object.
  const keyList = produceKeyList(obj, { fields, isDocument, prefix })

  for (const objKey of keyList) {
    // Compute the current field path. Operators (that start with '$')
    // do not augment the path.
    const fieldPath =
      objKey[0] === '$' ? prefix : prefix ? `${prefix}.${objKey}` : objKey
    const value = obj[objKey]
    if (typeof value === 'object' && value != null) {
      // Dive into objects/arrays, recursively.
      processObject(value, { fields, key, isDocument, mode, prefix: fieldPath })
    } else if (value != null) {
      // Null/undefined values need no processing, for the others, let's process
      processValue(obj, { fieldPath, fields, key, mode, objKey, prefix })
    }
  }
}

// Just a split of a second-level nontrivial processing in `processObject`,
// to keep it reasonably simple cognitively.
//
// Let’s see if the current field matches our path list.  "Relative" paths
// (simple field names) can be matched regardless of depth, hence the
// two first condition elements.  Paths that result in arrays mean all
// items in the array are to be processed.
//
// @see `processObject()`
function processValue(obj, { fieldPath, fields, key, mode, objKey, prefix }) {
  const value = obj[objKey]
  const parentFieldName = (prefix || '').split('.').slice(-1)[0]
  const fieldMatches =
    fields.includes(fieldPath) ||
    fields.includes(objKey) ||
    (Array.isArray(obj) &&
      (fields.includes(prefix) || fields.includes(parentFieldName)))

  if (!fieldMatches) {
    return
  }

  if (mode === 'decipher') {
    obj[objKey] = decipher(key, value)
  } else if (mode === 'cipher') {
    obj[objKey] = cipherValue(key, value)
  } else {
    // Has to be `hash`, invalid modes filtered at `processObject()` level
    obj[objKey] = hashValue(value)
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

// Partitions a single descriptor `fields` into a query on the one hand
// (fields that do not match `passwordFields` paths) and passwords on the
// other hands (fields that do match). We need this in `authenticate()` in
// order to first filter by query, then build a list of secure password
// comparisons on the resulting docs, as hashes are intentionally unstable
// (they vary from one hash to the other for the same cleartext), so we
// can't just query on a hash we'd get this time around.
//
// @see `authenticate()`
function splitAuthenticationFields({
  fields,
  passwordFields,
  query = {},
  passwords = {},
  prefix = null,
}) {
  for (const [field, value] of Object.entries(fields)) {
    if (typeof value === 'object' && value != null) {
      prefix = prefix ? `${prefix}.${field}` : field
      splitAuthenticationFields({
        fields: value,
        passwordFields,
        query,
        passwords,
        prefix,
      })
    } else {
      const fieldPath = prefix ? `${prefix}.${field}` : field
      const recipient = passwordFields.includes(fieldPath) ? passwords : query
      updateObject(recipient, fieldPath, value)
    }
  }

  if (prefix == null && Object.keys(passwords).length === 0) {
    const candidates = [...passwordFields].sort().join(', ')
    throw new Error(
      `No password field (${candidates}) found in \`authenticate\` call`
    )
  }

  return { query, passwords }
}

// Updates a recipient object `obj` so the field at path `path` (which
// potentially describes a nested field using dot separators) exists in
// it with value `value`.  Missing intermediary object properties are
// created on-the-fly.  Used to populate query/password field descriptors
// in `splitAuthenticationFields()` above.
//
// @see `splitAuthenticationFields()`.
function updateObject(obj, path, value) {
  const segments = path.split('.')
  let node
  while ((node = segments.shift())) {
    obj[node] = segments.length > 0 ? obj[node] || {} : value
    obj = obj[node]
  }
}

// Produces a list of cleartext/hashed password value pairs, so a promise list
// of secure comparisons can be done based on it.  This recursively walks the
// potentially-nested password field/cleartext descriptor (`passwords`), matching
// the traversal on document fields.  If the document misses some of the relevant
// fields, it will yield empty-string hashes for these, ensuring comparison failure.
//
// @see `authenticate()`.
function walkDocumentPasswordFields(doc = {}, passwords, result = []) {
  for (const [field, value] of Object.entries(passwords)) {
    if (typeof value === 'object' && value != null) {
      walkDocumentPasswordFields(doc[field], value, result)
    } else {
      result.push([value, doc[field] || ''])
    }
  }
  return result
}

module.exports = {
  tests: {
    cipherValue,
    processObject,
    splitAuthenticationFields,
    updateObject,
    walkDocumentPasswordFields,
  },
  markFieldsAsPII,
  pluginWasUsedOn,
}

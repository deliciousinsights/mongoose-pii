# Mongoose PII Plugin

[![npm version](https://badge.fury.io/js/mongoose-pii.svg)](https://npmjs.com/package/mongoose-pii)
[![MIT license](https://img.shields.io/github/license/deliciousinsights/mongoose-pii.svg)](https://en.wikipedia.org/wiki/MIT_License)
[![Travis build](https://img.shields.io/travis/deliciousinsights/mongoose-pii.svg)](https://travis-ci.org/deliciousinsights/mongoose-pii)
[![CodeCov Code Coverage score](https://img.shields.io/codecov/c/github/deliciousinsights/mongoose-pii.svg)](https://codecov.io/gh/deliciousinsights/mongoose-pii)
<!-- [![CodeClimate Code Coverage score](https://img.shields.io/codeclimate/coverage/deliciousinsights/mongoose-pii.svg)](https://codeclimate.com/github/deliciousinsights/mongoose-pii) -->

![Dependencies freshness](https://img.shields.io/david/deliciousinsights/mongoose-pii.svg)
[![Greenkeeper badge](https://badges.greenkeeper.io/deliciousinsights/mongoose-pii.svg)](https://greenkeeper.io/)

[![CodeClimate maintainability score](https://img.shields.io/codeclimate/maintainability/deliciousinsights/mongoose-pii.svg)](https://codeclimate.com/github/deliciousinsights/mongoose-pii)
[![Coding style is StandardJS-based](https://img.shields.io/badge/style-standard-brightgreen.svg)](https://standardjs.com/)
[![Code of Conduct is Contributor Covenant](https://img.shields.io/badge/code%20of%20conduct-contributor%20covenant-brightgreen.svg)](http://contributor-covenant.org/version/1/4/)

## TL;DR

Store your data like your MongoDB database is getting stolen tomorrow, without sacrificing Mongoose comfort.

## The slightly longer intro

Best practices for data storage dictate that:

1. **Passwords should be securely hashed**; the typical state of the art right now being BCrypt with a securely-random IV and 10+ rounds (e.g. 2<sup>10</sup>+ iterations) in production.
2. **PII should be securely ciphered**; typically we'd use AES256.

These help avoid access to cleartext passwords and compromission of PII (_Personally Identifiable Information_, such as e-mails, names, Social Security Numbers, Driver’s License information, Passport numbers…) by database theft or unauthorized direct access.

This is all good, but we want to retain the comfort of authenticating, in our code, with cleartext password values that were typed in a form or sent in the API call; we also want to be able to query based on PII fields using cleartext values, or to update them with cleartext values.

In short, we want secure storage without having to worry about it.

This plugin does exactly that.

## In this document

1. [Installing](#installing)
2. [API](#api)
3. [Caveats](#caveats)
4. [Contributing](#contributing)
5. [License and copyright](#license-and-copyright)

## Installing

If you’re using npm:

```bash
npm install mongoose-pii
# or npm install --save mongoose-pii if you're running npm < 5.x
```

With yarn:

```bash
yarn add mongoose-pii
```

## Quick start

### First, prep your schemas

For every schema that has PII, passwords, or both:

1. open the file that define your schema
2. Require the plugin
3. Register it as a schema plugin, providing relevant field lists and, for ciphering PII, the ciphering key.

Here’s what it could look like:

```js
// 2. Require the plugin
const { markFieldsAsPII } = require('mongoose-pii')

const userSchema = new Schema({
  address: String,
  email: { type: String, required: true, index: true },
  firstName: String,
  lastName: String,
  password: { type: String, required: true },
  role: String,
})

// 3. Register the plugin
userSchema.plugin(markFieldsAsPII, {
  fields: ['address', 'email', 'firstName', 'lastName'],
  key: process.env.MONGOOSE_PII_KEY,
  passwordFields: 'password',
})

const User = mongoose.model('User', userSchema)
```

That’s it! Now…

- **Your PII fields will be automatically ciphered at save and deciphered at load** (so in-memory, they’re cleartext), and you can use cleartext values for queries and updates on them.
- **Your PII fields will be automatically ciphered in query arguments** for finders (e.g. `findOne()`) and updaters (e.g. `updateMany()`, `findOneAndUpdate()`).
- **Your password fields will be automatically hashed** in a secure manner at save. This is a one-way hash, so you’ll never have access to the cleartext again, which is as it should be. To authenticate, use the plugin-provided `authenticate()` static method:

```js
const user = await User.authenticate({
  email: 'foo@bar.com',
  password: 'secret',
})
```

In its default mode, this resolves to either `null`, or the first matching `User` document.

### Second, convert your existing data

You’re likely to have a ton of existing, unprotected data in your collections already.  However, the moment you register the plugin with your Mongoose schemas, loading data starts to break down because it expected hashed passwords for authentication and ciphered PII in the database!

It would be way too detrimental to loading performance to check for the ciphered state of data in the raw loaded document (not to mention heuristics are not universal there), so instead, we provide a helper API for you to convert your existing collections once you registered the plugin with the proper options.

See the `convertDataForModel()` API below for details.

### Check out our examples!

Find more usage examples in the [`examples`](https://github.com/deliciousinsights/mongoose-pii/tree/master/examples) directory.

----

## API

Click on the API names (or press Return when they have focus) to toggle API documentation for them.

<details>
  <summary>markFieldsAsPII</summary>

### `markFieldsAsPII` (the plugin itself)

This is the core plugin, that you register with any schema you need it for through Mongoose’s `schema.plugin()` API.

If you want PII ciphering, you’ll need to pass the `fields` and `key` options. If you want password hashing, you’ll need to pass the `passwordsFields` option. You can mix both, naturally.

Passing no option is an invalid use and will trigger the appropriate exception.

**Options**

| Name             | Default | Description                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fields`         | `[]`    | A list of PII fields to be ciphered. Can be provided either as an array of field names, or as a `String` listing fields separated by commas and/or whitespace, depending on your personal style and convenience.                                                                                                                                                                                                                                      |
| `key`            | none    | **Required for PII ciphering**. This is either a `String` or a `Buffer` that contains the ciphering key. The value should **never be stored in code**, especially it should **not be versioned**, and is expected to come from an environment variable.  Because we’re using AES-256 for ciphering, **the key needs to be 32-byte long**, hence a 32-character `String` (regardless of its contents, hex or otherwise), or a `Buffer` with 32 bytes. |
| `passwordFields` | `[]`    | **Required for password hashing**. A list of password fields to hash; 99% of the time we expect this to just be `'password'` or some such (that is, single-field).  The format is identical to `fields`.                                                                                                                                                                                                                                              |

**Example calls**

These all assume a required plugin and a Mongoose Schema stored as `schema`, something like:

```js
const { markFieldsAsPII } = require('mongoose-pii')
const { Schema } = require('mongoose')

const schema = new Schema({
  // …
})
```

Based on this, let’s start with PII only:

```js
schema.plugin(markFieldsAsPII, {
  fields: ['address', 'city', 'email', 'ssn', 'lastName'],
  key: process.env.MONGOOSE_PII_KEY,
})
```

Password hashing only, using the `String` form for field lists:

```js
schema.plugin(markFieldsAsPII, { passwordFields: 'password' })
```

Mixed use, using only `String` forms:

```js
schema.plugin(markFieldsAsPII, {
  fields: 'address city email ssn lastName',
  key: process.env.MONGOOSE_PII_KEY,
  passwordFields: 'password',
})
```
</details>

<details>
  <summary>authenticate(query[, options])</summary>

### `authenticate(query[, options])`

> **Important note about password hashing:** When you use password hashing, authenticating cannot be done at the MongoDB query level, because password hashes are intentionally unstable: hashing the same clear-text password multiple times will yield different values every time.
>
> Unlike PII ciphering, that we made intentionally stable, allowing for query-based filtering, we thus need to grab all documents matching the parts of `query` that do not relate to password fields, then check each matching document for password fields match using secure (fixed-time) Bcrypt-aware comparison methods.

In order to make the API as unobtrusive as possible, we require a single query field; the plugin will distinguish between parts of the query that match your `passwordFields` settings, and the remainder, that will be used as a regular query (possibly ciphered for PII fields it may contain).

**Beware: this method is asynchronous** and returns a Promise.  You can use a `.then()` chain or, better yet, make the call site an `async` function if it isn’t yet, and use a simple `await` on the call.  Asynchrony is a given considering this does a database fetch, anyway, but password checking is asynchronous too, FWIW.

**Options**

|Name|Default|Description|
|-|-|-|
|`single`|`true`|Whether to return a single Document (or `null` if none is found), or *all matching documents* (with an empty Array if none is found). Defaults to single-document mode, which is expected to be the vast majority of use cases, and makes for convenient truthiness of the result value.|

**Example call**

Say `User` is a Mongoose model built based on a schema with a `password` hashed field:

```js
async function logIn(req, res) {
  try {
    const { email, password } = req.body
    const user = await User.authenticate({ email, password })
    if (!user) {
      req.flash('warning', 'No user matches these credentials')
      res.render('sessions/new')
      return
    }

    req.logIn(user)
    req.flash('success', `Welcome back, ${user.firstName}!`)
    res.redirect(paths.userDashboard)
  } catch (err) {
    req.flash('error', `Authentication failed: ${err.message}`)
    res.redirect(paths.logIn)
  }
}
```
</details>

### Helper functions

These functions are used internally by the plugin but we thought you’d like to have them around. They’re accessible as named exports from the module, just like the plugin.

<details>
  <summary>checkPassword(clearText, hashed)</summary>

### `checkPassword(clearText, hashed)`

Asynchronously checks that a given cleartext matches the provided hash.  This is asynchronous because depending on the amount of rounds used for the hash, computing a matching hash from cleartext could take nontrivial time and should therefore be nonblocking.

This returns a Promise that resolves to a Boolean, indicating whether there is a match or not.

**Example call**

```js
if (await checkPassword('secret', user.password)) {
  req.flash('warning', 'Your password is a disgrace to privacy')
}
```

</details>

<details>
  <summary>cipher(key, clearText[, options])</summary>

### `cipher(key, clearText[, options])`

Ciphers a clear-text value using the AES-256-CBC algorithm, with the provided key.  By default, ciphering will derive its IV (*Initialization Vector*) from the cleartext, ensuring stable ciphers, thereby opening the way for query-level ciphered field filtering.

Both `key` and `clearText` can be either a `String` or `Buffer`.

This returns the ciphered value as a Base64-encoded `String`, that includes the IV used. Base64 was preferred over hex-encoding as it is 33% more compact, resulting in less data storage requirements.

Because we expect only short values to be ciphered (PII data are usually small bits of discrete information, such as address lines, names, e-mails or identification numbers), and because AES-256 remains a pretty fast algorithm, this function remains synchronous.

**Options**

|Name|Default|Description|
|-|-|-|
|`deriveIV`|`true`|Whether to produce stable ciphers for a given clear-text value (by deriving the IV off it in a secure way), or to use random IVs, which are slightly more secure but prevent querying ciphered fields. Defaults to stable ciphers.|

**Example call**

```js
const key = 'I say: kickass keys rule supreme'
cipher(key, 'I wish all APIs were this nice')
// => 'urWDOjnc6EeMv3ASdrerGAn9YIZw3gjO7lve2EzBQ7Qz7uq4b8UsEBRsOCUPfHitA='
```
</details>

<details>
  <summary>decipher(key, cipherText)</summary>

### `decipher(key, cipherText)`

Deciphers a ciphered value using the AES-256-CBC algorithm, with the provided
key.  The ciphered text is assumed to have been ciphered with the sister `cipher()` function, hence to contain the IV.

Both `key` and `cipherText` can be either a `String` or `Buffer`.

This returns the clear-text value, unless the ciphered text is invalid, which results in an exception being thrown.

Because we expect only short values to be ciphered (PII data are usually small bits of discrete information, such as address lines, names, e-mails or identification numbers), and because AES-256 remains a pretty fast algorithm, this function remains synchronous.

**Example call**

```js
const key = 'I say: kickass keys rule supreme'
decipher(key, 'urWDOjnc6EeMv3ASdrerGAn9YIZw3gjO7lve2EzBQ7Qz7uq4b8UsEBRsOCUPfHitA=')
// => 'I wish all APIs were this nice'
decipher(key, 'ZdZK5sk5P6BGfQJX9qqvFgBUFhR/OXZtv27LaPeCk7kuGrglgq2BS+jSZU1H34GJs=')
// => 'I wish all APIs were this nice' -- this used a non-derived IV
```
</details>

<details>
  <summary>hashPassword(clearText[, options])</summary>

### `hashPassword(clearText[, options])`

Hashes a clear-text password using Bcrypt, with an amount of rounds depending on the current environment (production or otherwise).

> Note: Bcrypt has a rather low (72 bytes) limit on the size of the input it can hash, so this function transparently handles longer inputs for you by turning them into their SHA512 hashes (to preserve entropy as best it can) and using the resulting value as input internally.

Depending on the `sync` option, synchronously returns the hashed value, or returns a Promise resolving to it, to accomodate all use-cases.

**Options**

|Name|Default|Description|
|-|-|-|
|`rounds`|2 or 10|How many Bcrypt rounds (powers of 2 for iteration, so 10 rounds is actually 2<sup>10</sup> iterations) to use for hashing.  We use recommended defaults for production (10) or test/development (2).  Still, you can customize it by passing the option.|
|`sync`|`false`|Whether to synchronously or asynchronously do the hashing. Synchronous returns the hash, asynchronous returns a Promise resolving to the hash. Defaults to asynchronous.|

**Example calls**

Asynchronously, here in the context of caller code that remains old-school Node callback-based:

```js
async function demo(newPass, cb) {
  try {
    cb(null, await hashPassword(newPass))
  } catch (err) {
    cb(err)
  }
}
```

Synchronously, in the same context as above, but blocking instead of nonblocking:

```js
function demo(newPass, cb) {
  try {
    cb(null, hashPassword(newPass, { sync: true }))
  } catch(err) {
    cb(err)
  }
}
```
</details>

### Data migration utility

<details>
  <summary>convertDataForModel(Model[, emitter])</summary>

### `convertDataForModel(Model[, emitter])`

In order to facilitate the initial migration of your collections’ raw data, we provide a helper API for you to convert your existing collections once you registered the plugin with the proper options.

Here’s how to go about it, for a given schema:

1. Register the plugin, with all relevant options, on the schema
2. Write a small script that will establish the underlying connection (if your code doesn't do that automatically on model loading, for instance).

This returns a promise, so if you’re into `async` / `await` (and you should!), go right ahead.

As this is likely to be run just once in the terminal, it outputs by default, on `process.stderr`, a simple progress bar (that tops at 100 chars wide but can be narrower if your terminal mandates it).

If you prefer to control the output, you can pass your own event emitter, as shown in the second example below.

**Example uses**

Interactively in the terminal, with a dynamic progress bar:

```js
const YourModel = require('./path-to-your-model')
const { convertDataForModel } = require('mongoose-pii/convert')

convertDataForModel(YourModel)
  .then((convertedCount) => console.log(`Converted ${convertedCount} documents`))
  .catch((error) => console.error('Failed during the conversion:', error))
```

Using our own custom event emitter for reporting:

```js
const EventEmitter = require('events')
const YourModel = require('./path-to-your-model')
const { convertDataForModel } = require('mongoose-pii/convert')

const emitter = new EventEmitter()
// This is fired for every successfully-converted Document (1-n)
emitter.on('docs', (convertedCount) => { /* … */ })
// This is fired every time the (rounded-down) process completion percentage changes (1-100)
emitter.on('progress', (updatedPercentage) => { /* … */ })

convertDataForModel(YourModel, emitter)
  .then((convertedCount) => console.log(`Converted ${convertedCount} documents`))
  .catch((error) => console.error('Failed during the conversion:', error))
```

</details>

----

## Caveats

There are a few things to keep in mind when using this plugin.

### You need to cipher `deleteMany()` queries yourself

Mongoose does not yet provide a `deleteMany` hook, which means we’re not auto-ciphering queries used with `deleteMany()`.  If you’re using queries on ciphered fields with it, you currently need to cipher values yourself, using your ciphering key and the helper `cipher()` function we provide (see above), staying in `deriveIV` mode.

### We have to mutate many objects you pass Mongoose methods

Mongoose’s plugin API does not let us return updated objects for documents, queries or update descriptors: all we have to work with are the “original” objects, and we have to mutate these.

This means you should be super-careful to not inadvertently reuse an object you pass Mongoose that contains ciphered or hashed-password fields, as such objects will likely be mangled by the plugin; you’d end up double-ciphering stuff, possibly yell at double-deciphering attempts, too.

### Rotating keys isn’t easy right now

Security best practices would mandate that you rotate ciphering keys as time passes, to further reduce the risk of compromission.  However, using a new key would:

- invalidate deciphering of existing PII in the database
- incorrectly cipher fields in queries, causing empty results or mismatches

The usual workaround for this is to work with a *keyring*: a small array of keys, most-recent first, where we use the most-recent for writes and all keys for queries.  This is fine for cookie signature scenarios, but it seems to us that this could quickly aggravate queries on the database, and presents challenges in query descriptor mutations or composition to turn otherwise single-value matches into working OR clauses.  If anyone can whip up a good benchmark on this, perf-wise, and a working PR with tests, we’d love it!

### Be wary of your maximum field sizes

In MongoDB, maximum field sizes aren’t very useful…  Still, sometimes you put some maximum length in there, usually based on well-known data formats, such as SSN’s, driver’s license numbers, phone numbers, etc.  Many such fields are PII indeed.

Do remember that ciphering these fields results in 22 characters of IV prefix plus at least 33% more characters than the original data, due to ciphering and Base64 encoding.  Adjust your maximum lengths accordingly, if any.

### Avoid case transforms

We store all our ciphered and hashed data in Base64 format, which is case-sensitive.  It's nice to normalize such data as e-mail addresses to lowercase, but this will break deciphering in a very big way, as this essentially corrupts the ciphertext.  Make sure you don't have such transforms set on your ciphered or hashed fields.

### We need Node 8.6+, unless you Babelize us

We use modern ECMAScript, including REST/Spread properties (“Object spread”).  Although it became an official part of the language in ES2018, it’s been available in Node since v8.6.0. Node 8 is currently (October 2018) the Maintenance LTS version, with Node 10 being the Active LTS, and Node 11 out already.  Our `package.json` contains an `engines.node` field requiring `>= 8.6`, in order for npm to display a warning should you install it on a lower version.

Still, if you absolutely must use a version below it (which means you’re on a version that was, or is imminently going to be, End-Of-Lifed: not a wise choice), you can configure Babel to transpile our source, too.

We’re soon going to dual-publish (using both our native and transpiled source in the module’s package), but still, you should keep your Node runtimes up-to-date, at least with the latest LTS. There’s a lot to gain with this approach.

----

## Contributing

You want to help?  That’s awesome!  Check out the details of our [contribution process](./CONTRIBUTING.md) (it’s fairly standard).

This project is run under the [Contributor Covenant](./CODE_OF_CONDUCT.md): make sure you read its dispositions and agree with it before you start contributing.

## License and copyright

This library is © 2018 Delicious Insights and is MIT licensed. See [LICENSE.md](./LICENSE.md) for details.

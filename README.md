# Mongoose PII Plugin

[![npm version](https://badge.fury.io/js/mongoose-pii.svg)](https://npmjs.com/package/mongoose-pii)
[![Build Travis](https://img.shields.io/travis/deliciousinsights/mongoose-pii.svg)](https://travis-ci.org/deliciousinsights/mongoose-pii)
![État des dépendances](https://img.shields.io/david/deliciousinsights/mongoose-pii.svg)
[![Greenkeeper badge](https://badges.greenkeeper.io/deliciousinsights/mongoose-pii.svg)](https://greenkeeper.io/)
[![Coding style is StandardJS-based](https://img.shields.io/badge/style-standard-brightgreen.svg)](https://standardjs.com/)

[![License MIT](https://img.shields.io/github/license/deliciousinsights/mongoose-pii.svg)](https://en.wikipedia.org/wiki/MIT_License)
[![Code of Conduct is Contributor Covenant](https://img.shields.io/badge/code%20of%20conduct-contributor%20covenant-brightgreen.svg)](http://contributor-covenant.org/version/1/4/)

Best practices for data storage dictate that:

1. **Passwords should be securely hashed**; the typical state of the art right now being BCrypt with a securely-random IV and 10+ rounds (e.g. 2<sup>10</sup>+ iterations) in production.
2. **PII should be securely ciphered**; typically we'd use AES256.

These help avoid access to cleartext passwords and compromission of PII by database theft or unauthorized direct access.

This is all good, but we want to retain the comfort of authenticating, in our code, with cleartext password values that were typed in a form or sent in the API call; we also want to be able to query based on PII fields using cleartext values, or to update them with cleartext values.

In short, we want secure storage without having to worry about it.

This plugin does exactly that.

## Installing

If you’re using npm:

```bash
npm install mongoose-pii # or npm install --save mongoose-pii if you're running npm < 5.x
```

With yarn:

```bash
yarn add mongoose-pii
```

## Quick start

FIXME (incl. examples/)

## API

FIXME details of both plugins (markFieldsAsPII, hashPasswords) with their options

## Caveats

FIXME insertMany/deleteMany, query/update object mutation…

## Contributing

FIXME: CONTRIBUTING.md, Contributor Covenant

## License and copyright

This library is © 2018 Delicious Insights and is MIT licensed. See [LICENSE.md](./LICENSE.md) for details.

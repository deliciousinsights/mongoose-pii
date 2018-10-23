# Contributing to Mongoose-PII

We’re thrilled that you want to help! 🎉😍

Here are a few guidelines to help you get on the right tracks.

## A word about our Code of Conduct

This project uses the [Contributor Covenant](./CODE_OF_CONDUCT.md) code of conduct. Please read it carefully if you’re not already familiar with it. We expect you to behave in accordance with it on all online spaces related to this project.

## Check existing issues and discuss

Before you start spending time on this, it’s best to check that you’re not going to _waste_ your time re-inventing something that is already being worked on (an effort which you could then join), or putting together something that we would end up refusing for various reasons.

Check out [existing issues](https://github.com/deliciousinsights/mongoose-pii/issues?utf8=%E2%9C%93&q=is%3Aissue) (including closed ones, as such discussions might be resolved already) to verify that your intended contribution is both new and relevant.

If you can't find anything related, please open an issue and discuss your proposal, so we can help you figure out the best way to go about it for a smooth, successful merge in the project. Feel free to at-mention @tdd in there for extra confidence in our getting promptly notified.

Issues are the best place to hash out the details and approaches early, before too much code has been committed to it. You can then proceed to coding (or writing docs, or improving other aspects)!

## Working on the code

Getting started is the usual stuff:

1. [Fork the project](https://github.com/deliciousinsights/mongoose-pii/fork)
2. Clone your forked repo on your local machine
3. `npm install`
4. Create a well-named branch for your work (`git checkout -b your-branch-name`)

## Testing

The project files all have full tests. We use [Jest](https://jestjs.io/) for this, and have two npm scripts ready:

- `npm test` does a one-pass; it includes full test coverage reporting.
- `npm run test:watch` runs a developer test watch; this is what you should use when working on your code and tests.

The test suite uses the amazing [MongoDB Memory Server](https://www.npmjs.com/package/mongodb-memory-server) package, which means you won't need to have a running MongoDB server with a test database to run our tests! How cool is that!

We use Jest’s built-in `expect()` and matchers, along with its native mocking abilities. If you’re not familiar with them, here are the docs for [matchers](https://jestjs.io/docs/en/expect), [function mocking](https://jestjs.io/docs/en/mock-function-api) and [module mocking](https://jestjs.io/docs/en/manual-mocks). Look at the existing tests for inspiration and guidance.

Make sure **any new code you send has matching tests**, and that the test suite passes.

## Sending a Pull Request

Once you have something ready to contribute, or if you’re too stuck and need help, send a Pull Request from your fork’s code to our main repository. GitHub makes that easy for you in multiple ways. If you’re new to Pull Requests, check out [their neat docs about it](https://help.github.com/articles/proposing-changes-to-your-work-with-pull-requests/).

Any Pull Request submitted to main repository will trigger various Checks, including Continuous Integration on Travis and quality auditing on CodeClimate. These may result in failed checks that would prevent regular merging, but don't worry, we'll work on this together.

We currently achieve [100% test coverage](https://codeclimate.com/github/deliciousinsights/mongoose-pii), and we’d love to keep it that way. If you’re not clear on why your tests do not cover 100% of your code in some ways, ask us about it in your Pull Request’s conversation.

We currently achieve a [zero-issue, A-level quality grade](https://codeclimate.com/github/deliciousinsights/mongoose-pii) on CodeClimate; it will be tested on your Pull Requests as well, and we'd love for you to address any issues that may be surfaced. If you’re unsure how, ask us and we'll review it with you.

## Thanks again!

🙏🏻 Thanks a ton for helping out! That's what Open-Source is all about! 🙏🏻

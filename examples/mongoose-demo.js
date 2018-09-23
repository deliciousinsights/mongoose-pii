const mongoose = require('mongoose')
const { Schema } = require('mongoose')
const { markFieldsAsPII } = require('../index')

const schema = new Schema({
  address: String,
  email: String,
  firstName: String,
  lastName: String,
  password: String,
})
schema.plugin(markFieldsAsPII, {
  fields: ['email', 'firstName', 'lastName'],
  key: '59aad44db330ad2bf34f6730e50c0058',
})

const User = mongoose.model('User', schema)

demoScenario()

mongoose.connect(
  'mongodb://localhost:27017/demos',
  { connectTimeoutMS: 1000, useNewUrlParser: true }
)

async function demoScenario() {
  try {
    if (process.stdout.isTTY) {
      process.stdout.write('\033[2J\033[H')
    }
    await User.deleteMany({})

    const email = 'christophe@delicious-insights.com'
    const attrs = {
      address: '83 av. Philippe-Auguste 75011 Paris',
      email,
      firstName: 'Christophe',
      lastName: 'Porteneuve',
      password: 'foobar42',
    }

    // 1. Single-step create
    const user = await User.create(attrs)
    console.log('Created user:', user.toJSON())
    // 2. Two-step init-and-save
    const user2 = new User(attrs)
    await user2.save()
    console.log('Saved user:', user2.toJSON())
    // 3. insertMany
    const users = await User.insertMany([attrs, attrs])
    console.log('insertMany users:', users.map((u) => u.toJSON()))

    // 4. updateOne (update would work too but is deprecated)
    await user.updateOne({ firstName: 'Chris' })
    // 5. updateMany with both query and update ciphering
    const { nModified, n: nMatched } = await User.updateMany(
      { email: user.email },
      { address: '19 rue François Mauriac 92700 Colombes', lastName: 'Roberts' }
    )
    console.log(
      `updateMany with ciphered queries and updates: ${nMatched} matched, ${nModified} updated`
    )
    // 6. FIXME: replaceOne

    // 7. findById / findOne, including a ciphered query
    let fetchedUser = await User.findById(user.id)
    console.log('Fetched user (findById):', fetchedUser.toJSON())
    fetchedUser = await User.where({ firstName: 'Chris' }).findOne()
    console.log('Fetched user (findOne, ciphered query):', fetchedUser.toJSON())

    // 8. multi-fetch using find()
    const fetchedUsers = await User.where({ lastName: 'Roberts', email })
      .limit(2)
      .find()
    console.log(
      '2 fetched users (find, ciphered query):',
      fetchedUsers.map((u) => u.toJSON())
    )
    // 9. findOneAndDelete, with a ciphered query
    const deletedUser = await User.where({ email }).findOneAndDelete()
    console.log('Deleted user (ciphered query):', deletedUser)
    // 10. FIXME: deleteMany attempt -- no defined hook, so I'm a bit sceptic…
    // 11. FIXME: findOneAndUpdate() usage
    // 12. FIXME count, countDocuments, estimatedDocumentCount
  } finally {
    mongoose.disconnect()
  }
}

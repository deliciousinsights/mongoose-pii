const { pluginWasUsedOn } = require('../markFieldsAsPII')

async function convertDataForModel(Model, emitter = null) {
  const { collection, modelName } = Model

  if (!pluginWasUsedOn(Model)) {
    throw new Error(
      [
        `${modelName}’s schema did not register the markFieldsAsPII plugin.`,
        'Make sure your model’s schema registers it, for instance:',
        'mySchema.plugin(markFieldsAsPII, { /* your options here */ })',
      ].join('\n\n')
    )
  }

  const total = await collection.estimatedDocumentCount()

  if (total === 0) {
    return total
  }

  let converted = 0
  let oldPercentage = 0
  let oldBarWidth = 0
  const output = process.stderr
  const barWidth = (output.columns ? Math.min(100, output.columns) : 80) - 2

  let doc
  const scope = collection.find().batchSize(10)
  while ((doc = await scope.next())) {
    const mDoc = setupModelDoc(Model, doc)
    await mDoc.save()
    ++converted

    const percentage = Math.floor((converted * 100) / total)
    if (emitter) {
      emitter.emit('docs', converted)
      if (percentage > oldPercentage) {
        emitter.emit('progress', percentage)
      }
    } else {
      const newBarWidth = Math.round((percentage / 100) * barWidth)
      if (newBarWidth === oldBarWidth) {
        continue
      }
      if (oldBarWidth === 0) {
        output.write('\n[')
      }
      output.write('='.repeat(newBarWidth - oldBarWidth))
      if (percentage === 100) {
        output.write(']\n')
      }
      oldBarWidth = newBarWidth
    }
    oldPercentage = percentage
  }

  return converted
}

function setupModelDoc(Model, doc) {
  const result = Model.hydrate({})
  for (const [key, value] of Object.entries(doc)) {
    result[key] = value
  }
  return result
}

module.exports = { convertDataForModel }

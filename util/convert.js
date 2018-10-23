const { pluginWasUsedOn } = require('../markFieldsAsPII')

function checkPluginWasUsed(Model) {
  if (!pluginWasUsedOn(Model)) {
    throw new Error(
      [
        `${
          Model.modelName
        }’s schema did not register the markFieldsAsPII plugin.`,
        'Make sure your model’s schema registers it, for instance:',
        'mySchema.plugin(markFieldsAsPII, { /* your options here */ })',
      ].join('\n\n')
    )
  }
}

async function convertDataForModel(Model, emitter = null) {
  checkPluginWasUsed(Model)

  const total = await Model.collection.estimatedDocumentCount()

  if (total === 0) {
    return total
  }

  let [converted, oldPercentage, oldBarWidth] = [0, 0, 0]
  let doc
  const scope = Model.collection.find().batchSize(10)

  while ((doc = await scope.next())) {
    await setupModelDoc(Model, doc).save()
    ++converted

    const percentage = Math.floor((converted * 100) / total)
    if (emitter) {
      notifyEmitter({ emitter, converted, percentage, oldPercentage })
    } else {
      oldBarWidth = maintainProgressBar({ percentage, oldBarWidth })
    }
    oldPercentage = percentage
  }

  return converted
}

function maintainProgressBar({ percentage, oldBarWidth }) {
  const output = process.stderr
  const barWidth = (output.columns ? Math.min(100, output.columns) : 80) - 2
  const newBarWidth = Math.round((percentage / 100) * barWidth)

  if (newBarWidth === oldBarWidth) {
    return oldBarWidth
  }

  if (oldBarWidth === 0) {
    output.write('\n[')
  }

  output.write('='.repeat(newBarWidth - oldBarWidth))

  if (percentage === 100) {
    output.write(']\n')
  }

  return newBarWidth
}

function notifyEmitter({ emitter, converted, percentage, oldPercentage }) {
  emitter.emit('docs', converted)
  if (percentage > oldPercentage) {
    emitter.emit('progress', percentage)
  }
}

function setupModelDoc(Model, doc) {
  const result = Model.hydrate({})
  for (const [key, value] of Object.entries(doc)) {
    result[key] = value
  }
  return result
}

module.exports = { convertDataForModel }

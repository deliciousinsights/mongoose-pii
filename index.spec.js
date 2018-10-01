describe('Top-level module', () => {
  it('should re-export all the useful methods', () => {
    const {
      checkPassword,
      cipher,
      decipher,
      hashPassword,
      markFieldsAsPII,
    } = require('./index')

    expect(checkPassword).toBeInstanceOf(Function)
    expect(cipher).toBeInstanceOf(Function)
    expect(decipher).toBeInstanceOf(Function)
    expect(hashPassword).toBeInstanceOf(Function)
    expect(markFieldsAsPII).toBeInstanceOf(Function)
  })
})

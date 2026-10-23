module.exports = {
  getRandomBytesAsync: jest.fn(async (length) => new Uint8Array(require("node:crypto").randomBytes(length))),
};

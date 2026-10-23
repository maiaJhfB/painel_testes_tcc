const values = new Map();

module.exports = {
  deleteItemAsync: jest.fn(async (key) => {
    values.delete(key);
  }),
  getItemAsync: jest.fn(async (key) => values.get(key) ?? null),
  setItemAsync: jest.fn(async (key, value) => {
    values.set(key, value);
  }),
};

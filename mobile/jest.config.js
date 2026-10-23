/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  clearMocks: true,
  cacheDirectory: "<rootDir>/../.runtime/jest-cache",
  collectCoverageFrom: [
    "src/services/IdentityService.ts",
    "src/core/ports.ts",
  ],
  coveragePathIgnorePatterns: ["/node_modules/"],
  moduleNameMapper: {
    "^expo-constants$": "<rootDir>/test/mocks/expo-constants.js",
    "^expo-crypto$": "<rootDir>/test/mocks/expo-crypto.js",
    "^expo-secure-store$": "<rootDir>/test/mocks/expo-secure-store.js",
    "^react-native-webrtc$": "<rootDir>/test/mocks/react-native-webrtc.js",
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};

const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const nativeWebStub = path.resolve(__dirname, "src/dev/nativeWebStub.js");

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    platform === "web" &&
    (moduleName === "react-native-maps" || moduleName === "react-native-webrtc")
  ) {
    return { type: "sourceFile", filePath: nativeWebStub };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

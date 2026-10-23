const React = require("react");

function NativeOnlyComponent() {
  return null;
}

module.exports = NativeOnlyComponent;
module.exports.default = NativeOnlyComponent;
module.exports.Marker = NativeOnlyComponent;
module.exports.Polyline = NativeOnlyComponent;
module.exports.PROVIDER_GOOGLE = undefined;

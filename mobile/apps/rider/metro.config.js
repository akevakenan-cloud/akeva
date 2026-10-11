// Expo's default Metro config detects the npm workspace (../../) automatically.
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);

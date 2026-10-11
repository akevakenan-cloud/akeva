import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Akeva",
  slug: "akeva-rider",
  scheme: "akeva-rider",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "light",
  ios: {
    bundleIdentifier: "com.akeva.rider",
    supportsTablet: false,
    infoPlist: {
      NSCameraUsageDescription: "Akeva utilise l'appareil photo pour votre selfie et vos documents d'identité.",
      NSLocationWhenInUseUsageDescription: "Akeva utilise votre position pour trouver un chauffeur près de vous.",
    },
  },
  android: {
    package: "com.akeva.rider",
    permissions: ["CAMERA", "ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION"],
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-localization",
    ["expo-camera", { cameraPermission: "Akeva utilise l'appareil photo pour votre selfie et vos documents d'identité." }],
    ["expo-location", { locationWhenInUsePermission: "Akeva utilise votre position pour trouver un chauffeur près de vous." }],
    // Mapbox needs a secret download token at build time: set RNMAPBOX_MAPS_DOWNLOAD_TOKEN.
    ["@rnmapbox/maps", { RNMapboxMapsImpl: "mapbox" }],
  ],
  experiments: { typedRoutes: false },
};

export default config;

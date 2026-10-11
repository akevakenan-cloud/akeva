import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Akeva Driver",
  slug: "akeva-driver",
  scheme: "akeva-driver",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "light",
  ios: {
    bundleIdentifier: "com.akeva.driver",
    supportsTablet: false,
    infoPlist: {
      NSCameraUsageDescription: "Akeva utilise l'appareil photo pour votre selfie et vos documents d'identité.",
      NSLocationWhenInUseUsageDescription: "Akeva Driver utilise votre position pour vous proposer des courses et guider vos passagers jusqu'à vous.",
    },
  },
  android: {
    package: "com.akeva.driver",
    permissions: ["CAMERA", "ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION"],
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-localization",
    ["expo-camera", { cameraPermission: "Akeva utilise l'appareil photo pour votre selfie et vos documents d'identité." }],
    ["expo-location", { locationWhenInUsePermission: "Akeva Driver utilise votre position pour vous proposer des courses et guider vos passagers jusqu'à vous." }],
    // Mapbox needs a secret download token at build time: set RNMAPBOX_MAPS_DOWNLOAD_TOKEN.
    ["@rnmapbox/maps", { RNMapboxMapsImpl: "mapbox" }],
  ],
  experiments: { typedRoutes: false },
};

export default config;

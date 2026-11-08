// app.json plus the one value that must not be committed: the Google Maps
// key Android builds need (iPhone uses Apple Maps, which needs no key).
// Set GOOGLE_MAPS_ANDROID_API_KEY in your shell or as an EAS secret.
module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...(config.plugins ?? []),
    ['react-native-maps', { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? '' }],
  ],
});

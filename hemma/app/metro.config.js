// Lets the app import the shared rules in ../core (feed order, sponsored
// placement, demo data), the same code the dashboard and tests use.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../core')];
module.exports = config;

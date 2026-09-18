const fs = require('fs');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * O gerar-apk.cmd compila a partir de uma letra de unidade temporária (ex.: R:\), porque o
 * NDK/CMake não aceitam o espaço de "C:\Users\Gabriel Ti". O Node, porém, entrega alguns
 * arquivos pelo caminho real (C:\...), e o Metro recusa arquivos fora das pastas observadas.
 * Por isso a pasta real também é observada.
 */
const realRoot = process.env.DP_REAL_ROOT || fs.realpathSync.native(__dirname);

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: realRoot.toLowerCase() !== __dirname.toLowerCase() ? [realRoot] : [],
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);

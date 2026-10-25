'use strict';

// QuotaTray branded build configuration.
//
// Layers the product identity on top of the upstream Token Monitor builder
// config instead of forking it: same file set, same targets, same packaging
// logic — different appId / product name, and NO publish feed. Dropping the
// publish config matters: the upstream app auto-updates from the upstream
// project's releases, and a QuotaTray install must never "update" itself
// into a different product.

const baseConfig = require('./electron-builder.config');

module.exports = {
  ...baseConfig,
  appId: 'com.sweetai.quotatray',
  productName: 'QuotaTray',
  publish: null,
  mac: {
    ...(baseConfig.mac || {}),
    artifactName: 'QuotaTray-${version}-${arch}.${ext}'
  },
  win: {
    ...(baseConfig.win || {}),
    artifactName: 'QuotaTray-${version}-${arch}.${ext}'
  },
  linux: {
    ...(baseConfig.linux || {}),
    executableName: 'QuotaTray',
    artifactName: 'QuotaTray-${version}-${arch}.${ext}'
  }
};

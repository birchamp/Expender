const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * The Anthropic SDK ships Node-only code paths (credential-file discovery,
 * CLI helpers) that statically import `node:fs`, `node:crypto` and friends.
 * None of it runs in React Native — we always construct the client with an
 * explicit API key — but Metro still has to resolve the specifiers while
 * bundling, and there are no React Native implementations of `node:*`.
 *
 * Stubbing only the `node:`-prefixed form is deliberately narrow: bare
 * specifiers like `crypto` or `stream` are left alone so that packages
 * relying on a real shim keep working.
 */
// expo-sqlite's web build imports the wa-sqlite WASM binary as a module.
config.resolver.assetExts.push('wasm');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('node:')) {
    return { type: 'empty' };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

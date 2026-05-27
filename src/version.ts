// Replaced at build time by tsup with the version from package.json (see
// tsup.config.ts `define`). When run un-bundled (tests, ts-node) the token is
// undefined, so `typeof` guards against a ReferenceError and we fall back to a
// dev sentinel. Sent as `x-client-info` on every request.
declare const __SDK_VERSION__: string;

export const SDK_VERSION: string =
  typeof __SDK_VERSION__ !== "undefined" ? __SDK_VERSION__ : "0.0.0-dev";

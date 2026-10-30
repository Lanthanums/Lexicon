// Vite injects the same package version used by Electron and the installer.
declare const __APP_VERSION__: string
export const APP_VERSION = __APP_VERSION__
export const APP_VERSION_LABEL = `v${APP_VERSION.replace(/^(\d+\.\d+)\.0$/, '$1')}`

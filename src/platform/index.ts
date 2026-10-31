/**
 * Thin platform layer. Everything browser-specific that the game needs goes through here,
 * so a Tauri build can swap in native storage and file dialogs later.
 */
export interface Platform {
  storage: {
    get(key: string): Promise<Uint8Array | undefined>;
    set(key: string, value: Uint8Array): Promise<void>;
  };
  files: {
    /** Offers bytes to the user as a downloaded file. */
    save(name: string, bytes: Uint8Array, mime: string): Promise<void>;
    /** Lets the user pick a file; resolves null if they cancel. */
    open(accept: string): Promise<Uint8Array | null>;
  };
}

export { webPlatform as platform } from './web';
export { gzip, gunzipIfNeeded } from './compress';

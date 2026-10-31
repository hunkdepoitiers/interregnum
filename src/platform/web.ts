import { get, set } from 'idb-keyval';
import type { Platform } from './index';

export const webPlatform: Platform = {
  storage: {
    get: (key) => get<Uint8Array>(key),
    set: (key, value) => set(key, value),
  },
  files: {
    async save(name, bytes, mime) {
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    open(accept) {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.onchange = async () => {
          const file = input.files?.[0];
          resolve(file ? new Uint8Array(await file.arrayBuffer()) : null);
        };
        input.oncancel = () => resolve(null);
        input.click();
      });
    },
  },
};

/// <reference lib="webworker" />
import { encodeRuns } from './id-runs';

/** Decodes id-map tiles into row runs off the main thread (reading back a 4096 px tile there froze a frame for ~80 ms). */
self.onmessage = (e: MessageEvent<{ index: number; bitmap: ImageBitmap }>) => {
  const { index, bitmap } = e.data;
  const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const runs = encodeRuns(ctx.getImageData(0, 0, bitmap.width, bitmap.height).data, bitmap.width, bitmap.height);
  self.postMessage({ index, runs }, [runs.rows.buffer, runs.x.buffer, runs.id.buffer]);
};

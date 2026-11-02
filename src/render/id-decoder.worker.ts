/// <reference lib="webworker" />
import { encodeRuns } from './id-runs';

/** Decodes id-map tiles into row runs off the main thread (reading back a 4096 px tile there froze a frame for ~80 ms). */
self.onmessage = (e: MessageEvent<{ index: number; bitmap: ImageBitmap }>) => {
  const { index, bitmap } = e.data;
  const { width: w, height: h } = bitmap; // read before close(), which zeroes them
  const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const runs = encodeRuns(ctx.getImageData(0, 0, w, h).data, w, h);
  self.postMessage({ index, runs }, [runs.rows.buffer, runs.x.buffer, runs.id.buffer]);
};

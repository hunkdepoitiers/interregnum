async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export function gzip(text: string): Promise<Uint8Array> {
  return pipe(new TextEncoder().encode(text), new CompressionStream('gzip'));
}

/** Accepts gzipped or plain-text saves, so testers can also send hand-edited JSON. */
export async function gunzipIfNeeded(bytes: Uint8Array): Promise<string> {
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const raw = isGzip ? await pipe(bytes, new DecompressionStream('gzip')) : bytes;
  return new TextDecoder().decode(raw);
}

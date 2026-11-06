export function encodeWav(
  channels: Float32Array[],
  sampleRate: number,
): ArrayBuffer {
  if (
    !channels.length ||
    channels.length > 2 ||
    channels.some((c) => c.length !== channels[0].length)
  )
    throw new Error("Canales WAV inválidos.");
  const frames = channels[0].length;
  const count = channels.length;
  const buffer = new ArrayBuffer(44 + frames * count * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) =>
    [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * 2, true);
  view.setUint16(32, count * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * count * 2, true);
  for (let i = 0; i < frames; i++)
    for (let channel = 0; channel < count; channel++) {
      const value = Math.max(
        -1,
        Math.min(
          1,
          Number.isFinite(channels[channel][i]) ? channels[channel][i] : 0,
        ),
      );
      view.setInt16(
        44 + (i * count + channel) * 2,
        Math.round(value * (value < 0 ? 32768 : 32767)),
        true,
      );
    }
  return buffer;
}

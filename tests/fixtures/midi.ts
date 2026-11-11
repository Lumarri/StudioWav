// Hand-authored SMF fixtures, independent of the production encoder.
export function fixture(
  tracks: number[][],
  format = tracks.length === 1 ? 0 : 1,
  division = 480,
) {
  const bytes = [
    77,
    84,
    104,
    100,
    0,
    0,
    0,
    6,
    0,
    format,
    0,
    tracks.length,
    division >> 8,
    division & 255,
  ];
  for (const data of tracks)
    bytes.push(
      77,
      84,
      114,
      107,
      0,
      0,
      data.length >> 8,
      data.length & 255,
      ...data,
    );
  return new Uint8Array(bytes);
}
export const melodyFixture = () =>
  fixture([
    [
      0, 255, 3, 5, 80, 105, 97, 110, 111, 0, 255, 81, 3, 7, 161, 32, 0, 192, 0,
      60, 144, 60, 100, 60, 64, 80, 120, 60, 0, 0, 64, 0, 0, 255, 47, 0,
    ],
  ]);

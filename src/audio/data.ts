/** Decode embedded audio directly; no fetch or network permission is needed. */
export function dataUrlBytes(data: string): Uint8Array<ArrayBuffer> {
  const comma = data.indexOf(",");
  if (comma < 0 || !data.slice(0, comma).includes(";base64"))
    throw new Error("La muestra no contiene audio base64 válido.");
  return Uint8Array.from(atob(data.slice(comma + 1)), (character) =>
    character.charCodeAt(0),
  );
}

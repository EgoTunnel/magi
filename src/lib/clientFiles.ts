// Browser-side helper for the upload flows (Project Documents, conversation
// attachments) — both POST files as base64 in a JSON body, matching the rest
// of the app's all-JSON API convention rather than multipart/form-data.
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

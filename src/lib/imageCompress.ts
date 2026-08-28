// Client-side image downscaling before upload (2026-08-28) — Ben asked
// whether Notices photo uploads store the full-resolution original or
// something smaller. Answer at the time: full resolution, uncompressed —
// a modern phone photo can easily be 3-4000px and several MB, and none of
// that detail is needed for a noticeboard thumbnail/lightbox. This resizes
// to a sensible max dimension and re-encodes as a reasonable-quality JPEG
// entirely in the browser (canvas), so storage cost per photo drops
// sharply without a visible quality loss for how these are actually
// viewed.
//
// Deliberately conservative about what it touches: only re-encodes if the
// image is actually larger than the target, and falls back to returning
// the original File untouched on any failure (HEIC not decodable by
// createImageBitmap in some browsers, corrupt file, etc.) — a slightly
// larger upload is a much better failure mode than a broken attachment.
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

export async function compressImageFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) {
      bitmap.close?.();
      return file; // already small enough — don't re-encode for no gain
    }

    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) return file;

    const newName = file.name.replace(/\.[^./]+$/, "") + ".jpg";
    return new File([blob], newName, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

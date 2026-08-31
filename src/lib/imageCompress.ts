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

// Hard ceiling added 2026-08-31 — the "fall back to the original file on
// failure" design above turned out to have a real gap: a 16MB notice
// cover image made it into storage untouched because createImageBitmap
// silently failed to decode it, and the original fallback path had no
// size check at all. That one file alone was responsible for roughly a
// third of a single day's Supabase "cached egress" bandwidth (255MB of
// the day's 755MB), a big part of what pushed the club past its quota and
// forced the move to a paid plan. Rather than uploading a huge file
// silently, every fallback path now throws instead once the original is
// above this ceiling, so the upload fails loudly with a clear message
// the admin/player can act on (try a different photo/format) instead of
// quietly costing bandwidth for months. Generous enough to essentially
// never trip for a normal phone photo that DOES compress successfully.
export const HARD_SIZE_CAP_BYTES = 3 * 1024 * 1024; // 3MB

function enforceHardCap(f: File): File {
  if (f.size > HARD_SIZE_CAP_BYTES) {
    const mb = (f.size / (1024 * 1024)).toFixed(1);
    throw new Error(
      `This image (${mb}MB) couldn't be automatically resized and is too large to upload as-is. Try a different photo, or save it as a JPEG first.`
    );
  }
  return f;
}

// maxDimension is overridable per call site (2026-08-29) — added after
// discovering avatars/event posters/FAQ images were being uploaded at full
// original resolution (this function wasn't wired up to those three upload
// paths at all), which turned out to be the main driver behind Supabase's
// "Fair Use Policy" bandwidth email: a leaderboard full of 2-4MB avatar
// photos gets re-fetched by every member on every visit. Avatars in
// particular never render larger than a couple hundred px anywhere in the
// app, so they get a much smaller target than the 1600px default used for
// notices/event/FAQ images (which are shown full-width in a lightbox).
export async function compressImageFile(file: File, maxDimension: number = MAX_DIMENSION): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") {
    return enforceHardCap(file);
  }

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) {
      bitmap.close?.();
      return enforceHardCap(file); // already small enough — don't re-encode for no gain
    }

    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return enforceHardCap(file);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) return enforceHardCap(file);

    const newName = file.name.replace(/\.[^./]+$/, "") + ".jpg";
    return enforceHardCap(new File([blob], newName, { type: "image/jpeg" }));
  } catch {
    // Decode/encode failed — fall back to the original, but only if it's a
    // sane size (see enforceHardCap comment above for why this can't just
    // silently return `file` any more).
    return enforceHardCap(file);
  }
}

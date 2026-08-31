// One-off maintenance script — retrospectively compresses the ~37 oversized
// images already sitting in Supabase Storage (avatars + notices/event
// images uploaded before the compression fix went live). Run this ONCE
// from your own computer, then delete it.
//
// Why locally and not via Claude: Claude's sandbox has no general outbound
// internet access (confirmed while building this — every request to
// supabase.co was blocked by its network allowlist before it even reached
// Supabase), so it can't run this itself. Your computer doesn't have that
// restriction.
//
// WHAT THIS DOES, for each file listed below:
//   1. Downloads the current (oversized) image from its public URL — no
//      credentials needed, the bucket is public.
//   2. Resizes it with the exact same rules the app's own upload code
//      uses (500px max for avatars, 1600px max for notices/event images,
//      82% quality JPEG) — see src/lib/imageCompress.ts.
//   3. Re-uploads it to the EXACT same storage path, overwriting the
//      oversized original. Nothing in the app or database needs to
//      change — every avatar_url / cover_path / poster_path already
//      points at these same paths.
//
// SETUP (one-time):
//   1. Open a terminal in this project folder.
//   2. npm install sharp
//   3. Get your Supabase "service_role" key: Supabase dashboard →
//      Project Settings → API → reveal the service_role secret (NOT the
//      anon/public one).
//   4. Run:  SUPABASE_SERVICE_ROLE_KEY="paste-the-key-here" node recompress-existing-images.mjs
//
// The key only lives in that one terminal command — it's never written to
// this file or anywhere else. Delete this script once you've run it.

import sharp from "sharp";

const PROJECT_URL = "https://trfkgonjyonystitgeli.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY — see the setup instructions at the top of this file.");
  process.exit(1);
}

// bucket, path, max dimension (matches imageCompress.ts's per-caller values)
const FILES = [
  ["avatars", "2cd3b7c8-bbc9-4e2b-944d-9e8c469c5c13/avatar.png", 500],
  ["avatars", "93134d5b-4b56-42ad-a657-79b5e5afcb6b/avatar.png", 500],
  ["avatars", "d38113b8-01b4-4f2f-9da6-acefa6ea0f59/avatar.jpeg", 500],
  ["avatars", "bb1772e3-9729-42cf-a4b0-35af865a5382/avatar.jpeg", 500],
  ["avatars", "fccc4958-7bee-461e-8827-5e5306e5af6f/avatar.jpg", 500],
  ["avatars", "25a8d2ff-c437-4c17-95f4-9f4973629102/avatar.jpeg", 500],
  ["avatars", "855d35d6-1c6a-4dc2-a1c5-fc52d79ce215/avatar.jpeg", 500],
  ["avatars", "52d3456f-d859-4b1b-b0de-cdea1caf7f1e/avatar.jpeg", 500],
  ["notices", "events/b851242d-a2cf-41d2-896b-9b5180500fd6/poster.png", 1600],
  ["avatars", "afa11222-94fe-4bf1-8d4c-bebbede5dd98/avatar.jpg", 500],
  ["notices", "events/9f806224-588c-4978-a060-8767e9cbd820/poster-1786712724445-hfv71w.png", 1600],
  ["avatars", "d405060e-143e-4bb6-92bd-c7f4203f163b/avatar.jpg", 500],
  ["avatars", "2ccf1caf-2071-43f2-b83e-ab6ce881b229/avatar.png", 500],
  ["notices", "events/98bc8de4-7b24-4409-97da-cf1b12837806/poster-1787922646658-w8i5p4.png", 1600],
  ["avatars", "7a3e2576-51eb-4d76-bef1-88127fd4d226/avatar.png", 500],
  ["notices", "events/244ff041-05d2-4e72-a157-3f110c6fbf44/poster-1787947093005-mjvp35.png", 1600],
  ["notices", "events/6fc1a6d2-fdf3-46ea-8112-015f349d1cfe/poster-1787922930107-jojuy3.png", 1600],
  ["avatars", "8ce95b23-bc12-4592-874b-6881100ca6e8/avatar.jpeg", 500],
  ["notices", "events/6c7dc878-e3c8-445f-9550-c2bf1bf5c5e5/poster-1787921243821-wbpw4u.png", 1600],
  ["avatars", "12caafbc-d6c7-4f0a-9fa9-19cd4b668382/avatar.jpeg", 500],
  ["avatars", "25a8d2ff-c437-4c17-95f4-9f4973629102/avatar.jpg", 500],
  ["avatars", "957337b7-77e5-4fdc-a54b-c57834d7eeb9/avatar.jpeg", 500],
  ["avatars", "2088f9f1-9503-425c-8ade-5ba83ffbcfae/avatar.jpeg", 500],
  ["avatars", "93134d5b-4b56-42ad-a657-79b5e5afcb6b/avatar.jpeg", 500],
  ["avatars", "c1c2614b-fe70-4647-bdb5-e15fa4635a41/avatar.jpeg", 500],
  ["avatars", "f7177472-f5fd-4416-a6f7-170da820da93/avatar.jpeg", 500],
  ["notices", "events/8937dc56-c611-4c42-a4c5-43b7d2161fc0/poster-1787919962378-2zt1d0.jpg", 1600],
  ["avatars", "1d7e0fe1-b9d0-452f-86c9-6b94bf81e2bc/avatar.jpeg", 500],
  ["notices", "events/1c4314c8-94b4-412d-9e53-882eb9f59766/poster.jpeg", 1600],
  ["notices", "events/66a60c39-1175-4f30-96c2-07c71b24970d/poster-1787920831658-vvau79.jpg", 1600],
  ["avatars", "9274f08c-8a38-4a49-8c45-8eb4afa913d7/avatar.jpeg", 500],
  ["avatars", "e8be4ad2-a6e1-4210-80bb-2531c817b51e/avatar.jpeg", 500],
  ["notices", "notices/53bf49cf-6fd0-40d4-81e7-b512509a8449/cover-1787864949573-aklbp2.jpg", 1600],
  ["notices", "events/6d29731b-724b-4aaa-83ae-843e5566b1ee/poster-1787600802580-7ev2hu.jpg", 1600],
  ["avatars", "4a449d86-4494-41ea-a2cb-96db4a1e28df/avatar.jpeg", 500],
  ["avatars", "2d34b620-723c-42ab-aeee-73f9049d055b/avatar.jpg", 500],
  ["notices", "notices/1abe4d38-eab4-467b-94b3-c77cf179d35e/cover-1787833462656-3fxxe0.jpeg", 1600],
];

function fmt(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + "MB";
}

async function main() {
  let okCount = 0;
  let failCount = 0;
  let totalBefore = 0;
  let totalAfter = 0;

  for (const [bucket, path, maxDim] of FILES) {
    const publicUrl = `${PROJECT_URL}/storage/v1/object/public/${bucket}/${path}`;
    try {
      const res = await fetch(publicUrl);
      if (!res.ok) throw new Error(`download failed: ${res.status}`);
      const original = Buffer.from(await res.arrayBuffer());

      const compressed = await sharp(original)
        .rotate() // respect EXIF orientation, matches createImageBitmap behavior
        .resize({ width: maxDim, height: maxDim, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#000000" }) // matches the app's own canvas-based compressor
        .jpeg({ quality: 82 })
        .toBuffer();

      if (compressed.length >= original.length) {
        console.log(`SKIP (no gain)  ${bucket}/${path}  ${fmt(original.length)} -> ${fmt(compressed.length)}`);
        continue;
      }

      const uploadUrl = `${PROJECT_URL}/storage/v1/object/${bucket}/${path}`;
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${SERVICE_KEY}`,
          apikey: SERVICE_KEY,
          "Content-Type": "image/jpeg",
          "x-upsert": "true",
          "cache-control": "max-age=31536000",
        },
        body: compressed,
      });
      if (!uploadRes.ok) {
        throw new Error(`upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
      }

      console.log(`OK  ${bucket}/${path}  ${fmt(original.length)} -> ${fmt(compressed.length)}`);
      totalBefore += original.length;
      totalAfter += compressed.length;
      okCount++;
    } catch (err) {
      console.error(`FAIL  ${bucket}/${path}  ${err.message}`);
      failCount++;
    }
  }

  console.log("\n--- Summary ---");
  console.log(`${okCount} succeeded, ${failCount} failed`);
  console.log(`Total: ${fmt(totalBefore)} -> ${fmt(totalAfter)} (saved ${fmt(totalBefore - totalAfter)})`);
}

main();

// Helper to extract Cloudinary public_id from image URL
function getPublicIdFromUrl(url) {
  const parts = url.split("/");
  const file =
    parts[parts.length - 3] +
    "/" +
    parts[parts.length - 2] +
    "/" +
    parts[parts.length - 1].split(".")[0];
  return file;
}

export { getPublicIdFromUrl };

import { v2 as cloudinary } from "cloudinary";
import fs from "fs";
import { Readable } from "stream";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const uploadImageToCloudinary = async (filePath, tenantId) => {
  const folder = tenantId === "otkhzjwq" ? "toolbizz" : "shrilimbas";

  try {
    if (!filePath) return null;

    const result = await cloudinary.uploader.upload(filePath, {
      resource_type: "auto",
      folder: folder,
    });
    return result;
  } catch (error) {
    console.error("Error uploading image to Cloudinary:", error);
    fs.unlinkSync(filePath);
    throw error;
  }
};

const deleteFromCloudinary = async (publicId) => {
  try {
    if (!publicId) return; // No need to delete if publicId is not provided
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error("Error deleting image from Cloudinary:", error);
    throw error;
  }
};

// upload pdf on cloudinary
function bufferToStream(buffer) {
  const readable = new Readable();
  readable.push(buffer);
  readable.push(null);
  return readable;
}

const uploadInvoiceToCloudinary = (buffer, filename, path, tenantId) => {
  const folder = tenantId === "otkhzjwq" ? "toolbizz" : "shrilimbas";
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        folder: `${folder}/invoices`,
        public_id: filename.replace(".pdf", "") + ".pdf",
        use_filename: true,
      },
      (error, result) => {
        if (error) {
          if (fs.existsSync(path)) {
            fs.unlinkSync(path);
          }
          return reject(error);
        }

        resolve(result.secure_url);
      }
    );

    bufferToStream(buffer).pipe(uploadStream);
  });
};

export {
  uploadImageToCloudinary,
  deleteFromCloudinary,
  uploadInvoiceToCloudinary,
};

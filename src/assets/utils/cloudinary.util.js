import { v2 as cloudinary } from "cloudinary";
import fs from "fs";
import { Readable } from "stream";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const uploadImageToCloudinary = async (filePath, tenantId, baseFolder) => {
  if (tenantId === undefined) {
    throw new Error("Tenant ID is required");
  }
  let mainFolder = null;
  if (tenantId === "otkhzjwq") {
    mainFolder = "toolbizz";
  } else if (tenantId === "xnprapms") {
    mainFolder = "shrilimbas";
  } else if (tenantId === "bjxdtyyy") {
    mainFolder = "shrilimbas_new";
  } else {
    throw new Error("Invalid tenant ID");
  }

  try {
    if (!filePath) return null;

    const result = await cloudinary.uploader.upload(filePath, {
      resource_type: "auto",
      folder: mainFolder + "/" + baseFolder,
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
    const result = await cloudinary.uploader.destroy(publicId);
    return result;
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
  let mainFolder = null;
  if (tenantId === "otkhzjwq") {
    mainFolder = "toolbizz";
  } else if (tenantId === "xnprapms") {
    mainFolder = "shrilimbas";
  } else if (tenantId === "bjxdtyyy") {
    mainFolder = "shrilimbas_new";
  } else {
    throw new Error("Invalid tenant ID");
  }
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        folder: `${mainFolder}/invoices`,
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

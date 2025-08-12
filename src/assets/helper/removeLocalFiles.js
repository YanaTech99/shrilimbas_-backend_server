import fs from "fs";

const removeLocalFiles = async (files) => {
  if (Array.isArray(files)) {
    for (const file of files) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }
  } else {
    if (fs.existsSync(files.path)) fs.unlinkSync(files.path);
  }
};

export { removeLocalFiles };

import pools from "../../db/index.js";
import { uploadImageToCloudinary, deleteFromCloudinary, } from "../../utils/cloudinary.util.js";
import { getPublicIdFromUrl } from "../../utils/extractPublicID.util.js";
import { pagesFolder } from "../../../constants.js";

const insertPage = async (req, res) => {
    const tenantId = req.tenantId;
    const pool = pools[tenantId];
    let pageImage = req.file || null;
    const { id: user_id, user_type } = req.user;
  
    const { page_name, title, description, status } = req.body;

    if(user_type !== "VENDOR") {
      return res.status(403).json({ success: false, error: "Unauthorized" });
    }
  
    if (!page_name || !title) {
      return res.status(400).json({
        success: false,
        error: "page_name and title are required",
      });
    }

    if (pageImage && pageImage.path) {
      const { secure_url } = await uploadImageToCloudinary(pageImage.path, tenantId, pagesFolder);
      pageImage = secure_url;
    }
  
    try {
      const [result] = await pool.query(
        `INSERT INTO pages (page_name, title, page_image, description, status, created_by)
         VALUES (?, ?, ?, ?, ?)`,
        [page_name, title, pageImage, description || null, status || "active", user_id]
      );
  
      return res.status(201).json({
        success: true,
        message: "Page created successfully",
        pageId: result.insertId,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        success: false,
        error: "Failed to insert page",
      });
    }
  };
  
const updatePage = async (req, res) => {
    const tenantId = req.tenantId;
    const pool = pools[tenantId];
    const { id } = req.params;
    const { id: user_id, user_type } = req.user;

    if(user_type !== "VENDOR") {
      return res.status(403).json({ success: false, error: "Unauthorized" });
    }
  
    if (!id) {
      return res.status(400).json({
        success: false,
        error: "Page id is required",
      });
    }
  
    const { page_name, title, description, status } = req.body;
    const pageImage = req.file || null;
  
    const updateFields = [];
    const values = [];

    const [pageData] = await pool.query(
      `SELECT * FROM pages WHERE id = ?`,
      [id]
    );

    if (!pageData || pageData.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Page not found",
      });
    }
  
    if (page_name) {
      updateFields.push("page_name = ?");
      values.push(page_name);
    }
    if (title) {
      updateFields.push("title = ?");
      values.push(title);
    }
    if (pageImage) {
      if (
        pageData[0].page_image &&
        pageData[0].page_image !== "" 
        ) {
        const public_id = getPublicIdFromUrl(pageData[0].page_image);
        await deleteFromCloudinary(public_id);
      }
      const { secure_url } = await uploadImageToCloudinary(pageImage.path, tenantId, pagesFolder);
      updateFields.push("page_image = ?");
      values.push(secure_url);
    }
    if (description) {
      updateFields.push("description = ?");
      values.push(description);
    }
    if (status) {
      updateFields.push("status = ?");
      values.push(status);
    }
  
    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No fields provided for update",
      });
    }
    updateFields.push("updated_by = ?");
    values.push(user_id);
  
    try {
      const [result] = await pool.query(
        `UPDATE pages SET ${updateFields.join(", ")} WHERE id = ?`,
        [...values, id]
      );
  
      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          error: "Page not found",
        });
      }
  
      return res.status(200).json({
        success: true,
        message: "Page updated successfully",
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        success: false,
        error: "Failed to update page",
      });
    }
  };
  
  
  const listPages = async (req, res) => { 
    const tenantId = req.tenantId;
    const pool = pools[tenantId];
  
    try {
      const [rows] = await pool.query(
        `SELECT id, page_name, title, page_image, created_date, updated_date, status FROM pages ORDER BY created_date DESC`
      );
  
      return res.status(200).json({
        success: true,
        data: rows,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch pages",
      });
    }
  };
  
  const getPageById = async (req, res) => {
    const tenantId = req.tenantId;
    const pool = pools[tenantId];
    const { id } = req.query;
  
    if (!id) {
      return res.status(400).json({
        success: false,
        error: "Page id is required",
      });
    }
  
    try {
      const [rows] = await pool.query(
        `SELECT * FROM pages WHERE id = ?`,
        [id]
      );
  
      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Page not found",
        });
      }
  
      return res.status(200).json({
        success: true,
        data: rows[0],
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch page details",
      });
    }
  };
  
  export {
    insertPage,
    updatePage,
    listPages,
    getPageById,
  };
  
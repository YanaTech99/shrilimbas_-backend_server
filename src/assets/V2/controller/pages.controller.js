import pools from "../../db/index.js";

const insertPage = async (req, res) => {
    const tenantId = req.tenantId;
    const pool = pools[tenantId];
    const { id: user_id } = req.user;
  
    const { page_name, title, sub_title, description, status } = req.body;
  
    if (!page_name || !title) {
      return res.status(400).json({
        success: false,
        error: "page_name and title are required",
      });
    }
  
    try {
      const [result] = await pool.query(
        `INSERT INTO pages (page_name, title, sub_title, description, status, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [page_name, title, sub_title || null, description || null, status || "active", user_id, user_id]
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
    const { id: user_id } = req.user;
    const { id } = req.params;
  
    if (!id) {
      return res.status(400).json({
        success: false,
        error: "Page id is required",
      });
    }
  
    const modifiedInput = Object.entries(req.body).reduce((acc, [key, value]) => {
      acc[key] = sanitizeInput(value);
      return acc;
    }, {});
  
    const { page_name, title, sub_title, description, status } = modifiedInput;
  
    const updateQuery = [];
    if (page_name) updateQuery.push(`page_name = '${page_name}'`);
    if (title) updateQuery.push(`title = '${title}'`);
    if (sub_title) updateQuery.push(`sub_title = '${sub_title}'`);
    if (description) updateQuery.push(`description = '${description}'`);
    if (status) updateQuery.push(`status = '${status}'`);
    updateQuery.push(`updated_by = '${user_id}'`);
  
    if (updateQuery.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No fields provided for update",
      });
    }
  
    try {
      const [result] = await pool.query(
        `UPDATE pages SET ${updateQuery.join(", ")} WHERE id = ?`,
        [id]
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
        `SELECT id, page_name, title FROM pages ORDER BY created_date DESC`
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
  
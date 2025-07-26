import path, { relative } from "path";
import ejs from "ejs";
import puppeteer from "puppeteer-core";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get root dir (up from src/assets/utils → project root)
const ROOT_DIR = path.resolve(__dirname, "../../../");

const generateInvoicePDF = async (orderData, outputFileName) => {
  try {
    // 1. Load EJS template
    const templatePath = path.join(
      ROOT_DIR,
      "src",
      "assets",
      "views",
      "invoice.ejs"
    );
    const html = await ejs.renderFile(templatePath, { order: orderData });

    // 2. Launch Puppeteer and create PDF
    const browser = await puppeteer.launch({
      executablePath: "/usr/bin/chromium",
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    // 3. Save PDF in /public/invoices
    const outputPath = path.join(
      ROOT_DIR,
      "public",
      "invoices",
      outputFileName
    );
    const pdfBuffer = await page.pdf({
      path: outputPath,
      format: "A4",
      printBackground: true,
    });

    await browser.close();

    return {
      pdfBuffer,
      relativePath: outputPath,
    };
  } catch (err) {
    console.error("Error generating invoice PDF:", err);
    throw err;
  }
};

export { generateInvoicePDF };

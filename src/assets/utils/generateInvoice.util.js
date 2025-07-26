import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../../../");

const formatCurrency = (amount) => `₹${(amount || 0).toFixed(2)}`;

const generateInvoicePDF = async (orderData, outputFileName) => {
  return new Promise((resolve, reject) => {
    try {
      const outputPath = path.join(
        ROOT_DIR,
        "public",
        "invoices",
        outputFileName
      );

      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      const {
        customer,
        delivery_address: d,
        items,
        price_summary: s,
      } = orderData;

      doc.fontSize(20).text("INVOICE", { align: "center" }).moveDown();
      doc
        .fontSize(10)
        .text(`Order #: ${orderData.order_number}`)
        .text(`Order ID: ${orderData.order_id}`)
        .text(`Date: ${orderData.date}`)
        .text(`Time: ${orderData.time}`)
        .text(`Payment Method: ${orderData.payment_method}`)
        .text(`Payment Status: ${orderData.payment_status}`)
        .moveDown();

      doc
        .fontSize(12)
        .text("Customer Details", { underline: true })
        .moveDown(0.5);
      doc
        .fontSize(10)
        .text(`Name: ${customer.name}`)
        .text(`Email: ${customer.email}`)
        .text(`Phone: ${customer.phone}`)
        .text(`Alt Phone: ${customer.alternate_phone}`)
        .moveDown();

      doc
        .fontSize(12)
        .text("Delivery Address", { underline: true })
        .moveDown(0.5);
      doc
        .fontSize(10)
        .text(d.address)
        .text(`${d.city}, ${d.state}, ${d.postal_code}`)
        .text(`${d.country}`)
        .text(`Instructions: ${d.instructions || "N/A"}`)
        .moveDown();

      doc
        .fontSize(12)
        .text("Item", 50, doc.y, { continued: true })
        .text("Qty", 220, doc.y, { continued: true })
        .text("Unit ₹", 270, doc.y, { continued: true })
        .text("Disc", 330, doc.y, { continued: true })
        .text("Tax", 390, doc.y, { continued: true })
        .text("Total", 450, doc.y)
        .moveDown(0.5);

      items.forEach((item) => {
        doc
          .fontSize(10)
          .text(item.name, 50, doc.y, { continued: true })
          .text(item.quantity, 220, doc.y, { continued: true })
          .text(formatCurrency(item.price_per_unit), 270, doc.y, {
            continued: true,
          })
          .text(formatCurrency(item.discount_per_unit), 330, doc.y, {
            continued: true,
          })
          .text(formatCurrency(item.tax_per_unit), 390, doc.y, {
            continued: true,
          })
          .text(formatCurrency(item.total), 450, doc.y)
          .moveDown(0.5);
      });

      doc.moveDown();
      doc.fontSize(12).text("Price Summary", { underline: true }).moveDown(0.5);
      doc
        .fontSize(10)
        .text(`Subtotal: ${formatCurrency(s.sub_total)}`, { align: "right" })
        .text(`Discount: -${formatCurrency(s.discount)}`, { align: "right" })
        .text(`Tax: ${formatCurrency(s.tax)}`, { align: "right" })
        .text(`Shipping: ${formatCurrency(s.shipping_fee)}`, { align: "right" })
        .text(`Total: ${formatCurrency(s.total)}`, { align: "right" });

      if (orderData.notes) {
        doc.moveDown().text(`Notes: ${orderData.notes}`);
      }

      doc.moveDown(2);
      doc
        .fontSize(10)
        .text("Thanks for your order!", { align: "center" })
        .text("Contact support@example.com for help.", { align: "center" });

      doc.end();

      stream.on("finish", () => {
        resolve({
          pdfBuffer: fs.readFileSync(outputPath),
          relativePath: outputPath,
        });
      });

      stream.on("error", reject);
    } catch (err) {
      console.error("Error generating PDF:", err);
      reject(err);
    }
  });
};

export { generateInvoicePDF };

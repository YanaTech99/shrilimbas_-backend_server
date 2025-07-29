import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../../../");

const formatCurrency = (amount) => `₹${(amount || 0).toFixed(2)}`;

const drawTableRow = (doc, y, row, isHeader = false) => {
  const rowHeight = 25;
  const columns = [
    { text: row.product, x: 50, width: 120 },
    { text: row.variant, x: 170, width: 90 },
    { text: row.qty, x: 260, width: 40 },
    { text: row.unit, x: 300, width: 60 },
    { text: row.discount, x: 360, width: 60 },
    { text: row.tax, x: 420, width: 60 },
    { text: row.total, x: 480, width: 60 },
  ];

  doc.rect(50, y, 490, rowHeight).stroke();

  columns.forEach(({ text, x, width }) => {
    doc.rect(x, y, width, rowHeight).stroke();
    doc
      .font("Helvetica" + (isHeader ? "-Bold" : ""))
      .fontSize(9)
      .text(text, x + 5, y + 8, { width: width - 10, align: "left" });
  });

  return y + rowHeight;
};

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

      // HEADER
      doc.fontSize(20).text("TAX INVOICE", { align: "center" }).moveDown();
      doc
        .fontSize(10)
        .text(`Order Number: ${orderData.order_number}`)
        .text(`Order ID: ${orderData.order_id}`)
        .text(`Date: ${orderData.date}  Time: ${orderData.time}`)
        .text(`Payment Method: ${orderData.payment_method}`)
        .text(`Payment Status: ${orderData.payment_status}`)
        .moveDown();

      // CUSTOMER INFO
      doc
        .fontSize(12)
        .text("Customer Details", { underline: true })
        .moveDown(0.5);
      doc
        .fontSize(10)
        .text(`Name: ${customer.name}`)
        .text(`Email: ${customer.email}`)
        .text(`Phone: ${customer.phone}`)
        .text(`Alternate Phone: ${customer.alternate_phone || "N/A"}`)
        .moveDown();

      // DELIVERY
      doc
        .fontSize(12)
        .text("Delivery Address", { underline: true })
        .moveDown(0.5);
      doc
        .fontSize(10)
        .text(d.address)
        .text(`${d.city}, ${d.state}, ${d.country}, ${d.postal_code}`)
        .text(`Instructions: ${d.instructions || "N/A"}`)
        .moveDown();

      // ITEMS TABLE
      doc.fontSize(12).text("Items", { underline: true }).moveDown(0.5);

      let y = doc.y;
      y = drawTableRow(
        doc,
        y,
        {
          product: "Product",
          variant: "Variant",
          qty: "Qty",
          unit: "Unit ₹",
          discount: "Disc ₹",
          tax: "Tax ₹",
          total: "Total ₹",
        },
        true
      );

      items.forEach((item) => {
        const variant = item.variant || {};
        const variantDetails = [variant.color, variant.size, variant.material]
          .filter(Boolean)
          .join(" / ");

        y = drawTableRow(doc, y, {
          product: item.name,
          variant: variantDetails || "-",
          qty: item.quantity.toString(),
          unit: formatCurrency(item.price_per_unit),
          discount: formatCurrency(item.discount_per_unit),
          tax: formatCurrency(item.tax_per_unit),
          total: formatCurrency(item.total),
        });
      });

      // SUMMARY
      doc
        .moveDown(2)
        .fontSize(12)
        .text("Price Summary", { underline: true })
        .moveDown(0.5);
      doc
        .fontSize(10)
        .text(`Subtotal: ${formatCurrency(s.sub_total)}`, { align: "right" })
        .text(`Discount: -${formatCurrency(s.discount)}`, { align: "right" })
        .text(`Tax: ${formatCurrency(s.tax)}`, { align: "right" })
        .text(`Shipping: ${formatCurrency(s.shipping_fee)}`, { align: "right" })
        .font("Helvetica-Bold")
        .text(`Total: ${formatCurrency(s.total)}`, { align: "right" })
        .font("Helvetica");

      // NOTES
      if (orderData.notes) {
        doc.moveDown().fontSize(10).text(`Notes: ${orderData.notes}`);
      }

      // FOOTER
      doc
        .moveDown(3)
        .fontSize(10)
        .text("Thank you for your purchase!", { align: "center" })
        .text("For support, email support@example.com", { align: "center" });

      doc.end();

      stream.on("finish", () => {
        resolve({
          pdfBuffer: fs.readFileSync(outputPath),
          relativePath: outputPath,
        });
      });

      stream.on("error", (err) => {
        console.error("Error writing PDF:", err);
        reject(err);
      });
    } catch (err) {
      console.error("Error generating PDF:", err);
      reject(err);
    }
  });
};

export { generateInvoicePDF };

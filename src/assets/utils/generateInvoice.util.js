import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../../../");

const formatCurrency = (amount) => `${(amount || 0).toFixed(2)}`;

const drawHorizontalLine = (doc, y, startX = 50, endX = 545) => {
  doc.moveTo(startX, y).lineTo(endX, y).stroke();
};

const drawItemsTable = (doc, items, startY) => {
  let currentY = startY;
  const tableStartX = 50;
  const tableWidth = 495;
  const rowHeight = 35;

  // Table headers
  const headers = [
    { text: "S.No", x: tableStartX, width: 40 },
    { text: "Item Name", x: tableStartX + 40, width: 200 },
    { text: "Price", x: tableStartX + 240, width: 80 },
    { text: "Qty", x: tableStartX + 320, width: 60 },
    { text: "Tax", x: tableStartX + 380, width: 60 },
    { text: "Total", x: tableStartX + 440, width: 55 },
  ];

  // Draw header background (dark)
  doc
    .rect(tableStartX, currentY, tableWidth, rowHeight)
    .fillAndStroke("#333333", "#333333");

  // Header text (white)
  doc.fillColor("#ffffff").fontSize(10).font("Helvetica-Bold");

  headers.forEach((header) => {
    const textAlign = ["Price", "Qty", "Tax", "Total"].includes(header.text)
      ? "center"
      : "left";
    doc.text(header.text, header.x + 5, currentY + 12, {
      width: header.width - 10,
      align: textAlign,
    });
  });

  currentY += rowHeight;

  // Draw items
  doc.fillColor("#000000").font("Helvetica").fontSize(10);

  items.forEach((item, index) => {
    const variant = item.variant || {};
    const variantDetails = [variant.color, variant.size, variant.material]
      .filter(Boolean)
      .join(" / ");

    const itemName = variantDetails
      ? `${item.name} (${variantDetails})`
      : item.name;

    // Alternate row background
    if (index % 2 === 0) {
      doc
        .rect(tableStartX, currentY, tableWidth, rowHeight)
        .fillAndStroke("#f8f8f8", "#cccccc");
    } else {
      doc.rect(tableStartX, currentY, tableWidth, rowHeight).stroke("#cccccc");
    }

    doc.fillColor("#000000");

    // Item details
    const rowData = [
      {
        text: (index + 1).toString(),
        x: tableStartX,
        width: 40,
        align: "center",
      },
      { text: itemName, x: tableStartX + 40, width: 200, align: "left" },
      {
        text: formatCurrency(item.price_per_unit),
        x: tableStartX + 240,
        width: 80,
        align: "center",
      },
      {
        text: item.quantity.toString(),
        x: tableStartX + 320,
        width: 60,
        align: "center",
      },
      {
        text: `${formatCurrency(item.tax_per_unit)}%`,
        x: tableStartX + 380,
        width: 60,
        align: "center",
      },
      {
        text: formatCurrency(item.total),
        x: tableStartX + 440,
        width: 55,
        align: "center",
      },
    ];

    rowData.forEach((data) => {
      doc.text(data.text, data.x + 5, currentY + 12, {
        width: data.width - 10,
        align: data.align,
        lineGap: 3,
      });
    });

    currentY += rowHeight;
  });

  return currentY;
};

const generateInvoicePDF = async (orderData, outputFileName, tenantId) => {
  let shopName = "";
  if (tenantId === "otkhzjwq") {
    shopName = "Toolbizz";
  } else if (tenantId === "xnprapms") {
    shopName = "Pawerman";
  } else if (tenantId === "bjxdtyyy") {
    shopName = "Shrilimbas";
  } else {
    throw new Error("Invalid tenant ID");
  }

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

      let currentY = 50;

      // TOP SECTION WITH LOGO AND INVOICE TITLE
      // Company logo placeholder (diamond shape)
      doc.rect(50, currentY, 20, 20).fillAndStroke("#333333", "#333333");

      // Company name
      doc
        .fillColor("#000000")
        .fontSize(14)
        .font("Helvetica-Bold")
        .text(shopName, 75, currentY + 2);

      // Yellow bar and INVOICE title
      doc.rect(50, currentY + 40, 200, 8).fillAndStroke("#FFD700", "#FFD700");

      doc.rect(450, currentY + 40, 95, 8).fillAndStroke("#FFD700", "#FFD700");

      doc
        .fillColor("#000000")
        .fontSize(28)
        .font("Helvetica-Bold")
        .text("INVOICE", 280, currentY + 35);

      currentY += 75;

      // INVOICE TO SECTION
      doc.fontSize(12).font("Helvetica-Bold").text("Invoice to:", 50, currentY);

      // Invoice details on the right
      doc
        .fontSize(10)
        .font("Helvetica")
        .text("Invoice#", 400, currentY)
        .text("Date", 400, currentY + 30);

      doc
        .font("Helvetica-Bold")
        .text(orderData.order_number || orderData.order_id, 460, currentY)
        .text(
          orderData.date || new Date().toLocaleDateString("en-IN"),
          460,
          currentY + 30
        );

      currentY += 25;

      // Customer details
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text(`Name: ${customer.name || "Customer"}`, 50, currentY);

      currentY += 15;

      doc
        .font("Helvetica")
        .text(`Address: ${d.address}`, 50, currentY)
        .text(
          d.state && d.city ? `City/State: ${d.city}, ${d.state}` : "N/A",
          50,
          currentY + 15
        )
        .text(
          d.country && d.postal_code
            ? `Country: ${d.country}, ${d.postal_code}`
            : "N/A",
          50,
          currentY + 30
        );

      currentY += 60;

      // ITEMS TABLE
      currentY = drawItemsTable(doc, items, currentY);
      currentY += 20;

      // Terms & Conditions
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("Terms & Conditions", 50, currentY + 25);

      doc
        .fontSize(9)
        .font("Helvetica")
        .text(
          "Lorem ipsum dolor sit amet, consectetur adipiscing",
          50,
          currentY + 42
        )
        .text("elit, Fusce dignissim pretium consectetur.", 50, currentY + 55);

      // Price Summary (right side)
      const summaryStartX = 350;
      const labelWidth = 100; // width reserved for labels
      const valueWidth = 100; // width reserved for values (right-aligned)
      let summaryY = currentY;

      // Sub Total
      doc
        .fontSize(10)
        .font("Helvetica")
        .text("Sub Total:", summaryStartX, summaryY, {
          width: labelWidth,
          align: "right",
        })
        .text(
          formatCurrency(s.sub_total),
          summaryStartX + labelWidth,
          summaryY,
          {
            width: valueWidth,
            align: "right",
          }
        );

      // Tax
      doc
        .text("Tax:", summaryStartX, summaryY + 18, {
          width: labelWidth,
          align: "right",
        })
        .text(
          formatCurrency(s.tax),
          summaryStartX + labelWidth,
          summaryY + 18,
          {
            width: valueWidth,
            align: "right",
          }
        );

      // Total with yellow background
      doc
        .rect(summaryStartX, summaryY + 45, labelWidth + valueWidth, 25)
        .fillAndStroke("#FFD700", "#FFD700");

      doc
        .fillColor("#000000")
        .fontSize(12)
        .font("Helvetica-Bold")
        .text("Total:", summaryStartX, summaryY + 53, {
          width: labelWidth,
          align: "right",
        })
        .text(
          formatCurrency(s.total),
          summaryStartX + labelWidth,
          summaryY + 53,
          {
            width: valueWidth,
            align: "right",
          }
        );

      // Thank you message
      doc
        .fontSize(18)
        .font("Helvetica-Bold")
        .text("Thank you for your business!", 50, doc.page.height - 180, {
          align: "center",
        });

      // Bottom border line
      drawHorizontalLine(doc, doc.page.height - 50, 50, 545);

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

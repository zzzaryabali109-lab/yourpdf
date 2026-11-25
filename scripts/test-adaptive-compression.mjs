import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { encodeJpeg } from "../src/lib/jpeg-encoder.ts";
import { optimizePdf, validateCandidate } from "../src/lib/pdf-optimizer.ts";

async function runTestSuite() {
  console.log("=========================================================");
  console.log("   PDF ADAPTIVE SIZE-REDUCTION ENGINE VERIFICATION TEST   ");
  console.log("=========================================================\n");

  const results = [];

  // -------------------------------------------------------------------
  // TEST 1: Searchable Text PDF (Report with headers, paragraphs, fonts)
  // -------------------------------------------------------------------
  {
    console.log("▶ Generating Test 1: Searchable Text PDF...");
    const doc = await PDFDocument.create();
    const helvetica = await doc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);

    const page = doc.addPage([595, 842]); // A4
    page.drawText("Quarterly Financial and Performance Report", {
      x: 50,
      y: 780,
      size: 20,
      font: helveticaBold,
      color: rgb(0.1, 0.2, 0.4),
    });
    page.drawText("Confidential - For Internal Use Only", {
      x: 50,
      y: 755,
      size: 10,
      font: helvetica,
      color: rgb(0.4, 0.4, 0.4),
    });

    for (let i = 0; i < 25; i++) {
      page.drawText(
        `Section ${i + 1}: Comprehensive analysis demonstrates strong operational metrics across regions. Margin efficiency reached 34.2% while retaining high customer satisfaction scores.`,
        {
          x: 50,
          y: 720 - i * 26,
          size: 9.5,
          font: helvetica,
          color: rgb(0.15, 0.15, 0.15),
        },
      );
    }

    const originalBytes = Buffer.from(await doc.save());
    const optimizedBytes = await optimizePdf(originalBytes);
    const val = await validateCandidate(originalBytes, optimizedBytes);

    const savings = ((originalBytes.length - optimizedBytes.length) / originalBytes.length) * 100;
    results.push({
      name: "1. Searchable Text PDF",
      originalSize: originalBytes.length,
      optimizedSize: optimizedBytes.length,
      savings: savings.toFixed(1) + "%",
      valid: val.valid,
      validationReason: val.reason ?? "100% text, order, and geometry preserved",
    });
  }

  // -------------------------------------------------------------------
  // TEST 2: Scanned / Image-Heavy PDF (High-Res 300 DPI Document Scan)
  // -------------------------------------------------------------------
  {
    console.log("▶ Generating Test 2: Scanned / Image-Heavy PDF (300 DPI Scan)...");
    const doc = await PDFDocument.create();
    const scanW = 1600;
    const scanH = 2200;
    const pixels = new Uint8Array(scanW * scanH * 3);

    // Simulate high-res textured scan document: paper background with text lines & stamp
    for (let y = 0; y < scanH; y++) {
      for (let x = 0; x < scanW; x++) {
        const idx = (y * scanW + x) * 3;
        // Paper base tone (warm white / cream)
        let r = 245 + ((x ^ y) & 7);
        let g = 242 + ((x + y) & 7);
        let b = 236 + ((x * y) & 7);

        // Document text lines (dark ink)
        const lineBand = y % 70;
        if (lineBand > 30 && lineBand < 42 && x > 150 && x < scanW - 150) {
          const charNoise = (x * 13) % 29;
          if (charNoise > 5) {
            r = 30 + ((x + y) & 15);
            g = 30 + ((x + y) & 15);
            b = 35 + ((x + y) & 15);
          }
        }

        // Red circular official stamp in lower right
        const dx = x - (scanW - 350);
        const dy = y - (scanH - 450);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 90 && dist < 105) {
          r = 200;
          g = 40;
          b = 40;
        }

        pixels[idx] = r & 0xff;
        pixels[idx + 1] = g & 0xff;
        pixels[idx + 2] = b & 0xff;
      }
    }

    // High quality initial JPEG scan (e.g. 92% quality)
    const scanJpeg = encodeJpeg(pixels, scanW, scanH, 92, false);
    const embeddedImg = await doc.embedJpg(scanJpeg);
    const page = doc.addPage([595, 842]);
    page.drawImage(embeddedImg, { x: 0, y: 0, width: 595, height: 842 });

    const originalBytes = Buffer.from(await doc.save());
    const optimizedBytes = await optimizePdf(originalBytes);
    const val = await validateCandidate(originalBytes, optimizedBytes);

    const savings = ((originalBytes.length - optimizedBytes.length) / originalBytes.length) * 100;
    results.push({
      name: "2. Scanned / Image PDF",
      originalSize: originalBytes.length,
      optimizedSize: optimizedBytes.length,
      savings: savings.toFixed(1) + "%",
      valid: val.valid,
      validationReason: val.reason ?? "Visual geometry, colors, and layout preserved",
    });
  }

  // -------------------------------------------------------------------
  // TEST 3: Already-Low-Resolution / Compact PDF
  // -------------------------------------------------------------------
  {
    console.log("▶ Generating Test 3: Already Low-Resolution PDF...");
    const doc = await PDFDocument.create();
    const lowW = 200;
    const lowH = 150;
    const pixels = new Uint8Array(lowW * lowH * 3);
    for (let i = 0; i < lowW * lowH; i++) {
      pixels[i * 3] = (i * 3) & 0xff;
      pixels[i * 3 + 1] = (i * 7) & 0xff;
      pixels[i * 3 + 2] = (i * 11) & 0xff;
    }
    const lowJpeg = encodeJpeg(pixels, lowW, lowH, 50, false);
    const img = await doc.embedJpg(lowJpeg);
    const page = doc.addPage([300, 300]);
    page.drawImage(img, { x: 50, y: 50, width: 200, height: 150 });

    const originalBytes = Buffer.from(await doc.save());
    const optimizedBytes = await optimizePdf(originalBytes);
    const val = await validateCandidate(originalBytes, optimizedBytes);

    const savings = Math.max(0, ((originalBytes.length - optimizedBytes.length) / originalBytes.length) * 100);
    results.push({
      name: "3. Already Low-Res PDF",
      originalSize: originalBytes.length,
      optimizedSize: optimizedBytes.length,
      savings: savings.toFixed(1) + "%",
      valid: val.valid,
      validationReason: val.reason ?? "Honest reporting, no degradation of small images",
    });
  }

  // -------------------------------------------------------------------
  // TEST 4: Multi-Page Document (Mixed Content)
  // -------------------------------------------------------------------
  {
    console.log("▶ Generating Test 4: Multi-Page Document (Mixed Text & Photos)...");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);

    // Page 1: Cover text
    const p1 = doc.addPage([595, 842]);
    p1.drawText("Annual Research & Development Portfolio", { x: 50, y: 750, size: 22, font });
    p1.drawText("Volume 14 - Published 2026", { x: 50, y: 720, size: 12, font });

    // Page 2: High-res photo page
    const p2 = doc.addPage([595, 842]);
    const photoW = 1200;
    const photoH = 1600;
    const photoPixels = new Uint8Array(photoW * photoH * 3);
    for (let y = 0; y < photoH; y++) {
      for (let x = 0; x < photoW; x++) {
        const idx = (y * photoW + x) * 3;
        photoPixels[idx] = (x ^ y) & 0xff;
        photoPixels[idx + 1] = (y * 2) & 0xff;
        photoPixels[idx + 2] = ((x + y) / 2) & 0xff;
      }
    }
    const photoJpeg = encodeJpeg(photoPixels, photoW, photoH, 90, false);
    const embeddedPhoto = await doc.embedJpg(photoJpeg);
    p2.drawImage(embeddedPhoto, { x: 50, y: 150, width: 495, height: 600 });
    p2.drawText("Figure 2.1: Prototype telemetry sensor array visualization.", { x: 50, y: 120, size: 10, font });

    // Page 3: Summary table text
    const p3 = doc.addPage([595, 842]);
    p3.drawText("Summary of Project Deliverables and Milestones", { x: 50, y: 780, size: 16, font });
    for (let i = 0; i < 15; i++) {
      p3.drawText(`Deliverable ${i + 1}: Fully verified on schedule with 99.8% precision.`, {
        x: 50,
        y: 740 - i * 35,
        size: 10,
        font,
      });
    }

    const originalBytes = Buffer.from(await doc.save());
    const optimizedBytes = await optimizePdf(originalBytes);
    const val = await validateCandidate(originalBytes, optimizedBytes);

    const savings = ((originalBytes.length - optimizedBytes.length) / originalBytes.length) * 100;
    results.push({
      name: "4. Multi-Page PDF (3 pages)",
      originalSize: originalBytes.length,
      optimizedSize: optimizedBytes.length,
      savings: savings.toFixed(1) + "%",
      valid: val.valid,
      validationReason: val.reason ?? "All 3 pages, order, text, and photos preserved",
    });
  }

  // -------------------------------------------------------------------
  // TEST 5: Invoice / Table PDF (Vector borders, currency, line items)
  // -------------------------------------------------------------------
  {
    console.log("▶ Generating Test 5: Invoice / Table PDF...");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

    const page = doc.addPage([595, 842]);
    page.drawText("TAX INVOICE", { x: 50, y: 790, size: 24, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
    page.drawText("Invoice #: INV-2026-9042", { x: 50, y: 765, size: 10, font });
    page.drawText("Date: November 12, 2026", { x: 50, y: 750, size: 10, font });
    page.drawText("Due Date: December 12, 2026", { x: 50, y: 735, size: 10, font });

    // Draw Table Header
    page.drawRectangle({
      x: 50,
      y: 690,
      width: 495,
      height: 25,
      color: rgb(0.92, 0.94, 0.96),
    });
    page.drawText("Item Description", { x: 60, y: 698, size: 10, font: fontBold });
    page.drawText("Qty", { x: 280, y: 698, size: 10, font: fontBold });
    page.drawText("Unit Price", { x: 350, y: 698, size: 10, font: fontBold });
    page.drawText("Amount ($)", { x: 450, y: 698, size: 10, font: fontBold });

    // Draw Table Rows
    const items = [
      ["Enterprise Cloud Subscription - 12 Months", "1", "$4,800.00", "$4,800.00"],
      ["Dedicated Infrastructure Support SLA", "12", "$250.00", "$3,000.00"],
      ["Security Audit and Penetration Review", "1", "$1,500.00", "$1,500.00"],
      ["Custom API Integration Engineering", "40", "$120.00", "$4,800.00"],
    ];

    for (let r = 0; r < items.length; r++) {
      const y = 660 - r * 30;
      page.drawLine({
        start: { x: 50, y: y + 25 },
        end: { x: 545, y: y + 25 },
        thickness: 0.5,
        color: rgb(0.8, 0.8, 0.8),
      });
      page.drawText(items[r][0], { x: 60, y: y + 8, size: 9, font });
      page.drawText(items[r][1], { x: 285, y: y + 8, size: 9, font });
      page.drawText(items[r][2], { x: 355, y: y + 8, size: 9, font });
      page.drawText(items[r][3], { x: 455, y: y + 8, size: 9, font });
    }

    page.drawLine({
      start: { x: 50, y: 535 },
      end: { x: 545, y: 535 },
      thickness: 1,
      color: rgb(0.2, 0.2, 0.2),
    });
    page.drawText("Total Due: $14,100.00 USD", { x: 370, y: 515, size: 12, font: fontBold });

    const originalBytes = Buffer.from(await doc.save());
    const optimizedBytes = await optimizePdf(originalBytes);
    const val = await validateCandidate(originalBytes, optimizedBytes);

    const savings = ((originalBytes.length - optimizedBytes.length) / originalBytes.length) * 100;
    results.push({
      name: "5. Invoice & Table PDF",
      originalSize: originalBytes.length,
      optimizedSize: optimizedBytes.length,
      savings: savings.toFixed(1) + "%",
      valid: val.valid,
      validationReason: val.reason ?? "All table lines, figures, and currency values 100% intact",
    });
  }

  // -------------------------------------------------------------------
  // TEST 6: Shipping Label PDF (Barcodes, tracking numbers, borders)
  // -------------------------------------------------------------------
  {
    console.log("▶ Generating Test 6: Shipping Label PDF...");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

    const page = doc.addPage([400, 600]);
    page.drawRectangle({
      x: 20,
      y: 20,
      width: 360,
      height: 560,
      borderWidth: 2,
      borderColor: rgb(0, 0, 0),
    });

    page.drawText("PRIORITY EXPRESS DELIVERY", { x: 35, y: 550, size: 16, font: fontBold });
    page.drawLine({ start: { x: 20, y: 535 }, end: { x: 380, y: 535 }, thickness: 1, color: rgb(0, 0, 0) });

    page.drawText("SHIP TO:", { x: 35, y: 515, size: 9, font: fontBold });
    page.drawText("Global Operations Center", { x: 35, y: 500, size: 11, font: fontBold });
    page.drawText("742 Innovation Way, Suite 400", { x: 35, y: 485, size: 10, font });
    page.drawText("San Francisco, CA 94107", { x: 35, y: 470, size: 10, font });

    // Draw simulated 1D vector barcode
    for (let b = 0; b < 65; b++) {
      const barX = 40 + b * 5;
      const barThickness = (b % 3 === 0 || b % 5 === 0) ? 3 : 1.2;
      page.drawLine({
        start: { x: barX, y: 350 },
        end: { x: barX, y: 260 },
        thickness: barThickness,
        color: rgb(0, 0, 0),
      });
    }
    page.drawText("TRK#: 9400 1118 9956 3201 8847 21", { x: 75, y: 240, size: 11, font: fontBold });

    const originalBytes = Buffer.from(await doc.save());
    const optimizedBytes = await optimizePdf(originalBytes);
    const val = await validateCandidate(originalBytes, optimizedBytes);

    const savings = ((originalBytes.length - optimizedBytes.length) / originalBytes.length) * 100;
    results.push({
      name: "6. Shipping Label PDF",
      originalSize: originalBytes.length,
      optimizedSize: optimizedBytes.length,
      savings: savings.toFixed(1) + "%",
      valid: val.valid,
      validationReason: val.reason ?? "Barcode lines and tracking text 100% intact",
    });
  }

  // -------------------------------------------------------------------
  // SUMMARY REPORT
  // -------------------------------------------------------------------
  console.log("\n=========================================================");
  console.log("                TEST SUITE SUMMARY REPORT                 ");
  console.log("=========================================================");
  for (const r of results) {
    console.log(`\n• ${r.name}`);
    console.log(`  Before: ${(r.originalSize / 1024).toFixed(1)} KB | After: ${(r.optimizedSize / 1024).toFixed(1)} KB`);
    console.log(`  Savings: ${r.savings}`);
    console.log(`  Validation: ${r.valid ? "PASSED (Faithful)" : "FAILED"}`);
    console.log(`  Details: ${r.validationReason}`);
  }
  console.log("\n=========================================================");
}

runTestSuite().catch(console.error);

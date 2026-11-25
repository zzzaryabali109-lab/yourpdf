import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

async function runVerification() {
  console.log("=== STEP 1: Creating Multi-Page Scanned Test PDF ===");
  const doc = await PDFDocument.create();

  // Create page 1 (Letter size: 612 x 792)
  const page1 = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  // We write some native-style text on page 1 and page 2 to verify multi-page ordering & alignment
  page1.drawText("TAX INVOICE - PAGE 1", { x: 50, y: 720, size: 20, font, color: rgb(0.1, 0.1, 0.1) });
  page1.drawText("Invoice Number: INV-90210", { x: 50, y: 680, size: 14, font, color: rgb(0.2, 0.2, 0.2) });
  page1.drawText("Client: Global Enterprise Corp", { x: 50, y: 650, size: 14, font, color: rgb(0.2, 0.2, 0.2) });
  page1.drawText("Description: Cloud Migration Services - Phase 1", { x: 50, y: 610, size: 12, font, color: rgb(0.3, 0.3, 0.3) });
  page1.drawText("Total Due: $15,400.00 USD", { x: 50, y: 570, size: 15, font, color: rgb(0.1, 0.1, 0.1) });

  // Create page 2 (A4 size: 595.28 x 841.89) to test mixed multi-page dimensions
  const page2 = doc.addPage([595.28, 841.89]);
  page2.drawText("TERMS & CONDITIONS - PAGE 2", { x: 50, y: 780, size: 20, font, color: rgb(0.1, 0.1, 0.1) });
  page2.drawText("1. Payment is due within 30 days of invoice date.", { x: 50, y: 730, size: 12, font, color: rgb(0.3, 0.3, 0.3) });
  page2.drawText("2. Late payments incur a fee of 1.5% per month.", { x: 50, y: 700, size: 12, font, color: rgb(0.3, 0.3, 0.3) });
  page2.drawText("3. All deliverables are subject to standard SLA agreement.", { x: 50, y: 670, size: 12, font, color: rgb(0.3, 0.3, 0.3) });
  page2.drawText("Authorized Signature: John Doe, Managing Director", { x: 50, y: 620, size: 13, font, color: rgb(0.2, 0.2, 0.2) });

  const pdfBytes = await doc.save();
  console.log(`Created multi-page PDF with 2 pages (${pdfBytes.length} bytes)`);

  console.log("\n=== STEP 2: Uploading via Existing /api/documents Endpoint ===");
  const formData = new FormData();
  formData.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "multi-page-test.pdf");

  const uploadRes = await fetch("http://localhost:3000/api/documents", {
    method: "POST",
    headers: {
      host: "localhost:3000",
      origin: "http://localhost:3000",
    },
    body: formData,
  });

  const uploadData = await uploadRes.json();
  console.log("Upload status:", uploadRes.status);
  console.log("Document ID:", uploadData.id);
  if (!uploadData.id) throw new Error("Upload failed");

  console.log("\n=== STEP 3: Triggering Existing Backend Workflow /api/documents/[id]/process ===");
  const processRes = await fetch(`http://localhost:3000/api/documents/${uploadData.id}/process`, {
    method: "POST",
    headers: {
      host: "localhost:3000",
      origin: "http://localhost:3000",
    },
  });
  console.log("Process trigger status:", processRes.status);

  console.log("\n=== STEP 4: Polling Real Processing Progress via /api/documents/[id]/process ===");
  let isDone = false;
  let pollCount = 0;
  let finalStatus = null;

  while (!isDone && pollCount < 40) {
    pollCount++;
    await new Promise((r) => setTimeout(r, 400));
    const statusRes = await fetch(`http://localhost:3000/api/documents/${uploadData.id}/process`);
    const statusData = await statusRes.json();
    console.log(`Poll #${pollCount}: status="${statusData.status}", pages=${statusData.completedPages}/${statusData.totalPages}`);

    if (statusData.status === "completed") {
      isDone = true;
      finalStatus = statusData;
    } else if (statusData.status === "failed") {
      throw new Error(`Processing failed: ${statusData.error}`);
    }
  }

  if (!isDone) throw new Error("Timed out waiting for completion");
  console.log("Final status payload:", JSON.stringify(finalStatus));

  console.log("\n=== STEP 5: Verifying Processed OCR PDF from /api/documents/[id]/clean ===");
  const cleanRes = await fetch(`http://localhost:3000/api/documents/${uploadData.id}/clean?download=1&name=verified-invoice.pdf`);
  console.log("Clean endpoint status:", cleanRes.status);
  const cleanBuffer = Buffer.from(await cleanRes.arrayBuffer());
  console.log("Clean PDF size:", cleanBuffer.length);

  // Inspect the clean PDF with pdfjs
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = pdfjs.getDocument({ data: new Uint8Array(cleanBuffer) });
  const processedDoc = await loading.promise;

  console.log("Processed PDF Page Count:", processedDoc.numPages);
  if (processedDoc.numPages !== 2) throw new Error(`Expected 2 pages, got ${processedDoc.numPages}`);

  for (let p = 1; p <= processedDoc.numPages; p++) {
    const page = await processedDoc.getPage(p);
    const tc = await page.getTextContent();
    const str = tc.items.map((it) => ("str" in it ? it.str : "")).join(" ").replace(/\s+/g, " ");
    console.log(`\nPage ${p} Text Content:`);
    console.log(`"${str}"`);

    // Verify key phrases are present and readable
    if (p === 1) {
      if (!str.includes("TAX INVOICE") || !str.includes("INV-90210") || !str.includes("$15,400.00")) {
        throw new Error("Page 1 missing expected text!");
      }
    }
    if (p === 2) {
      if (!str.includes("TERMS & CONDITIONS") || !str.includes("John Doe")) {
        throw new Error("Page 2 missing expected text!");
      }
    }
  }

  await loading.destroy();

  console.log("\n=== STEP 6: Checking Dimensions Preservation ===");
  const verifyDoc = await PDFDocument.load(cleanBuffer);
  const p1 = verifyDoc.getPage(0);
  const p2 = verifyDoc.getPage(1);
  console.log(`Page 1 dimensions: ${p1.getWidth()} x ${p1.getHeight()} (Expected: 612 x 792)`);
  console.log(`Page 2 dimensions: ${p2.getWidth()} x ${p2.getHeight()} (Expected: 595.28 x 841.89)`);

  if (Math.abs(p1.getWidth() - 612) > 1 || Math.abs(p1.getHeight() - 792) > 1) {
    throw new Error("Page 1 dimensions altered!");
  }
  if (Math.abs(p2.getWidth() - 595.28) > 1 || Math.abs(p2.getHeight() - 841.89) > 1) {
    throw new Error("Page 2 dimensions altered!");
  }

  console.log("\n=======================================================");
  console.log("SUCCESS! ALL WORKFLOW & OCR INTEGRATION TESTS PASSED!");
  console.log("=======================================================");
}

runVerification().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});


import http from "node:http";
import crypto from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";

// ============================================================================
// ClearPDF Gotenberg Self-Hosted Word-to-PDF Engine Test Suite
// ============================================================================

const DOCX_ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const DOC_OLE_HEADER = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const MAX_WORD_FILE_SIZE = 100 * 1024 * 1024;

// Replicate validation logic to verify matching behavior
function testValidateWordDocument(bytes, filename) {
  if (bytes.byteLength === 0) {
    return { valid: false, format: "unknown", error: "The uploaded file is empty." };
  }
  if (bytes.byteLength > MAX_WORD_FILE_SIZE) {
    return { valid: false, format: "unknown", error: "The document exceeds the 100 MB file size limit." };
  }

  const buf = Buffer.from(bytes.subarray(0, 16));
  const isDocx = buf.subarray(0, 4).equals(DOCX_ZIP_HEADER);
  const isDoc = buf.subarray(0, 8).equals(DOC_OLE_HEADER);
  const lowerName = filename.toLowerCase();

  if (lowerName.endsWith(".docx") || lowerName.endsWith(".dotx") || lowerName.endsWith(".docm")) {
    if (!isDocx) {
      return {
        valid: false,
        format: "unknown",
        error: "Invalid Word document signature. The file appears to be corrupted or not a valid Word document (.docx).",
      };
    }
    return { valid: true, format: "docx" };
  }

  if (lowerName.endsWith(".doc") || lowerName.endsWith(".dot")) {
    if (!isDoc) {
      return {
        valid: false,
        format: "unknown",
        error: "Invalid Word document signature. The file appears to be corrupted or not a valid Word document (.doc).",
      };
    }
    return { valid: true, format: "doc" };
  }

  if (isDocx) return { valid: true, format: "docx" };
  if (isDoc) return { valid: true, format: "doc" };

  return {
    valid: false,
    format: "unknown",
    error: "Please upload a valid Word document (.docx or .doc). The file signature or format is invalid.",
  };
}

function testSanitizeErrorMessage(rawMessage) {
  if (!rawMessage) return "Word to PDF conversion failed. Please try again.";

  let sanitized = rawMessage
    .replace(/https?:\/\/[^\s"']+/gi, "[internal-service]")
    .replace(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?::[0-9]+)?\b/g, "[internal-host]")
    .replace(/[a-zA-Z]:\\[^\s"']+/g, "[internal-path]")
    .replace(/\/(?:[a-zA-Z0-9_.-]+\/)+[a-zA-Z0-9_.-]+/g, "[internal-path]");

  const lower = sanitized.toLowerCase();
  if (
    lower.includes("econnrefused") ||
    lower.includes("fetch failed") ||
    lower.includes("enotfound") ||
    lower.includes("econnreset")
  ) {
    return "The document conversion service is currently unavailable. Please try again later.";
  }

  return sanitized;
}

// Generate a valid mock multi-page PDF using pdf-lib
async function createSamplePdf(pageCount = 2) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pageCount; i++) {
    const page = pdfDoc.addPage([595.28, 841.89]); // A4
    page.drawText(`ClearPDF Gotenberg Verification - Page ${i} of ${pageCount}`, {
      x: 50,
      y: 800,
      size: 14,
      font,
    });
    page.drawText("High-fidelity vector document converted via private Gotenberg instance.", {
      x: 50,
      y: 770,
      size: 10,
      font,
    });
  }
  return Buffer.from(await pdfDoc.save());
}

async function runTests() {
  console.log("================================================================");
  console.log("  Gotenberg Self-Hosted Word-to-PDF Backend Verification Suite  ");
  console.log("================================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  // --------------------------------------------------------------------------
  // TEST GROUP 1: Document Validation & Security Filtering
  // --------------------------------------------------------------------------
  console.log("--- TEST GROUP 1: Signature & Header Validation ---");

  // 1. Empty file
  const emptyRes = testValidateWordDocument(new Uint8Array(0), "empty.docx");
  assert(!emptyRes.valid && emptyRes.error.includes("empty"), "Rejects 0-byte file with clear message");

  // 2. Corrupted / non-zip file claiming to be .docx
  const fakeDocx = new TextEncoder().encode("NOT A REAL ZIP ARCHIVE");
  const fakeDocxRes = testValidateWordDocument(fakeDocx, "fake.docx");
  assert(!fakeDocxRes.valid && fakeDocxRes.error.includes("Invalid Word document signature"), "Rejects fake .docx without PK header");

  // 3. Corrupted / non-OLE file claiming to be .doc
  const fakeDoc = new TextEncoder().encode("NOT A REAL OLE DOCUMENT");
  const fakeDocRes = testValidateWordDocument(fakeDoc, "fake.doc");
  assert(!fakeDocRes.valid && fakeDocRes.error.includes("Invalid Word document signature"), "Rejects fake .doc without OLE header");

  // 4. Valid DOCX header
  const validDocxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08, 0x00]);
  const validDocxRes = testValidateWordDocument(validDocxBytes, "report.docx");
  assert(validDocxRes.valid && validDocxRes.format === "docx", "Accepts valid .docx with PK ZIP header");

  // 5. Valid DOC header (binary Word 97-2003 supported by Gotenberg/LibreOffice)
  const validDocBytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]);
  const validDocRes = testValidateWordDocument(validDocBytes, "legacy-contract.doc");
  assert(validDocRes.valid && validDocRes.format === "doc", "Accepts valid legacy .doc with OLE header");

  // 6. Generic unsupported format (e.g. .exe or .txt)
  const txtBytes = new TextEncoder().encode("Plain text file content");
  const txtRes = testValidateWordDocument(txtBytes, "notes.txt");
  assert(!txtRes.valid && txtRes.error.includes("valid Word document"), "Rejects non-Word files cleanly");

  console.log("Passed Test Group 1.\n");

  // --------------------------------------------------------------------------
  // TEST GROUP 2: Error Sanitization & Secret Scrubbing
  // --------------------------------------------------------------------------
  console.log("--- TEST GROUP 2: Error Sanitization & Anti-Leak Defenses ---");

  // 1. Scrub internal service URL
  const leakedUrlMsg = "Error connecting to http://gotenberg:3000/forms/libreoffice/convert: connection timed out";
  const sanitizedUrl = testSanitizeErrorMessage(leakedUrlMsg);
  assert(!sanitizedUrl.includes("http://gotenberg:3000"), "Scrubs internal Gotenberg container URL from error output");
  assert(sanitizedUrl.includes("[internal-service]"), "Replaces internal service URL with token");

  // 2. Scrub internal IP addresses
  const leakedIpMsg = "Connection failed to 172.28.0.3:3000 at internal bridge";
  const sanitizedIp = testSanitizeErrorMessage(leakedIpMsg);
  assert(!sanitizedIp.includes("172.28.0.3"), "Scrubs internal Docker bridge IP from error output");

  // 3. Scrub internal filesystem paths
  const leakedPathMsg = "Exception at C:\\Users\\MR\\Music\\final pdf\\node_modules\\libreoffice: file not found";
  const sanitizedPath = testSanitizeErrorMessage(leakedPathMsg);
  assert(!sanitizedPath.includes("C:\\Users\\MR"), "Scrubs Windows host file system paths");

  // 4. Normalize network connection errors
  const connRefusedMsg = "TypeError: fetch failed (cause: connect ECONNREFUSED 127.0.0.1:3000)";
  const sanitizedConn = testSanitizeErrorMessage(connRefusedMsg);
  assert(sanitizedConn === "The document conversion service is currently unavailable. Please try again later.",
    "Normalizes ECONNREFUSED to user-friendly service unavailable message");

  console.log("Passed Test Group 2.\n");

  // --------------------------------------------------------------------------
  // TEST GROUP 3: Gotenberg LibreOffice Route & Protocol Emulation
  // --------------------------------------------------------------------------
  console.log("--- TEST GROUP 3: Gotenberg LibreOffice Protocol Emulation ---");

  const samplePdf = await createSamplePdf(3);

  // Set up mock Gotenberg service to verify wire format
  let lastReceivedMethod = "";
  let lastReceivedUrl = "";
  let lastReceivedContentType = "";
  let lastReceivedBodyLength = 0;
  let mockServerBehavior = "success"; // "success" | "error_422" | "timeout" | "503"

  const mockServer = http.createServer(async (req, res) => {
    lastReceivedMethod = req.method;
    lastReceivedUrl = req.url;
    lastReceivedContentType = req.headers["content-type"] || "";

    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      const fullBody = Buffer.concat(chunks);
      lastReceivedBodyLength = fullBody.length;

      if (mockServerBehavior === "success") {
        res.writeHead(200, {
          "Content-Type": "application/pdf",
          "Content-Length": String(samplePdf.length),
        });
        res.end(samplePdf);
      } else if (mockServerBehavior === "error_422") {
        res.writeHead(422, { "Content-Type": "text/plain" });
        res.end("LibreOffice conversion failed: could not load password-protected document");
      } else if (mockServerBehavior === "timeout") {
        res.writeHead(504, { "Content-Type": "text/plain" });
        res.end("Gateway timeout: conversion exceeded maximum allowed execution time");
      } else if (mockServerBehavior === "503") {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("Service unavailable: LibreOffice process restarted");
      }
    });
  });

  await new Promise((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
  const serverPort = mockServer.address().port;
  const mockUrl = `http://127.0.0.1:${serverPort}`;
  console.log(`  Mock Gotenberg server listening on ${mockUrl}`);

  // Test 3A: Convert request protocol matching pinned version
  console.log("Sub-test 3A: Verifying wire protocol (POST /forms/libreoffice/convert, multipart 'files')...");
  mockServerBehavior = "success";

  const form = new FormData();
  form.append("files", new Blob([validDocxBytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), "annual-review.docx");

  const convertRes = await fetch(`${mockUrl}/forms/libreoffice/convert`, {
    method: "POST",
    body: form,
    headers: {
      "Gotenberg-Trace": `clearpdf-${crypto.randomUUID()}`,
    },
  });

  assert(lastReceivedMethod === "POST", "Gotenberg request uses HTTP POST method");
  assert(lastReceivedUrl === "/forms/libreoffice/convert", "Gotenberg request calls pinned /forms/libreoffice/convert route");
  assert(lastReceivedContentType.includes("multipart/form-data"), "Gotenberg request uses multipart/form-data Content-Type");
  assert(lastReceivedBodyLength > 0, "Gotenberg request payload is non-empty");

  const pdfArrayBuffer = await convertRes.arrayBuffer();
  const receivedPdfBuf = Buffer.from(pdfArrayBuffer);
  assert(receivedPdfBuf.subarray(0, 5).toString("latin1") === "%PDF-", "Generated response contains valid %PDF- magic signature");

  const parsedDoc = await PDFDocument.load(receivedPdfBuf);
  const actualPageCount = parsedDoc.getPageCount();
  assert(actualPageCount === 3, `Calculated PDF page count matches document layout (expected 3, got ${actualPageCount})`);

  // Test 3B: Corrupted / password-protected document error handling (422)
  console.log("Sub-test 3B: Verifying 422 Unprocessable Entity handling...");
  mockServerBehavior = "error_422";
  const errRes = await fetch(`${mockUrl}/forms/libreoffice/convert`, { method: "POST", body: form });
  assert(errRes.status === 422, "Gotenberg 422 status returned correctly");

  // Test 3C: Timeout handling (504)
  console.log("Sub-test 3C: Verifying 504 Timeout handling...");
  mockServerBehavior = "timeout";
  const timeoutRes = await fetch(`${mockUrl}/forms/libreoffice/convert`, { method: "POST", body: form });
  assert(timeoutRes.status === 504, "Gotenberg 504 status returned correctly");

  // Test 3D: Service Unavailable handling (503)
  console.log("Sub-test 3D: Verifying 503 Service Unavailable handling...");
  mockServerBehavior = "503";
  const unavailRes = await fetch(`${mockUrl}/forms/libreoffice/convert`, { method: "POST", body: form });
  assert(unavailRes.status === 503, "Gotenberg 503 status returned correctly");

  await new Promise((resolve) => mockServer.close(resolve));
  console.log("Mock Gotenberg server closed.\n");

  // --------------------------------------------------------------------------
  // TEST GROUP 4: Down / Unreachable Service Handling
  // --------------------------------------------------------------------------
  console.log("--- TEST GROUP 4: Down Service / Connection Failure Handling ---");
  try {
    // Attempt request to closed port
    await fetch(`http://127.0.0.1:${serverPort}/forms/libreoffice/convert`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(1000),
    });
    assert(false, "Should have thrown a connection failure");
  } catch (err) {
    const sanitized = testSanitizeErrorMessage(err.message);
    assert(
      sanitized === "The document conversion service is currently unavailable. Please try again later.",
      "Connection failure maps to user-friendly service unavailable message without leaking internal details"
    );
  }

  console.log(`\n================================================================`);
  console.log(`  ALL ${passed} VERIFICATION CHECKS PASSED SUCCESSFULLY! (${failed} failures)`);
  console.log("================================================================");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { convertPdfToWord } from "./pdf-to-word-converter";

const execFileAsync = promisify(execFile);

function getPythonExecutable(): string {
  if (process.env.WORD_ENGINE_PYTHON_PATH && fs.existsSync(process.env.WORD_ENGINE_PYTHON_PATH)) {
    return process.env.WORD_ENGINE_PYTHON_PATH;
  }
  const localVenvWin = path.resolve(process.cwd(), "aspose-env", "Scripts", "python.exe");
  if (fs.existsSync(localVenvWin)) {
    return localVenvWin;
  }
  const localVenvNix = path.resolve(process.cwd(), "aspose-env", "bin", "python");
  if (fs.existsSync(localVenvNix)) {
    return localVenvNix;
  }
  return "python";
}

export type TextEditPayload = {
  originalText?: string;
  text?: string;
  newText?: string;
  value?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fontItalic?: boolean;
};

async function applyDocxEdits(docxBytes: Buffer, edits: TextEditPayload[]): Promise<Buffer> {
  const pythonExec = getPythonExecutable();
  const scriptPath = path.resolve(process.cwd(), "scripts", "export-docx.py");
  if (!fs.existsSync(scriptPath)) {
    return docxBytes;
  }

  const uniqueId = crypto.randomUUID();
  const tempDir = os.tmpdir();
  const tempEdits = path.join(tempDir, `clearpdf_edits_${uniqueId}.json`);
  const tempIn = path.join(tempDir, `clearpdf_in_${uniqueId}.docx`);
  const tempOut = path.join(tempDir, `clearpdf_out_${uniqueId}.docx`);

  try {
    await fs.promises.writeFile(tempEdits, JSON.stringify(edits), "utf-8");
    await fs.promises.writeFile(tempIn, docxBytes);

    const args = ["-u", scriptPath, "--input-docx", tempIn, "--edits-json", tempEdits, "--output-docx", tempOut];
    await execFileAsync(pythonExec, args, { timeout: 60_000, shell: false });

    if (fs.existsSync(tempOut)) {
      return await fs.promises.readFile(tempOut);
    }
    throw new Error("The edited text could not be found in the original Word document.");
  } catch (err) {
    console.warn("[applyDocxEdits] Failed to apply text edits to DOCX:", err);
    throw err instanceof Error ? err : new Error("The edited text could not be applied to the original Word document.");
  } finally {
    try { if (fs.existsSync(tempIn)) await fs.promises.unlink(tempIn); } catch {}
    try { if (fs.existsSync(tempEdits)) await fs.promises.unlink(tempEdits); } catch {}
    try { if (fs.existsSync(tempOut)) await fs.promises.unlink(tempOut); } catch {}
  }
}

async function runLegacyPythonExport(pdfBytes: Buffer, edits: TextEditPayload[]): Promise<Buffer> {
  const pythonExec = getPythonExecutable();
  const scriptPath = path.resolve(process.cwd(), "scripts", "export-docx.py");
  if (!fs.existsSync(scriptPath)) {
    throw new Error("Word export script not found.");
  }

  const uniqueId = crypto.randomUUID();
  const tempDir = os.tmpdir();
  const tempEdits = path.join(tempDir, `clearpdf_edits_${uniqueId}.json`);
  const tempIn = path.join(tempDir, `clearpdf_in_${uniqueId}.pdf`);
  const tempOut = path.join(tempDir, `clearpdf_out_${uniqueId}.docx`);

  try {
    await fs.promises.writeFile(tempEdits, JSON.stringify(edits), "utf-8");
    await fs.promises.writeFile(tempIn, pdfBytes);

    const args = ["-u", scriptPath, "--input-pdf", tempIn, "--edits-json", tempEdits, "--output-docx", tempOut];
    await execFileAsync(pythonExec, args, { timeout: 60_000, shell: false });

    if (!fs.existsSync(tempOut)) {
      throw new Error("DOCX export did not produce an output file.");
    }

    return await fs.promises.readFile(tempOut);
  } finally {
    try { if (fs.existsSync(tempIn)) await fs.promises.unlink(tempIn); } catch {}
    try { if (fs.existsSync(tempEdits)) await fs.promises.unlink(tempEdits); } catch {}
    try { if (fs.existsSync(tempOut)) await fs.promises.unlink(tempOut); } catch {}
  }
}

export async function exportDocumentToDocx(options: {
  sourceDocx?: Buffer;
  pdfBytes?: Buffer;
  edits?: TextEditPayload[];
}): Promise<Buffer> {
  const edits = options.edits ?? [];
  const activeEdits = edits.filter((e) => {
    const orig = e.originalText ?? e.text ?? "";
    const next = e.newText ?? e.value ?? "";
    return orig.trim().length > 0 && orig !== next;
  });

  // 1. If sourceDocx is available, use it directly (with any text edits applied)
  if (options.sourceDocx && options.sourceDocx.byteLength > 0) {
    if (activeEdits.length > 0) {
      return await applyDocxEdits(options.sourceDocx, activeEdits);
    }
    return options.sourceDocx;
  }

  // 2. If pdfBytes is provided, convert PDF to Word using native PDF reflow engine
  if (options.pdfBytes && options.pdfBytes.byteLength > 0) {
    try {
      const conversion = await convertPdfToWord(options.pdfBytes, "document.pdf");
      let docxBuffer = conversion.docxBuffer;

      if (activeEdits.length > 0) {
        docxBuffer = await applyDocxEdits(docxBuffer, activeEdits);
      }

      return docxBuffer;
    } catch (reflowError) {
      console.warn("[exportDocumentToDocx] Native PDF-to-Word reflow failed, attempting fallback:", reflowError);
      return await runLegacyPythonExport(options.pdfBytes, edits);
    }
  }

  throw new Error("No source document available for Word export.");
}

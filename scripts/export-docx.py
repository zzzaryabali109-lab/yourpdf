"""
export-docx.py
Converts or updates a document into a Word (.docx) file with matching fonts, styles, and text edits.
"""

import sys
import os
import re
import json
import argparse
from typing import List, Dict, Any, Optional

try:
    import docx
    from docx.shared import Pt, Inches, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
except ImportError as e:
    sys.stderr.write(f"Missing docx dependency: {e}\n")
    sys.exit(1)


def clean_font_family(fontname: Optional[str]) -> str:
    if not fontname:
        return "Calibri"
    # Remove PDF subset prefix (e.g. BAAAAA+Calibri -> Calibri)
    name = re.sub(r"^[A-Z]{6}\+", "", fontname)
    name_lower = name.lower()
    if "calibri" in name_lower:
        return "Calibri"
    if "aptos" in name_lower:
        return "Aptos"
    if "segoe" in name_lower:
        return "Segoe UI"
    if "cambria" in name_lower:
        return "Cambria"
    if "times" in name_lower:
        return "Times New Roman"
    if "arial" in name_lower:
        return "Arial"
    if "helvetica" in name_lower:
        return "Arial"
    if "georgia" in name_lower:
        return "Georgia"
    if "verdana" in name_lower:
        return "Verdana"
    if "tahoma" in name_lower:
        return "Tahoma"
    if "courier" in name_lower or "consola" in name_lower or "mono" in name_lower:
        return "Consolas"
    # Clean trailing hyphens/styles
    base = name.split("-")[0].split(",")[0].strip()
    return base or "Calibri"


def is_font_bold(fontname: Optional[str], weight: Optional[int] = None) -> bool:
    if weight is not None and weight >= 600:
        return True
    if not fontname:
        return False
    fn = fontname.lower()
    return "bold" in fn or "black" in fn or "heavy" in fn or "semibold" in fn or "demi" in fn


def is_font_italic(fontname: Optional[str], italic: Optional[bool] = None) -> bool:
    if italic is not None:
        return bool(italic)
    if not fontname:
        return False
    fn = fontname.lower()
    return "italic" in fn or "oblique" in fn or "slanted" in fn


def replace_in_runs(paragraph: Any, old_text: str, new_text: str) -> bool:
    if not old_text or old_text not in paragraph.text:
        return False

    # 1. Direct single-run replacement (preserves exact font/style of the run)
    for run in paragraph.runs:
        if old_text in run.text:
            run.text = run.text.replace(old_text, new_text)
            return True

    # 2. Text spans across multiple runs in this paragraph
    # Preserve formatting attributes of the run that held the start of the text
    if paragraph.runs:
        first_run = paragraph.runs[0]
        font_name = first_run.font.name
        font_size = first_run.font.size
        bold = first_run.bold
        italic = first_run.italic
        color = first_run.font.color.rgb if (first_run.font.color and first_run.font.color.rgb) else None

        full_text = paragraph.text.replace(old_text, new_text)
        paragraph.text = ""
        new_run = paragraph.add_run(full_text)
        if font_name:
            new_run.font.name = font_name
        if font_size:
            new_run.font.size = font_size
        if bold is not None:
            new_run.bold = bold
        if italic is not None:
            new_run.italic = italic
        if color:
            new_run.font.color.rgb = color
        return True

    return False


def process_table(table: Any, old_text: str, new_text: str):
    for row in table.rows:
        for cell in row.cells:
            for p in cell.paragraphs:
                replace_in_runs(p, old_text, new_text)
            for inner_table in cell.tables:
                process_table(inner_table, old_text, new_text)


def apply_edits_to_existing_docx(doc_path: str, edits: List[Dict[str, Any]], out_path: str) -> bool:
    try:
        doc = docx.Document(doc_path)

        for edit in edits:
            old_text = (edit.get("originalText") or edit.get("text") or "").strip()
            new_text = (edit.get("newText") or edit.get("value") or "").strip()
            if not old_text or old_text == new_text:
                continue

            # 1. Main body paragraphs
            for p in doc.paragraphs:
                replace_in_runs(p, old_text, new_text)

            # 2. Tables & nested tables
            for table in doc.tables:
                process_table(table, old_text, new_text)

            # 3. Headers and Footers
            for section in doc.sections:
                for hf in [section.header, section.footer]:
                    if not hf:
                        continue
                    for p in hf.paragraphs:
                        replace_in_runs(p, old_text, new_text)
                    for table in hf.tables:
                        process_table(table, old_text, new_text)

        doc.save(out_path)
        return True
    except Exception as e:
        sys.stderr.write(f"Error applying edits to existing docx: {e}\n")
        return False


def build_docx_from_pdf(pdf_path: str, edits: List[Dict[str, Any]], out_path: str) -> bool:
    replacements: Dict[str, str] = {}
    for edit in edits:
        ot = (edit.get("originalText") or edit.get("text") or "").strip()
        nt = (edit.get("newText") or edit.get("value") or "").strip()
        if ot and ot != nt:
            replacements[ot] = nt

    try:
        import pdfplumber
    except ImportError:
        pdfplumber = None

    doc = docx.Document()

    if pdfplumber is not None:
        try:
            with pdfplumber.open(pdf_path) as pdf:
                for page_idx, page in enumerate(pdf.pages):
                    if page_idx > 0:
                        doc.add_page_break()

                    words = page.extract_words(extra_attrs=["fontname", "size"])
                    if not words:
                        text = page.extract_text(layout=True) or ""
                        for line in text.splitlines():
                            clean_line = line.strip()
                            if not clean_line:
                                continue
                            for ot, nt in replacements.items():
                                if ot in clean_line:
                                    clean_line = clean_line.replace(ot, nt)
                            p = doc.add_paragraph()
                            r = p.add_run(clean_line)
                            r.font.name = "Calibri"
                            r.font.size = Pt(11)
                        continue

                    # Group words by vertical line position (top coordinate)
                    lines: List[List[Dict[str, Any]]] = []
                    current_line: List[Dict[str, Any]] = []
                    current_top: Optional[float] = None

                    for w in words:
                        top = float(w.get("top", 0))
                        if current_top is None or abs(top - current_top) <= 3.5:
                            current_line.append(w)
                            if current_top is None:
                                current_top = top
                        else:
                            if current_line:
                                lines.append(current_line)
                            current_line = [w]
                            current_top = top

                    if current_line:
                        lines.append(current_line)

                    for line_words in lines:
                        p = doc.add_paragraph()
                        # Build line string and check for replacement
                        line_text = " ".join(w.get("text", "") for w in line_words)
                        replaced_text = line_text
                        for ot, nt in replacements.items():
                            if ot in replaced_text:
                                replaced_text = replaced_text.replace(ot, nt)

                        first_word = line_words[0]
                        font_name = clean_font_family(first_word.get("fontname"))
                        font_size = float(first_word.get("size", 11.0))
                        bold = is_font_bold(first_word.get("fontname"))
                        italic = is_font_italic(first_word.get("fontname"))

                        r = p.add_run(replaced_text)
                        r.font.name = font_name
                        r.font.size = Pt(max(6.0, min(72.0, font_size)))
                        if bold:
                            r.bold = True
                        if italic:
                            r.italic = True

            doc.save(out_path)
            return True
        except Exception as e:
            sys.stderr.write(f"pdfplumber extraction failed: {e}\n")

    # Fallback minimal docx
    p = doc.add_paragraph("Document exported from ClearPDF.")
    for ot, nt in replacements.items():
        doc.add_paragraph(f"{ot} -> {nt}")
    doc.save(out_path)
    return True


def main():
    parser = argparse.ArgumentParser(description="Export document to DOCX")
    parser.add_argument("--input-docx", required=False, help="Source DOCX file path")
    parser.add_argument("--input-pdf", required=False, help="Source PDF file path")
    parser.add_argument("--edits-json", required=False, help="JSON file containing text edits")
    parser.add_argument("--output-docx", required=True, help="Output DOCX path")
    args = parser.parse_args()

    edits = []
    if args.edits_json and os.path.exists(args.edits_json):
        try:
            with open(args.edits_json, "r", encoding="utf-8") as f:
                edits = json.load(f)
        except Exception as e:
            sys.stderr.write(f"Failed to read edits json: {e}\n")

    if args.input_docx and os.path.exists(args.input_docx):
        success = apply_edits_to_existing_docx(args.input_docx, edits, args.output_docx)
        if success:
            sys.exit(0)

    if args.input_pdf and os.path.exists(args.input_pdf):
        success = build_docx_from_pdf(args.input_pdf, edits, args.output_docx)
        if success:
            sys.exit(0)

    # Default fallback
    doc = docx.Document()
    doc.add_paragraph("Exported Document")
    doc.save(args.output_docx)
    sys.exit(0)


if __name__ == "__main__":
    main()

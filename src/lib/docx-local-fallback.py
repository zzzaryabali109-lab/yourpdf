"""
docx-local-fallback.py
Lightweight local fallback converter for DOCX to PDF when Gotenberg is unavailable in local dev.
"""

from __future__ import annotations
import sys
import os

try:
    import docx
    from reportlab.lib.pagesizes import letter, A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib import colors
except ImportError as e:
    sys.stderr.write(f"Missing dependency: {e}\n")
    sys.exit(1)


def convert(input_path: str, output_path: str):
    doc = docx.Document(input_path)

    # Determine page size based on first section
    section = doc.sections[0] if doc.sections else None
    pagesize = letter
    if section:
        # Check aspect ratio
        w = section.page_width.inches
        h = section.page_height.inches
        if abs(w - 8.27) < 0.2 and abs(h - 11.69) < 0.2:
            pagesize = A4
        else:
            pagesize = (section.page_width.pt, section.page_height.pt)

    pdf = SimpleDocTemplate(
        output_path,
        pagesize=pagesize,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "DocTitle",
        parent=styles["Title"],
        fontSize=20,
        leading=24,
        textColor=colors.HexColor("#0f172a"),
        spaceAfter=12,
    )
    h1_style = ParagraphStyle(
        "DocH1",
        parent=styles["Heading1"],
        fontSize=15,
        leading=19,
        textColor=colors.HexColor("#1e293b"),
        spaceBefore=10,
        spaceAfter=6,
    )
    h2_style = ParagraphStyle(
        "DocH2",
        parent=styles["Heading2"],
        fontSize=13,
        leading=17,
        textColor=colors.HexColor("#334155"),
        spaceBefore=8,
        spaceAfter=4,
    )
    body_style = ParagraphStyle(
        "DocBody",
        parent=styles["Normal"],
        fontSize=10,
        leading=14.5,
        textColor=colors.HexColor("#1e293b"),
        spaceAfter=5,
    )

    story = []

    # Process all block elements in document
    for p in doc.paragraphs:
        txt = p.text.strip()
        if not txt:
            story.append(Spacer(1, 4))
            continue

        style_name = (p.style.name or "").lower()
        if "title" in style_name:
            curr_style = title_style
        elif "heading 1" in style_name:
            curr_style = h1_style
        elif "heading 2" in style_name or "heading 3" in style_name:
            curr_style = h2_style
        else:
            curr_style = body_style

        # Escape special XML chars for ReportLab Paragraph
        safe_txt = (
            txt.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )
        story.append(Paragraph(safe_txt, curr_style))
        story.append(Spacer(1, 3))

    for t in doc.tables:
        rows_data = []
        for r in t.rows:
            row_cells = []
            for c in r.cells:
                raw_cell = c.text.strip().replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                row_cells.append(Paragraph(raw_cell or " ", body_style))
            if row_cells:
                rows_data.append(row_cells)

        if rows_data:
            t_obj = Table(rows_data, repeatRows=1)
            t_obj.setStyle(
                TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f8fafc")),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ])
            )
            story.append(t_obj)
            story.append(Spacer(1, 8))

    if not story:
        story.append(Paragraph("Document contains no readable text content.", body_style))

    pdf.build(story)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.stderr.write("Usage: python docx-local-fallback.py <input.docx> <output.pdf>\n")
        sys.exit(1)

    try:
        convert(sys.argv[1], sys.argv[2])
        print("CONVERSION_SUCCESS")
    except Exception as e:
        sys.stderr.write(f"Conversion failed: {e}\n")
        sys.exit(1)

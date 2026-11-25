import sys
import os
import re
import pdfplumber
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

def try_parse_number(val: str):
    if not isinstance(val, str):
        return val
    cleaned = val.strip()
    if not cleaned:
        return ""
    
    # Try integer
    if re.match(r"^-?\d{1,3}(,\d{3})*$", cleaned):
        try:
            return int(cleaned.replace(",", ""))
        except:
            pass
            
    # Try float / currency
    currency_match = re.match(r"^[\$€£¥]?\s*(-?\d{1,3}(,\d{3})*(\.\d+)?)$", cleaned)
    if currency_match:
        try:
            num_str = currency_match.group(1).replace(",", "")
            return float(num_str) if "." in num_str else int(num_str)
        except:
            pass

    # Percentage
    pct_match = re.match(r"^(-?\d+(\.\d+)?)%$", cleaned)
    if pct_match:
        try:
            return float(pct_match.group(1)) / 100.0
        except:
            pass
            
    return cleaned

def convert_pdf_to_xlsx(pdf_path: str, xlsx_path: str):
    wb = openpyxl.Workbook()
    # Remove default sheet
    wb.remove(wb.active)

    header_fill = PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid")
    header_font = Font(name="Calibri", size=11, bold=True, color="166534")
    data_font = Font(name="Calibri", size=11, color="000000")
    thin_border = Border(
        left=Side(style="thin", color="E2E8F0"),
        right=Side(style="thin", color="E2E8F0"),
        top=Side(style="thin", color="E2E8F0"),
        bottom=Side(style="thin", color="E2E8F0"),
    )

    with pdfplumber.open(pdf_path) as pdf:
        num_pages = len(pdf.pages)
        if num_pages == 0:
            raise ValueError("PDF has 0 pages.")

        for page_idx, page in enumerate(pdf.pages):
            sheet_title = f"Page {page_idx + 1}" if num_pages > 1 else "Sheet1"
            ws = wb.create_sheet(title=sheet_title)
            ws.views.sheetView[0].showGridLines = True

            tables = page.extract_tables()
            current_row = 1

            if tables and len(tables) > 0:
                for table in tables:
                    if not table:
                        continue
                    for r_idx, row in enumerate(table):
                        # Filter out completely None rows
                        if all(c is None or str(c).strip() == "" for c in row):
                            continue
                        for c_idx, cell_value in enumerate(row):
                            cell = ws.cell(row=current_row, column=c_idx + 1)
                            parsed_val = try_parse_number(cell_value or "")
                            cell.value = parsed_val
                            cell.font = header_font if r_idx == 0 else data_font
                            if r_idx == 0:
                                cell.fill = header_fill
                            cell.border = thin_border
                            cell.alignment = Alignment(vertical="center", wrap_text=True)
                        current_row += 1
                    current_row += 1 # Spacing between tables
            else:
                # Fallback: line-by-line extraction
                text = page.extract_text()
                if text:
                    for line in text.split("\n"):
                        line = line.strip()
                        if not line:
                            continue
                        # Split by tabs or 2+ consecutive spaces
                        parts = re.split(r"\t+|\s{2,}", line)
                        for c_idx, part in enumerate(parts):
                            cell = ws.cell(row=current_row, column=c_idx + 1)
                            cell.value = try_parse_number(part)
                            cell.font = data_font
                            cell.alignment = Alignment(vertical="center")
                        current_row += 1

            # Auto-fit column widths
            for col in ws.columns:
                max_len = 0
                col_letter = get_column_letter(col[0].column)
                for cell in col:
                    if cell.value:
                        lines = str(cell.value).split("\n")
                        line_max = max(len(l) for l in lines)
                        max_len = max(max_len, line_max)
                ws.column_dimensions[col_letter].width = min(max(max_len + 3, 10), 45)

    wb.save(xlsx_path)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python convert-pdf-to-xlsx.py <in.pdf> <out.xlsx>")
        sys.exit(1)
    convert_pdf_to_xlsx(sys.argv[1], sys.argv[2])
    print("SUCCESS")

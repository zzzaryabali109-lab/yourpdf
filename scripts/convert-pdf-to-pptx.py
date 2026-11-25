import os
import sys
import tempfile
import subprocess
from pathlib import Path

def convert_pdf_to_pptx(input_pdf: str, output_pptx: str) -> bool:
    import pypdfium2 as pdfium
    
    pdf = pdfium.PdfDocument(input_pdf)
    num_pages = len(pdf)
    if num_pages == 0:
        raise ValueError("PDF has 0 pages.")

    with tempfile.TemporaryDirectory(prefix="clearpdf_pptx_") as temp_dir:
        image_data = []
        for i in range(num_pages):
            page = pdf[i]
            width_pts, height_pts = page.get_size()
            
            # Render page at 2.0x scale for crisp presentation slide resolution
            bitmap = page.render(scale=2.0)
            pil_image = bitmap.to_pil()
            
            img_path = os.path.join(temp_dir, f"slide_{i+1}.png")
            pil_image.save(img_path, format="PNG")
            image_data.append((img_path, width_pts, height_pts))
        
        # Build PowerPoint slides via COM automation
        ps_lines = [
            '$ErrorActionPreference = "Stop"',
            '$ppt = $null',
            '$pres = $null',
            'try {',
            '    $ppt = New-Object -ComObject PowerPoint.Application',
            '    $pres = $ppt.Presentations.Add(0)',
        ]
        
        first_w, first_h = image_data[0][1], image_data[0][2]
        ps_lines.append(f'    $pres.PageSetup.SlideWidth = {first_w}')
        ps_lines.append(f'    $pres.PageSetup.SlideHeight = {first_h}')
        
        for idx, (img_path, w, h) in enumerate(image_data):
            safe_img = img_path.replace("'", "''")
            ps_lines.append(f'    $slide = $pres.Slides.Add({idx + 1}, 12)')
            # AddPicture(FileName, LinkToFile = 0 (msoFalse), SaveWithDocument = -1 (msoTrue), Left = 0, Top = 0, Width, Height)
            ps_lines.append(f'    $shape = $slide.Shapes.AddPicture(\'{safe_img}\', 0, -1, 0, 0, {w}, {h})')
        
        safe_out = str(Path(output_pptx).resolve()).replace("'", "''")
        # 24 = ppSaveAsOpenXMLPresentation (.pptx)
        ps_lines.append(f'    $pres.SaveAs(\'{safe_out}\', 24)')
        ps_lines.append('    $pres.Close()')
        ps_lines.append('} finally {', )
        ps_lines.append('    if ($ppt) { $ppt.Quit() }')
        ps_lines.append('}')
        
        ps_script = os.path.join(temp_dir, "build_slides.ps1")
        with open(ps_script, "w", encoding="utf-8") as f:
            f.write("\n".join(ps_lines))
        
        proc = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ps_script],
            capture_output=True,
            text=True,
            timeout=120
        )
        if proc.returncode != 0:
            raise RuntimeError(f"PowerPoint COM failed: {proc.stderr or proc.stdout}")
        
    return os.path.exists(output_pptx) and os.path.getsize(output_pptx) > 0

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python convert-pdf-to-pptx.py <input.pdf> <output.pptx>")
        sys.exit(1)
        
    in_file = sys.argv[1]
    out_file = sys.argv[2]
    
    try:
        success = convert_pdf_to_pptx(in_file, out_file)
        if success:
            sys.exit(0)
        else:
            sys.exit(1)
    except Exception as e:
        sys.stderr.write(str(e))
        sys.exit(1)

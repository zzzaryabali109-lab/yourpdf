$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0

$inputDocx = (Resolve-Path "aspose-env\Lib\site-packages\docx\templates\default.docx").Path
$tempPdf = Join-Path $PWD "temp-test.pdf"
$tempDocx = Join-Path $PWD "temp-test.docx"

try {
    # 1. Export sample to PDF
    $doc = $word.Documents.Open($inputDocx, $false, $true)
    $doc.ExportAsFixedFormat($tempPdf, 17)
    $doc.Close([ref]0)

    # 2. Open PDF in Word and SaveAs2 as DOCX
    Write-Host "Opening PDF in Word..."
    $pdfDoc = $word.Documents.Open($tempPdf, $false, $true, $false)
    Write-Host "Saving as DOCX (wdFormatXMLDocument = 16)..."
    $pdfDoc.SaveAs2($tempDocx, [ref]16)
    $pdfDoc.Close([ref]0)

    Write-Host "SUCCESS! Generated DOCX file size: $((Get-Item $tempDocx).Length)"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
} finally {
    $word.Quit([ref]0)
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
    Remove-Item $tempPdf, $tempDocx -Force -ErrorAction SilentlyContinue
}

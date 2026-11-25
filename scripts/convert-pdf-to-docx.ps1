param(
    [Parameter(Mandatory=$true)]
    [string]$InputPath,

    [Parameter(Mandatory=$true)]
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

# Ensure Word PDF Reflow dialog is suppressed
try {
    Set-ItemProperty -Path "HKCU:\Software\Microsoft\Office\16.0\Word\Options" -Name "ShowPDFReflowWarning" -Value 0 -Type DWord -ErrorAction SilentlyContinue
} catch {}

$word = $null
$doc = $null

try {
    $resolvedInput = (Resolve-Path $InputPath).Path
    $resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)

    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $word.AutomationSecurity = 3 # msoAutomationSecurityForceDisable
    try {
        $word.Options.ConfirmConversions = $false
    } catch {}

    # Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles)
    # When Word opens a PDF, it uses its built-in PDF Reflow converter to convert PDF -> Word
    $doc = $word.Documents.Open($resolvedInput, $false, $true, $false)

    # 16 = wdFormatXMLDocument (standard .docx)
    $doc.SaveAs2($resolvedOutput, [ref]16)
} catch {
    [Console]::Error.WriteLine("PDF to Word conversion error: " + $_.Exception.Message)
    exit 1
} finally {
    if ($doc -ne $null) {
        try {
            $doc.Close([ref]0)
            [System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc) | Out-Null
        } catch {}
    }
    if ($word -ne $null) {
        try {
            $word.Quit([ref]0)
            [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
        } catch {}
    }
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}

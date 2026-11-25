param(
    [Parameter(Mandatory=$true)]
    [string]$InputPath,

    [Parameter(Mandatory=$true)]
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

$word = $null
$doc = $null

try {
    $resolvedInput = (Resolve-Path $InputPath).Path
    $resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)

    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $word.AutomationSecurity = 3 # msoAutomationSecurityForceDisable

    # Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles)
    $doc = $word.Documents.Open($resolvedInput, $false, $true, $false)
    # 17 = wdExportFormatPDF
    $doc.ExportAsFixedFormat($resolvedOutput, 17)
} catch {
    [Console]::Error.WriteLine("Word conversion error: " + $_.Exception.Message)
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

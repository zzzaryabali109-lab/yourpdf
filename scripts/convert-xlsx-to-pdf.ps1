param(
    [Parameter(Mandatory=$true)]
    [string]$InputPath,

    [Parameter(Mandatory=$true)]
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

$excel = $null
$wb = $null

try {
    $resolvedInput = (Resolve-Path $InputPath).Path
    $resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)

    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.ScreenUpdating = $false
    $excel.AskToUpdateLinks = $false
    $excel.AlertBeforeOverwriting = $false

    # Open(Filename, UpdateLinks=0, ReadOnly=$true)
    $wb = $excel.Workbooks.Open($resolvedInput, 0, $true)

    # 0 = xlTypePDF (XlFixedFormatType)
    $wb.ExportAsFixedFormat(0, $resolvedOutput, 0, $true, $false)
} catch {
    [Console]::Error.WriteLine("Excel conversion error: " + $_.Exception.Message)
    exit 1
} finally {
    if ($wb -ne $null) {
        try {
            $wb.Close($false)
            [System.Runtime.InteropServices.Marshal]::ReleaseComObject($wb) | Out-Null
        } catch {}
    }
    if ($excel -ne $null) {
        try {
            $excel.Quit()
            [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
        } catch {}
    }
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}

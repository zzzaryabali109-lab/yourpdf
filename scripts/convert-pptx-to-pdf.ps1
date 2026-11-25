param(
    [Parameter(Mandatory=$true)]
    [string]$InputPath,

    [Parameter(Mandatory=$true)]
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

$ppt = $null
$pres = $null

try {
    $resolvedInput = (Resolve-Path $InputPath).Path
    $resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)

    $ppt = New-Object -ComObject PowerPoint.Application

    # Open(FileName, ReadOnly, Untitled, WithWindow)
    # WithWindow = 0 (msoFalse)
    $pres = $ppt.Presentations.Open($resolvedInput, [ref]-1, [ref]0, [ref]0)

    # 32 = ppSaveAsPDF
    $pres.SaveAs($resolvedOutput, 32)
} catch {
    [Console]::Error.WriteLine("PowerPoint conversion error: " + $_.Exception.Message)
    exit 1
} finally {
    if ($pres -ne $null) {
        try {
            $pres.Close()
            [System.Runtime.InteropServices.Marshal]::ReleaseComObject($pres) | Out-Null
        } catch {}
    }
    if ($ppt -ne $null) {
        try {
            $ppt.Quit()
            [System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null
        } catch {}
    }
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}

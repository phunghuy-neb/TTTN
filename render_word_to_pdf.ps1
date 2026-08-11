param(
    [Parameter(Mandatory = $true)]
    [string]$InputDocx,
    [Parameter(Mandatory = $true)]
    [string]$OutputPdf
)

$resolvedInput = (Resolve-Path -LiteralPath $InputDocx).Path
$resolvedOutputDir = (Resolve-Path -LiteralPath (Split-Path -Parent $OutputPdf)).Path
$resolvedOutput = Join-Path $resolvedOutputDir (Split-Path -Leaf $OutputPdf)
$logPath = "$resolvedOutput.log"
[System.IO.File]::WriteAllText($logPath, "start`r`n")

function Write-Stage {
    param([string]$Text)
    [System.IO.File]::AppendAllText($logPath, "$Text`r`n")
}

$word = $null
$doc = $null
try {
    Write-Stage "before-com"
    $word = New-Object -ComObject Word.Application
    Write-Stage "after-com"
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $word.AutomationSecurity = 3
    $word.Options.UpdateLinksAtOpen = $false
    $word.Options.SaveNormalPrompt = $false
    Write-Stage "before-open"
    $doc = $word.Documents.OpenNoRepairDialog(
        $resolvedInput,
        $false,
        $true,
        $false
    )
    Write-Stage "after-open"
    Write-Stage "before-repaginate"
    $doc.Repaginate()
    Write-Stage "after-repaginate"
    Write-Stage "before-saveas-pdf"
    $doc.SaveAs2($resolvedOutput, 17)
    Write-Stage "after-saveas-pdf"
    Write-Output $resolvedOutput
}
finally {
    if ($doc -ne $null) {
        $doc.Close($false)
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc)
    }
    if ($word -ne $null) {
        $word.Quit()
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

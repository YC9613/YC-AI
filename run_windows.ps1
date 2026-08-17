param(
    [Parameter(Mandatory = $true)]
    [string]$Manifest,
    [string]$OutputDir = (Join-Path $PSScriptRoot "output"),
    [string]$Date = (Get-Date -Format "yyyy-MM-dd"),
    [string]$Model = "small",
    [string]$Device = "auto",
    [string]$ComputeType = "auto",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$python = Get-Command py -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command python -ErrorAction SilentlyContinue }
if (-not $python) { throw "Python 3 is required." }

$arguments = @(
    (Join-Path $PSScriptRoot "scripts\extract_link_copy.py"),
    "--manifest", $Manifest,
    "--out-dir", $OutputDir,
    "--date", $Date,
    "--model", $Model,
    "--device", $Device,
    "--compute-type", $ComputeType
)
if ($Force) { $arguments += "--force" }

if ($python.Name -eq "py.exe") {
    & $python.Source -3 @arguments
} else {
    & $python.Source @arguments
}
if ($LASTEXITCODE -ne 0) { throw "Copy extraction failed." }

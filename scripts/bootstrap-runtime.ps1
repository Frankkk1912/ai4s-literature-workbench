# Wrapper: all logic lives in bootstrap.mjs.
param(
    [switch]$RequireOptional,
    [string]$ReportPath
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js was not found. Install the current LTS version from https://nodejs.org/ and run this again."
}

$arguments = @((Join-Path $PSScriptRoot "bootstrap.mjs"))
if ($RequireOptional) { $arguments += "--require-optional" }
if ($ReportPath) { $arguments += @("--report", $ReportPath) }

& node @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

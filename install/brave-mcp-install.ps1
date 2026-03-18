$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

& node (Join-Path $scriptDir "brave-mcp-install.mjs") @args
exit $LASTEXITCODE

param(
    [string]$Mode = "windows"
)

$ErrorActionPreference = "Stop"

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$SrcTauriDir = Join-Path $RootDir "src-tauri"
$DistDir = Join-Path $RootDir "dist"
$FrontendDir = Join-Path $RootDir "frontend"

$AppName = "void-toast"
$BuildProfile = if ($env:BUILD_PROFILE) { $env:BUILD_PROFILE } else { "release-fast" }

New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

function Sync-Frontend {
    New-Item -ItemType Directory -Force -Path $FrontendDir | Out-Null

    $Source = Join-Path $RootDir "toast.html"
    $Target = Join-Path $FrontendDir "toast.html"

    $ShouldCopy = !(Test-Path $Target)
    if (!$ShouldCopy) {
        $SourceHash = (Get-FileHash -Algorithm SHA256 $Source).Hash
        $TargetHash = (Get-FileHash -Algorithm SHA256 $Target).Hash
        $ShouldCopy = $SourceHash -ne $TargetHash
    }

    if ($ShouldCopy) {
        Copy-Item $Source $Target -Force
    }
    
    foreach ($Asset in @("notification.wav", "achievement.wav")) {
        $AssetTarget = Join-Path $FrontendDir $Asset
        if (Test-Path $AssetTarget) {
            Remove-Item $AssetTarget -Force
        }
    }
}

function Build-Windows {
    Write-Host "==> Compilando Windows x86_64..."

    Sync-Frontend

    Push-Location $SrcTauriDir
    cargo build --profile $BuildProfile
    Pop-Location

    $Src = Join-Path $SrcTauriDir "target\$BuildProfile\$AppName.exe"
    $Out = Join-Path $DistDir "$AppName-windows-x86_64.exe"

    if (!(Test-Path $Src)) {
        throw "Binário Windows não encontrado em: $Src"
    }

    Copy-Item $Src $Out -Force

    Write-Host "OK: $Out"
}

function Build-Linux-Hint {
    Write-Host "Para compilar Linux, rode no Linux:"
    Write-Host ""
    Write-Host "  npm run build:linux"
    Write-Host ""
}

switch ($Mode) {
    "windows" {
        Build-Windows
    }
    "linux" {
        Build-Linux-Hint
    }
    "all" {
        Build-Windows
        Build-Linux-Hint
    }
    default {
        Write-Host "Uso:"
        Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/build-standalone.ps1 windows"
        Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/build-standalone.ps1 all"
        exit 1
    }
}

param(
  [Parameter(Mandatory = $true)]
  [string]$ExePath,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{64}$')]
  [string]$HeaderHash
)

$ErrorActionPreference = "Stop"

$integrity = @(
  [ordered]@{
    file = "resources\app.asar"
    alg = "sha256"
    value = $HeaderHash
  }
) | ConvertTo-Json -Compress
$payload = [System.Text.Encoding]::UTF8.GetBytes($integrity)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class Win32ResourceUpdate {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr BeginUpdateResource(string pFileName, bool bDeleteExistingResources);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool UpdateResource(
        IntPtr hUpdate,
        string lpType,
        string lpName,
        ushort wLanguage,
        byte[] lpData,
        uint cbData
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool EndUpdateResource(IntPtr hUpdate, bool fDiscard);
}
"@

$handle = [Win32ResourceUpdate]::BeginUpdateResource($ExePath, $false)
if ($handle -eq [IntPtr]::Zero) {
  $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  throw "BeginUpdateResource failed for $ExePath (Win32 error $code)"
}

$completed = $false
try {
  $ok = [Win32ResourceUpdate]::UpdateResource(
    $handle,
    "Integrity",
    "ElectronAsar",
    0,
    $payload,
    [uint32]$payload.Length
  )
  if (-not $ok) {
    $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw "UpdateResource failed for Electron ASAR integrity (Win32 error $code)"
  }

  if (-not [Win32ResourceUpdate]::EndUpdateResource($handle, $false)) {
    $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw "EndUpdateResource failed for $ExePath (Win32 error $code)"
  }
  $completed = $true
} finally {
  if (-not $completed) {
    [void][Win32ResourceUpdate]::EndUpdateResource($handle, $true)
  }
}

Write-Host "Updated ElectronAsar integrity resource: $HeaderHash"

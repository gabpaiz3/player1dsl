# Capture Stella's window directly, without needing it in the foreground.
#
# PrintWindow renders a specific window into our own bitmap, so it works while
# the window is behind others -- and it CANNOT capture anything else, which the
# whole-desktop grab could and twice did.
param(
  [Parameter(Mandatory=$true)][string]$Rom,
  [Parameter(Mandatory=$true)][string]$Out,
  [int]$SettleSeconds = 8,
  [string[]]$Extra = @(),
  [string]$Stella = "C:/Users/gabpa/tools/stella/Stella-7.0c/Stella.exe"
)
Add-Type -AssemblyName System.Drawing
if (-not ([System.Management.Automation.PSTypeName]'Win32Cap').Type) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Cap {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
}
[Win32Cap]::SetProcessDPIAware() | Out-Null

$p = Start-Process -FilePath $Stella -PassThru -ArgumentList (@("-fullscreen","0","-tia.zoom","3") + $Extra + @($Rom))
Start-Sleep -Seconds $SettleSeconds
$p.Refresh()
if ($p.MainWindowHandle -eq [IntPtr]::Zero) {
  if (-not $p.HasExited) { $p.Kill() }
  Write-Output "FAILED: Stella has no window"
  exit 1
}

$r = New-Object Win32Cap+RECT
[Win32Cap]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null
$w = $r.R - $r.L; $h = $r.B - $r.T
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$dc = $g.GetHdc()
# flag 2 = PW_RENDERFULLCONTENT, needed for hardware-composited windows.
$ok = [Win32Cap]::PrintWindow($p.MainWindowHandle, $dc, 2)
$g.ReleaseHdc($dc)

# Is it actually a picture, or a black rectangle? SDL windows sometimes refuse
# to render into a DC, and a blank capture reported as success is worse than a
# failure.
$lit = 0
for ($y = 0; $y -lt $h; $y += 17) {
  for ($x = 0; $x -lt $w; $x += 17) {
    $c = $bmp.GetPixel($x, $y)
    if ($c.R + $c.G + $c.B -gt 90) { $lit++ }
  }
}
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
if (-not $p.HasExited) { $p.CloseMainWindow() | Out-Null; Start-Sleep -Seconds 1 }
if (-not $p.HasExited) { $p.Kill() }
Write-Output "PrintWindow=$ok  ${w}x${h}  lit samples=$lit  -> $Out"

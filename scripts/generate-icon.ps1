Add-Type -AssemblyName System.Drawing

$outPath = Join-Path (Split-Path -Parent $PSScriptRoot) "desktop\app.ico"
$size = 64
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

# Warm sketchbook paper background rounded square
$bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(247, 243, 232))
$g.FillRectangle($bgBrush, 2, 2, 60, 60)

# Faint blue notebook grid lines
$gridPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(75, 84, 134, 189), 1)
for ($i = 12; $i -lt 60; $i += 12) {
  $g.DrawLine($gridPen, $i, 3, $i, 61)
  $g.DrawLine($gridPen, 3, $i, 61, $i)
}

# Crimson seal border
$redPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(207, 42, 42), 4.5)
$g.DrawRectangle($redPen, 4, 4, 56, 56)

# Stickman head + diagonal ink katana slash!
$inkPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(22, 25, 32), 4.2)
$inkPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$inkPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawEllipse($inkPen, 22, 11, 14, 14)
$g.DrawLine($inkPen, 29, 25, 27, 43)
$g.DrawLine($inkPen, 27, 43, 18, 55)
$g.DrawLine($inkPen, 27, 43, 37, 55)
# Flowing red scarf
$scarfPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(220, 42, 42), 3.6)
$scarfPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$scarfPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($scarfPen, 25, 25, 11, 30)
# Diagonal katana blade
$g.DrawLine($inkPen, 28, 34, 53, 12)
$g.DrawLine($scarfPen, 16, 48, 52, 16)

$g.Dispose()

# Save as proper PNG-in-ICO container
$msPng = New-Object System.IO.MemoryStream
$bmp.Save($msPng, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $msPng.ToArray()
$msPng.Dispose()
$bmp.Dispose()

$fs = [System.IO.File]::Open($outPath, [System.IO.FileMode]::Create)
$bw = New-Object System.IO.BinaryWriter($fs)
# ICONDIR header
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]1)
# ICONDIRENTRY
$bw.Write([Byte]$size)
$bw.Write([Byte]$size)
$bw.Write([Byte]0)
$bw.Write([Byte]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]32)
$bw.Write([UInt32]$pngBytes.Length)
$bw.Write([UInt32]22)
$bw.Write($pngBytes)
$bw.Dispose()
$fs.Dispose()

Write-Host "ICON_GENERATED: $outPath ($($pngBytes.Length) bytes)"

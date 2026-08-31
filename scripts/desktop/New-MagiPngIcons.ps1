# Renders the same shapes as src/app/icon.svg (dark rounded-square
# background, orange three-stroke "M" mark) as standalone PNGs for the web
# app manifest (public/icon-192.png, public/icon-512.png) — separate from
# New-MagiIcon.ps1's .ico output, which packs the same rendering into a
# Windows icon container instead. Re-run both if the logo ever changes.

Add-Type -AssemblyName System.Drawing

$bgColor = [System.Drawing.Color]::FromArgb(255, 0x16, 0x13, 0x0e)
$fgColor = [System.Drawing.Color]::FromArgb(255, 0xd9, 0x7a, 0x3f)
$publicDir = Resolve-Path (Join-Path $PSScriptRoot "..\..\public")

function New-MagiPng([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $scale = $size / 24.0
    $radius = 3.0 * $scale
    $d = $radius * 2

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($size - $d, 0, $d, $d, 270, 90)
    $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
    $path.AddArc(0, $size - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $brush = New-Object System.Drawing.SolidBrush $bgColor
    $g.FillPath($brush, $path)

    $pen = New-Object System.Drawing.Pen $fgColor, (2.0 * $scale)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Square
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Square
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Miter

    $g.DrawLine($pen, 4 * $scale, 5 * $scale, 4 * $scale, 19 * $scale)
    $g.DrawLine($pen, 20 * $scale, 5 * $scale, 20 * $scale, 19 * $scale)
    $chevron = @(
        (New-Object System.Drawing.PointF (7.5 * $scale), (8 * $scale))
        (New-Object System.Drawing.PointF (12 * $scale), (14 * $scale))
        (New-Object System.Drawing.PointF (16.5 * $scale), (8 * $scale))
    )
    $g.DrawLines($pen, $chevron)

    $pen.Dispose(); $brush.Dispose(); $path.Dispose(); $g.Dispose()
    return $bmp
}

foreach ($size in @(192, 512)) {
    $bmp = New-MagiPng $size
    $outPath = Join-Path $publicDir "icon-$size.png"
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output "Wrote $outPath"
}

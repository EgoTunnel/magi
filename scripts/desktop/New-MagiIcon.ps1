# Regenerates magi.ico from the same shapes as src/app/icon.svg (dark
# rounded-square background, orange three-stroke "M" mark). Rendered by hand
# with GDI+ primitives instead of an SVG rasterizer — the mark is simple
# enough (a rounded rect + three line segments on a 24x24 grid) that this is
# more reliable than pulling in an SVG-to-PNG dependency for one icon.
# Re-run this if the logo in icon.svg ever changes.

Add-Type -AssemblyName System.Drawing

$bgColor = [System.Drawing.Color]::FromArgb(255, 0x16, 0x13, 0x0e)
$fgColor = [System.Drawing.Color]::FromArgb(255, 0xd9, 0x7a, 0x3f)
$sizes = @(16, 32, 48, 256)
$outPath = Join-Path $PSScriptRoot "magi.ico"

function New-MagiPng([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $scale = $size / 24.0
    $radius = 3.0 * $scale

    # Rounded-rect background (24x24 grid, corner radius 3)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $w = $size; $h = $size
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($w - $d, 0, $d, $d, 270, 90)
    $path.AddArc($w - $d, $h - $d, $d, $d, 0, 90)
    $path.AddArc(0, $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $brush = New-Object System.Drawing.SolidBrush $bgColor
    $g.FillPath($brush, $path)

    # Three-stroke M mark: two verticals + a chevron, stroke width 2 on the
    # 24x24 grid, square caps, miter joins — matches icon.svg's <path> exactly.
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

# Modern ICO format: a standard ICONDIR/ICONDIRENTRY header, but each entry's
# payload is just a full PNG (supported since Vista) — much simpler than
# hand-rolling BMP/DIB encoding, and Windows reads it identically either way.
# A plain (unordered) Hashtable, deliberately — [ordered]'s OrderedDictionary
# has a positional int this[int index] indexer that shadows the by-key
# indexer for integer keys like these, so $table[$size] would silently
# index by position instead of by key and throw once $size exceeds the
# current element count.
$pngBytesBySize = @{}
foreach ($size in $sizes) {
    $bmp = New-MagiPng $size
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBytesBySize[$size] = [byte[]]$ms.ToArray()
    $ms.Dispose(); $bmp.Dispose()
}

$fs = New-Object System.IO.FileStream $outPath, ([System.IO.FileMode]::Create)
$bw = New-Object System.IO.BinaryWriter $fs

# ICONDIR
$bw.Write([UInt16]0)        # reserved
$bw.Write([UInt16]1)        # type = icon
$bw.Write([UInt16]$sizes.Count)

$headerSize = 6 + (16 * $sizes.Count)
$offset = $headerSize
foreach ($size in $sizes) {
    $bytes = $pngBytesBySize[$size]
    $dim = if ($size -ge 256) { 0 } else { $size }  # 0 means 256 in ICO format
    $bw.Write([Byte]$dim)          # width
    $bw.Write([Byte]$dim)          # height
    $bw.Write([Byte]0)             # color palette count
    $bw.Write([Byte]0)             # reserved
    $bw.Write([UInt16]1)           # color planes
    $bw.Write([UInt16]32)          # bits per pixel
    $bw.Write([UInt32]$bytes.Length)
    $bw.Write([UInt32]$offset)
    $offset += $bytes.Length
}
foreach ($size in $sizes) {
    $bw.Write([byte[]]$pngBytesBySize[$size])
}
$bw.Flush(); $bw.Close(); $fs.Close()

Write-Output "Wrote $outPath"

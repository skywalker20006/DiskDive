# Regenerates DiskQuest/app.ico (a tiny treemap). Run:  powershell -File tools/make-icon.ps1
Add-Type -AssemblyName System.Drawing

function New-Frame([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear([System.Drawing.Color]::Transparent)
    $s = $size / 256.0
    $blocks = @(
        @(8, 8, 240, 240, 52, '#1a1a19'),
        @(34, 34, 104, 188, 16, '#3987e5'),
        @(148, 34, 74, 90, 16, '#d95926'),
        @(148, 134, 33, 88, 12, '#199e70'),
        @(189, 134, 33, 42, 12, '#c98500'),
        @(189, 184, 33, 38, 12, '#d55181')
    )
    foreach ($b in $blocks) {
        $x = $b[0] * $s; $y = $b[1] * $s; $w = $b[2] * $s; $h = $b[3] * $s
        $d = [Math]::Max(1.0, $b[4] * $s * 2)
        $p = New-Object System.Drawing.Drawing2D.GraphicsPath
        $p.AddArc($x, $y, $d, $d, 180, 90)
        $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
        $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
        $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
        $p.CloseFigure()
        $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($b[5]))
        $g.FillPath($brush, $p)
    }
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    return , $ms.ToArray()
}

$sizes = 256, 64, 48, 32, 16
$frames = $sizes | ForEach-Object { , (New-Frame $_) }
$out = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $out
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
    $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([uint16]1); $w.Write([uint16]32)
    $w.Write([uint32]$frames[$i].Length); $w.Write([uint32]$offset)
    $offset += $frames[$i].Length
}
foreach ($f in $frames) { $w.Write($f) }
$target = Join-Path $PSScriptRoot '..\DiskQuest\app.ico'
[System.IO.File]::WriteAllBytes($target, $out.ToArray())
Write-Host "Wrote $target ($($out.Length) bytes)"

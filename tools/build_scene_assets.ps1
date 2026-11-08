param()
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Globalization;
using System.Text;
public static class SceneSpriteOutline {
    public static string HitPath(Bitmap image) {
        // Separate opaque runs preserve gaps between legs, canes and mop handles.
        // Normalized SVG coordinates keep pointer geometry aligned at any viewport.
        var rect=new Rectangle(0,0,image.Width,image.Height);
        var data=image.LockBits(rect,ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
        var path=new StringBuilder();
        try {
            var bytes=new byte[data.Stride*image.Height];Marshal.Copy(data.Scan0,bytes,0,bytes.Length);
            for(int y=0;y<image.Height;y+=2) {
                int row=Math.Min(y+1,image.Height-1)*data.Stride,x=0;
                while(x<image.Width) {
                    while(x<image.Width && bytes[row+x*4+3]<220)x++;
                    int start=x;
                    while(x<image.Width && bytes[row+x*4+3]>=220)x++;
                    if(x==start)continue;
                    // Tiny band overlap avoids subpixel seams at shared SVG edges.
                    double top=Math.Max(0,y-.02),bottom=Math.Min(image.Height,y+2.02);
                    double a=(double)start/image.Width,b=top/image.Height,
                           w=(double)(x-start)/image.Width,h=(bottom-top)/image.Height;
                    path.AppendFormat(CultureInfo.InvariantCulture,"M{0:F8},{1:F8}h{2:F8}v{3:F8}h-{2:F8}Z",a,b,w,h);
                }
            }
        } finally {image.UnlockBits(data);}
        return path.ToString();
    }
    public static void CopyPixels(Bitmap source, Bitmap target) {
        var rect=new Rectangle(0,0,source.Width,source.Height);
        var a=source.LockBits(rect,ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
        var b=target.LockBits(rect,ImageLockMode.ReadWrite,PixelFormat.Format32bppArgb);
        try {
            var aa=new byte[a.Stride*source.Height];var bb=new byte[b.Stride*target.Height];
            Marshal.Copy(a.Scan0,aa,0,aa.Length);Marshal.Copy(b.Scan0,bb,0,bb.Length);
            for(int y=0;y<source.Height;y++)for(int x=0;x<source.Width;x++) {
                int i=y*a.Stride+x*4,j=y*b.Stride+x*4;
                if(bb[j+3]>0)Array.Copy(aa,i,bb,j,4);
            }
            Marshal.Copy(bb,0,b.Scan0,bb.Length);
        } finally {source.UnlockBits(a);target.UnlockBits(b);}
    }
    public static PointF[] Trace(Bitmap image) {
        var left=new List<PointF>(); var right=new List<PointF>();
        for(int y=0;y<image.Height;y+=4) {
            int a=-1,b=-1;
            for(int x=0;x<image.Width;x++) if(image.GetPixel(x,y).A>=220) {
                if(a<0)a=x; b=x;
            }
            if(a>=0) {left.Add(new PointF(a,y));right.Add(new PointF(b,y));}
        }
        right.Reverse();left.AddRange(right);return left.ToArray();
    }
}
'@
$root = Split-Path -Parent $PSScriptRoot
$public = Join-Path $root 'public'
$scenes = Join-Path $public 'assets/images/scenes'
$layout = Get-Content -LiteralPath (Join-Path $root 'config/scene_layout.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$manifest = [ordered]@{}

foreach ($entry in $layout.objects) {
    $scene = $layout.scenes.($entry.scene)
    $sourcePath = Join-Path $public $scene.background.TrimStart('/')
    $source = [Drawing.Bitmap]::new($sourcePath)
    if ($source.Width -ne $scene.size[0] -or $source.Height -ne $scene.size[1]) {throw "Background size mismatch: $($entry.scene)"}
    $canvas = [Drawing.Bitmap]::new($source.Width, $source.Height, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [Drawing.Graphics]::FromImage($canvas)
    $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::None
    if ($entry.sprite) {
        $sprite = [Drawing.Bitmap]::new((Join-Path $public $entry.sprite.source.TrimStart('/')))
        $rect = $entry.sprite.rect
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        foreach ($shadow in $entry.sprite.shadows) {
            $shape=[Drawing.Drawing2D.GraphicsPath]::new()
            $shape.AddEllipse([single]$shadow[0],[single]$shadow[1],[single]$shadow[2],[single]$shadow[3])
            $brush=[Drawing.Drawing2D.PathGradientBrush]::new($shape)
            $brush.CenterColor=[Drawing.Color]::FromArgb($shadow[4],0,0,0)
            $brush.SurroundColors=@([Drawing.Color]::FromArgb(0,0,0,0))
            $graphics.CompositingMode=[Drawing.Drawing2D.CompositingMode]::SourceOver
            $graphics.FillPath($brush,$shape);$brush.Dispose();$shape.Dispose()
        }
        if ($entry.sprite.tone) {
            $matrix=[Drawing.Imaging.ColorMatrix]::new()
            $matrix.Matrix00=$entry.sprite.tone[0];$matrix.Matrix11=$entry.sprite.tone[1];$matrix.Matrix22=$entry.sprite.tone[2]
            $attributes=[Drawing.Imaging.ImageAttributes]::new();$attributes.SetColorMatrix($matrix)
            $graphics.CompositingMode=[Drawing.Drawing2D.CompositingMode]::SourceOver
            $graphics.DrawImage($sprite,[Drawing.Rectangle]::new($rect[0],$rect[1],$rect[2],$rect[3]),0,0,$sprite.Width,$sprite.Height,[Drawing.GraphicsUnit]::Pixel,$attributes)
            $attributes.Dispose()
        } else {
            $graphics.DrawImage($sprite,[Drawing.Rectangle]::new($rect[0],$rect[1],$rect[2],$rect[3]))
        }
        $graphics.CompositingMode=[Drawing.Drawing2D.CompositingMode]::SourceCopy
        foreach ($occlusion in $entry.sprite.occlusion) {
            $shape = [Drawing.Drawing2D.GraphicsPath]::new()
            $points = @($occlusion | ForEach-Object {[Drawing.PointF]::new($_[0],$_[1])})
            $shape.AddPolygon([Drawing.PointF[]]$points)
            $graphics.FillPath([Drawing.Brushes]::Transparent,$shape)
            $shape.Dispose()
        }
        $sprite.Dispose()
        $points = [SceneSpriteOutline]::Trace($canvas)
    } else {
        $shape = [Drawing.Drawing2D.GraphicsPath]::new()
        $points = @($entry.polygon | ForEach-Object {[Drawing.PointF]::new($_[0],$_[1])})
        $shape.AddPolygon([Drawing.PointF[]]$points)
        $graphics.SetClip($shape)
        $graphics.FillRectangle([Drawing.Brushes]::White,0,0,$source.Width,$source.Height)
        $graphics.Flush()
        [SceneSpriteOutline]::CopyPixels($source,$canvas)
        $shape.Dispose()
    }
    if ($points.Count -lt 3) {throw "Empty object: $($entry.key)"}
    $output = $entry.key.Replace('.','-') + '.png'
    $canvas.Save((Join-Path $scenes $output),[Drawing.Imaging.ImageFormat]::Png)
    $xs=@($points | ForEach-Object X); $ys=@($points | ForEach-Object Y)
    $minX=($xs | Measure-Object -Minimum).Minimum; $maxX=($xs | Measure-Object -Maximum).Maximum
    $minY=($ys | Measure-Object -Minimum).Minimum; $maxY=($ys | Measure-Object -Maximum).Maximum
    $polygon = @($points | ForEach-Object { ,@([math]::Round($_.X*100/$source.Width,6),[math]::Round($_.Y*100/$source.Height,6)) })
    $record = [ordered]@{
        image="/assets/images/scenes/$output"; background=$scene.background
        size=@($source.Width,$source.Height); polygon=$polygon
        bounds=@(($minX*100/$source.Width),($minY*100/$source.Height),(($maxX-$minX)*100/$source.Width),(($maxY-$minY)*100/$source.Height))
        render_mode=$(if($entry.sprite){'sprite'}else{'background'})
    }
    if ($entry.sprite) {
        $record['source']=$entry.sprite.source;$record['rect']=$entry.sprite.rect
        if($entry.sprite.grounded){$record['grounded']=$true;$record['hit_path']=[SceneSpriteOutline]::HitPath($canvas)}
    }
    $manifest[$entry.key]=$record
    $graphics.Dispose(); $canvas.Dispose(); $source.Dispose()
}
[IO.File]::WriteAllText((Join-Path $scenes 'registration.json'),($manifest | ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
Write-Output "Built $($manifest.Count) layers from config/scene_layout.json; supplied backgrounds unchanged."

# Creates the upload fixtures in tests/fixtures/files with the installed Microsoft Office (Word / Excel / PowerPoint):
# real .doc/.docx/.odt/.pdf, .xls/.xlsx/.csv, .ppt/.pptx and short .mp4/.wmv clips. Each file only holds the text
# "[Auto Test] KM-Portal sample". Run once: powershell -ExecutionPolicy Bypass -File scripts/make-office-fixtures.ps1
$ErrorActionPreference = 'Stop'
$dir = Join-Path $PSScriptRoot '..\tests\fixtures\files'
New-Item -ItemType Directory -Force $dir | Out-Null
$dir = (Resolve-Path $dir).Path
$text = '[Auto Test] KM-Portal sample'

$word = New-Object -ComObject Word.Application
$word.Visible = $false
try {
  $doc = $word.Documents.Add()
  $doc.Content.Text = $text
  $doc.SaveAs2("$dir\sample.docx", 12)   # wdFormatXMLDocument
  $doc.SaveAs2("$dir\sample.doc", 0)     # wdFormatDocument97
  $doc.SaveAs2("$dir\sample.odt", 23)    # wdFormatOpenDocumentText
  $doc.SaveAs2("$dir\sample.pdf", 17)    # wdFormatPDF
  $doc.Close($false)
} finally { $word.Quit() }

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
  $book = $excel.Workbooks.Add()
  $book.Worksheets.Item(1).Range('A1').Value2 = $text
  $book.SaveAs("$dir\sample.xlsx", 51)   # xlOpenXMLWorkbook
  $book.SaveAs("$dir\sample.xls", 56)    # xlExcel8
  $book.SaveAs("$dir\data.csv", 6)       # xlCSV
  $book.Close($false)
} finally { $excel.Quit() }

$ppt = New-Object -ComObject PowerPoint.Application
try {
  $pres = $ppt.Presentations.Add(0)      # no window
  $slide = $pres.Slides.Add(1, 12)       # ppLayoutBlank
  $box = $slide.Shapes.AddTextbox(1, 40, 40, 600, 80)
  $box.TextFrame.TextRange.Text = $text
  $pres.SaveAs("$dir\sample.pptx", 24)   # ppSaveAsOpenXMLPresentation
  $pres.SaveAs("$dir\sample.ppt", 1)     # ppSaveAsPresentation
  foreach ($video in @('clip.mp4', 'clip.wmv')) {
    # CreateVideo(file, useTimings, secondsPerSlide, verticalResolution, fps, quality)
    $pres.CreateVideo("$dir\$video", $false, 2, 240, 15, 50)
    $waited = 0
    while ($pres.CreateVideoStatus -eq 1 -or $pres.CreateVideoStatus -eq 2) { Start-Sleep -Milliseconds 500; $waited++; if ($waited -gt 240) { throw "video $video timed out" } }
  }
  $pres.Close()
} finally { $ppt.Quit() }

Get-ChildItem $dir | Select-Object Name, Length

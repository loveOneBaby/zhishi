import AppKit

let root = URL(fileURLWithPath: #filePath)
  .deletingLastPathComponent()
  .deletingLastPathComponent()
let assetsDir = root.appendingPathComponent("assets")

func renderBackground(width: CGFloat, height: CGFloat, scale: CGFloat, outputURL: URL) throws {
  let pixelWidth = Int(width * scale)
  let pixelHeight = Int(height * scale)
  let pixelSize = NSSize(width: CGFloat(pixelWidth), height: CGFloat(pixelHeight))

  guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: pixelWidth,
    pixelsHigh: pixelHeight,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
  ) else {
    fatalError("Failed to create bitmap")
  }

  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
  NSGraphicsContext.current?.imageInterpolation = .high

  func scaled(_ value: CGFloat) -> CGFloat { value * scale }
  func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> NSRect {
    NSRect(x: scaled(x), y: scaled(y), width: scaled(w), height: scaled(h))
  }
  func point(_ x: CGFloat, _ y: CGFloat) -> NSPoint {
    NSPoint(x: scaled(x), y: scaled(y))
  }

  let backgroundRect = NSRect(origin: .zero, size: pixelSize)
  let gradient = NSGradient(colors: [
    NSColor(calibratedRed: 0.99, green: 1.0, blue: 1.0, alpha: 1),
    NSColor(calibratedRed: 0.93, green: 0.97, blue: 1.0, alpha: 1),
    NSColor(calibratedRed: 0.83, green: 0.87, blue: 1.0, alpha: 1),
  ])!
  gradient.draw(in: backgroundRect, angle: 315)

  let glowLeft = NSBezierPath(ovalIn: rect(-120, 186, 260, 220))
  NSColor.white.withAlphaComponent(0.36).setFill()
  glowLeft.fill()

  let glowRight = NSBezierPath(ovalIn: rect(414, 18, 280, 260))
  NSColor(calibratedRed: 0.68, green: 0.75, blue: 1.0, alpha: 0.18).setFill()
  glowRight.fill()

  let paragraph = NSMutableParagraphStyle()
  paragraph.alignment = .center

  let arrowCircle = NSBezierPath(ovalIn: rect(288, 102, 44, 44))
  NSColor(calibratedRed: 0.42, green: 0.50, blue: 0.78, alpha: 0.76).setFill()
  arrowCircle.fill()

  let arrow = NSBezierPath()
  arrow.move(to: point(310, 113))
  arrow.line(to: point(310, 134))
  arrow.move(to: point(310, 134))
  arrow.line(to: point(300, 124))
  arrow.move(to: point(310, 134))
  arrow.line(to: point(320, 124))
  arrow.lineWidth = scaled(4)
  arrow.lineCapStyle = .round
  arrow.lineJoinStyle = .round
  NSColor.white.withAlphaComponent(0.94).setStroke()
  arrow.stroke()

  ("双击 安装知识检索" as NSString).draw(
    in: rect(70, 50, 480, 38),
    withAttributes: [
      .font: NSFont.systemFont(ofSize: scaled(25), weight: .semibold),
      .foregroundColor: NSColor(calibratedRed: 0.34, green: 0.40, blue: 0.62, alpha: 0.88),
      .paragraphStyle: paragraph,
    ]
  )

  NSGraphicsContext.restoreGraphicsState()

  guard let pngData = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("Failed to render dmg background")
  }

  try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
  try pngData.write(to: outputURL)
  print(outputURL.path)
}

try renderBackground(
  width: 620,
  height: 360,
  scale: 1,
  outputURL: assetsDir.appendingPathComponent("dmg-background.png")
)

try renderBackground(
  width: 620,
  height: 360,
  scale: 2,
  outputURL: assetsDir.appendingPathComponent("dmg-background@2x.png")
)

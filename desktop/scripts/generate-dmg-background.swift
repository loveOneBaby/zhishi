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
    NSColor(calibratedRed: 0.96, green: 0.99, blue: 0.98, alpha: 1),
    NSColor(calibratedRed: 0.89, green: 0.96, blue: 0.98, alpha: 1),
    NSColor(calibratedRed: 0.88, green: 0.91, blue: 1.0, alpha: 1),
  ])!
  gradient.draw(in: backgroundRect, angle: 315)

  let glowLeft = NSBezierPath(ovalIn: rect(-120, 190, 300, 230))
  NSColor(calibratedRed: 0.22, green: 0.82, blue: 0.72, alpha: 0.17).setFill()
  glowLeft.fill()

  let glowRight = NSBezierPath(ovalIn: rect(430, 42, 250, 230))
  NSColor(calibratedRed: 0.42, green: 0.53, blue: 1.0, alpha: 0.16).setFill()
  glowRight.fill()

  let panel = NSBezierPath(roundedRect: rect(34, 36, 552, 288), xRadius: scaled(30), yRadius: scaled(30))
  NSColor.white.withAlphaComponent(0.36).setFill()
  panel.fill()
  NSColor.white.withAlphaComponent(0.58).setStroke()
  panel.lineWidth = scaled(1.1)
  panel.stroke()

  let focusShadow = NSBezierPath(roundedRect: rect(230, 98, 160, 150), xRadius: scaled(38), yRadius: scaled(38))
  NSColor(calibratedRed: 0.02, green: 0.44, blue: 0.38, alpha: 0.07).setFill()
  focusShadow.fill()

  let paragraph = NSMutableParagraphStyle()
  paragraph.alignment = .center

  ("知识检索 · Apple 芯片 Mac 专用安装包" as NSString).draw(
    in: rect(70, 294, 480, 24),
    withAttributes: [
      .font: NSFont.systemFont(ofSize: scaled(13), weight: .semibold),
      .foregroundColor: NSColor(calibratedRed: 0.28, green: 0.43, blue: 0.56, alpha: 0.78),
      .paragraphStyle: paragraph,
    ]
  )

  ("双击知识检索.app 自动安装" as NSString).draw(
    in: rect(70, 252, 480, 34),
    withAttributes: [
      .font: NSFont.systemFont(ofSize: scaled(28), weight: .bold),
      .foregroundColor: NSColor(calibratedRed: 0.05, green: 0.18, blue: 0.20, alpha: 0.92),
      .paragraphStyle: paragraph,
    ]
  )

  ("首次启动会复制到 Applications，并重新打开" as NSString).draw(
    in: rect(70, 226, 480, 22),
    withAttributes: [
      .font: NSFont.systemFont(ofSize: scaled(13), weight: .medium),
      .foregroundColor: NSColor(calibratedRed: 0.30, green: 0.38, blue: 0.48, alpha: 0.78),
      .paragraphStyle: paragraph,
    ]
  )

  let arrowCircle = NSBezierPath(ovalIn: rect(286, 62, 48, 48))
  NSColor(calibratedRed: 0.05, green: 0.42, blue: 0.37, alpha: 0.72).setFill()
  arrowCircle.fill()

  let arrow = NSBezierPath()
  arrow.move(to: point(310, 74))
  arrow.line(to: point(310, 96))
  arrow.move(to: point(310, 96))
  arrow.line(to: point(299, 85))
  arrow.move(to: point(310, 96))
  arrow.line(to: point(321, 85))
  arrow.lineWidth = scaled(4.5)
  arrow.lineCapStyle = .round
  arrow.lineJoinStyle = .round
  NSColor.white.withAlphaComponent(0.94).setStroke()
  arrow.stroke()

  ("双击上方图标开始安装" as NSString).draw(
    in: rect(70, 34, 480, 22),
    withAttributes: [
      .font: NSFont.systemFont(ofSize: scaled(13), weight: .semibold),
      .foregroundColor: NSColor(calibratedRed: 0.23, green: 0.31, blue: 0.43, alpha: 0.74),
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

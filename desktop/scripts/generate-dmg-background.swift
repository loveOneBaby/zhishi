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

  let panel = NSBezierPath(roundedRect: rect(36, 38, 548, 280), xRadius: scaled(28), yRadius: scaled(28))
  NSColor.white.withAlphaComponent(0.40).setFill()
  panel.fill()
  NSColor.white.withAlphaComponent(0.62).setStroke()
  panel.lineWidth = scaled(1.1)
  panel.stroke()

  let paragraph = NSMutableParagraphStyle()
  paragraph.alignment = .center

  ("知识检索 · Apple 芯片 Mac 专用安装包" as NSString).draw(
    in: rect(70, 292, 480, 22),
    withAttributes: [
      .font: NSFont.systemFont(ofSize: scaled(12), weight: .semibold),
      .foregroundColor: NSColor(calibratedRed: 0.28, green: 0.43, blue: 0.56, alpha: 0.70),
      .paragraphStyle: paragraph,
    ]
  )

  ("双击安装知识检索" as NSString).draw(
    in: rect(70, 258, 480, 30),
    withAttributes: [
      .font: NSFont.systemFont(ofSize: scaled(24), weight: .bold),
      .foregroundColor: NSColor(calibratedRed: 0.05, green: 0.18, blue: 0.20, alpha: 0.92),
      .paragraphStyle: paragraph,
    ]
  )

  ("首次启动会复制到 Applications，并重新打开" as NSString).draw(
    in: rect(70, 234, 480, 20),
    withAttributes: [
      .font: NSFont.systemFont(ofSize: scaled(12), weight: .medium),
      .foregroundColor: NSColor(calibratedRed: 0.30, green: 0.38, blue: 0.48, alpha: 0.72),
      .paragraphStyle: paragraph,
    ]
  )

  let hintPill = NSBezierPath(roundedRect: rect(194, 18, 232, 30), xRadius: scaled(15), yRadius: scaled(15))
  NSColor.white.withAlphaComponent(0.48).setFill()
  hintPill.fill()
  NSColor(calibratedRed: 0.29, green: 0.54, blue: 0.55, alpha: 0.18).setStroke()
  hintPill.lineWidth = scaled(1)
  hintPill.stroke()

  ("双击图标即可自动安装" as NSString).draw(
    in: rect(194, 24, 232, 18),
    withAttributes: [
      .font: NSFont.systemFont(ofSize: scaled(12), weight: .semibold),
      .foregroundColor: NSColor(calibratedRed: 0.20, green: 0.34, blue: 0.42, alpha: 0.72),
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

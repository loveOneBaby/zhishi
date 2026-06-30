import AppKit

let root = URL(fileURLWithPath: #filePath)
  .deletingLastPathComponent()
  .deletingLastPathComponent()
let outputURL = root.appendingPathComponent("assets/dmg-background.png")

let width: CGFloat = 620
let height: CGFloat = 360
let scale: CGFloat = 2
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

func scaled(_ value: CGFloat) -> CGFloat { value * scale }
func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> NSRect {
  NSRect(x: scaled(x), y: scaled(y), width: scaled(w), height: scaled(h))
}
func point(_ x: CGFloat, _ y: CGFloat) -> NSPoint {
  NSPoint(x: scaled(x), y: scaled(y))
}

NSGraphicsContext.current?.imageInterpolation = .high

let backgroundRect = NSRect(origin: .zero, size: pixelSize)
let gradient = NSGradient(colors: [
  NSColor(calibratedRed: 0.98, green: 0.99, blue: 1.0, alpha: 1),
  NSColor(calibratedRed: 0.90, green: 0.95, blue: 1.0, alpha: 1),
  NSColor(calibratedRed: 0.84, green: 0.89, blue: 1.0, alpha: 1),
])!
gradient.draw(in: backgroundRect, angle: 315)

let glowA = NSBezierPath(ovalIn: rect(-80, 190, 280, 220))
NSColor(calibratedRed: 0.41, green: 0.91, blue: 0.82, alpha: 0.16).setFill()
glowA.fill()

let glowB = NSBezierPath(ovalIn: rect(430, 30, 250, 240))
NSColor(calibratedRed: 0.37, green: 0.50, blue: 1.0, alpha: 0.16).setFill()
glowB.fill()

let panel = NSBezierPath(roundedRect: rect(38, 46, 544, 268), xRadius: scaled(28), yRadius: scaled(28))
NSColor.white.withAlphaComponent(0.26).setFill()
panel.fill()
NSColor.white.withAlphaComponent(0.42).setStroke()
panel.lineWidth = scaled(1)
panel.stroke()

let titleFont = NSFont.systemFont(ofSize: scaled(26), weight: .semibold)
let subtitleFont = NSFont.systemFont(ofSize: scaled(13), weight: .medium)
let titleParagraph = NSMutableParagraphStyle()
titleParagraph.alignment = .center

("知识检索 · Apple 芯片 Mac 专用安装包" as NSString).draw(
  in: rect(70, 304, 480, 24),
  withAttributes: [
    .font: NSFont.systemFont(ofSize: scaled(13), weight: .semibold),
    .foregroundColor: NSColor(calibratedRed: 0.42, green: 0.49, blue: 0.64, alpha: 0.58),
    .paragraphStyle: titleParagraph,
  ]
)

("首次启动会自动复制到 Applications，并重新打开" as NSString).draw(
  in: rect(70, 274, 480, 24),
  withAttributes: [
    .font: subtitleFont,
    .foregroundColor: NSColor(calibratedRed: 0.35, green: 0.43, blue: 0.61, alpha: 0.78),
    .paragraphStyle: titleParagraph,
  ]
)

let arrowCircle = NSBezierPath(ovalIn: rect(286, 132, 48, 48))
NSColor(calibratedRed: 0.39, green: 0.49, blue: 0.80, alpha: 0.62).setFill()
arrowCircle.fill()

let arrow = NSBezierPath()
arrow.move(to: point(310, 144))
arrow.line(to: point(310, 166))
arrow.move(to: point(310, 166))
arrow.line(to: point(299, 155))
arrow.move(to: point(310, 166))
arrow.line(to: point(321, 155))
arrow.lineWidth = scaled(4.5)
arrow.lineCapStyle = .round
arrow.lineJoinStyle = .round
NSColor.white.withAlphaComponent(0.92).setStroke()
arrow.stroke()

("双击安装知识检索" as NSString).draw(
  in: rect(70, 74, 480, 48),
  withAttributes: [
    .font: titleFont,
    .foregroundColor: NSColor(calibratedRed: 0.25, green: 0.34, blue: 0.57, alpha: 0.92),
    .paragraphStyle: titleParagraph,
  ]
)

NSGraphicsContext.restoreGraphicsState()

guard let pngData = bitmap.representation(using: .png, properties: [:]) else {
  fatalError("Failed to render dmg background")
}

try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
try pngData.write(to: outputURL)
print(outputURL.path)

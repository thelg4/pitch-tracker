import AVFoundation
import AppKit
let a = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
let g = AVAssetImageGenerator(asset: a)
g.appliesPreferredTrackTransform = true
g.requestedTimeToleranceBefore = .zero; g.requestedTimeToleranceAfter = .zero
for s in [5.0, 86.0, 86.5] {
  let img = try! g.copyCGImage(at: CMTime(seconds: s, preferredTimescale: 600), actualTime: nil)
  print(img.width, img.height)
  // far end of the cage: roughly x 25-60%, y 45-62% of the portrait frame
  let r = CGRect(x: Double(img.width)*0.25, y: Double(img.height)*0.46, width: Double(img.width)*0.4, height: Double(img.height)*0.16)
  let c = img.cropping(to: r)!
  try! NSBitmapImageRep(cgImage: c).representation(using: .jpeg, properties: [:])!.write(to: URL(fileURLWithPath: "\(CommandLine.arguments[2])/crop\(s).jpg"))
}

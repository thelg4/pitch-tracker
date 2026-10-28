import AVFoundation
import AppKit
let a = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
let out = CommandLine.arguments[2]
let g = AVAssetImageGenerator(asset: a)
g.appliesPreferredTrackTransform = true
g.maximumSize = CGSize(width: 720, height: 720)
g.requestedTimeToleranceBefore = .zero; g.requestedTimeToleranceAfter = .zero
for s in stride(from: 5.0, through: 175.0, by: 10.0) {
  if let img = try? g.copyCGImage(at: CMTime(seconds: s, preferredTimescale: 600), actualTime: nil) {
    let rep = NSBitmapImageRep(cgImage: img)
    try! rep.representation(using: .jpeg, properties: [.compressionFactor: 0.7])!.write(to: URL(fileURLWithPath: "\(out)/f\(Int(s)).jpg"))
  }
}

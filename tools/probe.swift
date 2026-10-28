import AVFoundation
let a = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
let sem = DispatchSemaphore(value: 0)
Task {
  let d = try await a.load(.duration)
  print("duration", d.seconds)
  for t in try await a.loadTracks(withMediaType: .video) {
    let (sz, fps, fd, tx) = try await t.load(.naturalSize, .nominalFrameRate, .formatDescriptions, .preferredTransform)
    let sub = CMFormatDescriptionGetMediaSubType(fd[0])
    let c = String(format: "%c%c%c%c", (sub>>24)&255, (sub>>16)&255, (sub>>8)&255, sub&255)
    print("size", sz, "fps", fps, "codec", c, "transform", tx)
  }
  sem.signal()
}
sem.wait()

// frontwin: prints "visible" if any on-screen window's owner name (case-insensitive)
// equals the argv[1] target, otherwise "hidden". Used by OpenPets focus-follow to
// detect floating panels (e.g. Ghostty's quick-terminal) that don't claim frontmost.
import Cocoa

let args = CommandLine.arguments
guard args.count > 1 else {
  FileHandle.standardError.write("usage: frontwin <app-name>\n".data(using: .utf8)!)
  exit(2)
}
let target = args[1].lowercased()

let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
for w in info {
  let owner = ((w[kCGWindowOwnerName as String] as? String) ?? "").lowercased()
  if owner != target { continue }
  let alpha = (w[kCGWindowAlpha as String] as? Double) ?? 0
  if alpha <= 0 { continue }
  if let bounds = w[kCGWindowBounds as String] as? [String: CGFloat],
     let width = bounds["Width"], let height = bounds["Height"],
     width > 1, height > 1 {
    print("visible")
    exit(0)
  }
}
print("hidden")

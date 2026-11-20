#!/usr/bin/env swift
import AppKit
import Foundation

// Rasterize the same source used by the browser favicon and toolbar.
let artworkURL = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("desktop/icon.svg")
guard let artwork = NSImage(contentsOf: artworkURL) else {
    fputs("Cannot read desktop/icon.svg.\n", stderr)
    exit(1)
}

func drawIcon(size: Int) throws -> Data {
    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
                                        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                        isPlanar: false, colorSpaceName: .deviceRGB,
                                        bytesPerRow: size * 4, bitsPerPixel: 32),
          let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        throw NSError(domain: "drag.icon", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot create icon bitmap."])
    }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    defer { NSGraphicsContext.restoreGraphicsState() }
    context.imageInterpolation = .high
    let bounds = NSRect(x: 0, y: 0, width: size, height: size)
    NSColor.clear.setFill()
    bounds.fill(using: .copy)
    artwork.draw(in: bounds, from: .zero, operation: .sourceOver, fraction: 1)
    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "drag.icon", code: 2, userInfo: [NSLocalizedDescriptionKey: "Cannot encode icon PNG."])
    }
    return png
}

let fileManager = FileManager.default
let output = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? "desktop/icon.icns").standardizedFileURL

func appendUInt32(_ value: UInt32, to data: inout Data) {
    var bigEndian = value.bigEndian
    withUnsafeBytes(of: &bigEndian) { data.append(contentsOf: $0) }
}

do {
    // Modern ICNS entries carry PNG data, prefixed with an eight-byte type/size
    // header. Writing that container directly avoids iconutil's XPC service,
    // which cannot start inside some managed build sandboxes.
    let entries: [(String, Int)] = [
        ("icp4", 16), ("icp5", 32), ("icp6", 64),
        ("ic07", 128), ("ic08", 256), ("ic09", 512), ("ic10", 1024),
        ("ic11", 32), ("ic12", 64), ("ic13", 256), ("ic14", 512)
    ]
    var contents = Data()
    for (type, size) in entries {
        let png = try drawIcon(size: size)
        contents.append(type.data(using: .ascii)!)
        appendUInt32(UInt32(png.count + 8), to: &contents)
        contents.append(png)
    }
    var icns = "icns".data(using: .ascii)!
    appendUInt32(UInt32(contents.count + 8), to: &icns)
    icns.append(contents)
    try fileManager.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
    try icns.write(to: output, options: .atomic)
    print(output.path)
} catch {
    fputs("\(error.localizedDescription)\n", stderr)
    exit(1)
}

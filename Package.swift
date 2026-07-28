// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "browser",
    platforms: [
        .macOS(.v15)
    ],
    targets: [
        .executableTarget(
            name: "browser"
        ),
        .testTarget(
            name: "browserTests",
            dependencies: ["browser"]
        ),
    ]
)

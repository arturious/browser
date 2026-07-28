// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "browser",
    platforms: [
        .macOS(.v26)
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

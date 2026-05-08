import Foundation

// App Group shared UserDefaults read/write for the share extension's
// pending handoff. The main app's SharedAuthStorePlugin duplicates the
// app-group id and defaults key (constants below) because the Xcode
// project's ShareExtension folder is a PBXFileSystemSynchronizedRootGroup
// while the App target uses explicit file refs — sharing a Swift file
// across the two requires fragile project.pbxproj edits. Schema
// (PendingShare JSON) is the single source of truth; keep the constants
// in sync if either side changes.
//
// Versioned key ("v1") was originally chosen with headroom for a schema
// bump in mind. `imageUrl` is now part of the v1 payload as an optional
// field — Codable decodes existing payloads without it (Swift Optional
// defaults to nil) and older binaries silently ignore the new field.
//
// Entitlement required on both targets:
//   com.apple.security.application-groups = [ group.com.recifriend.app ]
// Verified present in App.entitlements and ShareExtension.entitlements.

struct PendingShare: Codable, Equatable {
    let url: String
    let title: String
    let imageUrl: String?
    let createdAt: TimeInterval
}

enum SharedPendingShare {
    static let appGroupId = "group.com.recifriend.app"
    static let key = "pending_share.v1"

    private static func defaults() -> UserDefaults? {
        UserDefaults(suiteName: appGroupId)
    }

    static func write(url: String, title: String, imageUrl: String? = nil) {
        guard let d = defaults() else { return }
        let payload = PendingShare(
            url: url,
            title: title,
            imageUrl: imageUrl,
            createdAt: Date().timeIntervalSince1970
        )
        guard let data = try? JSONEncoder().encode(payload) else { return }
        d.set(data, forKey: key)
    }

    static func read() -> PendingShare? {
        guard let d = defaults(), let data = d.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(PendingShare.self, from: data)
    }

    static func clear() {
        defaults()?.removeObject(forKey: key)
    }
}

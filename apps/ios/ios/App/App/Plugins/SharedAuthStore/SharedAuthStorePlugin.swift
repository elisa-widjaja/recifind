import Foundation
import Capacitor
import Security

// Stores the Supabase JWT in the shared iOS Keychain so the share extension
// can read it without re-implementing auth. Access group must match both
// targets' keychain-access-groups entitlement.
//
// Error codes (returned via call.reject):
//   - "no-session": getJwt found no stored token
//   - "keychain-write-failed": setJwt SecItemAdd/Update returned non-zero OSStatus
//   - "keychain-read-failed": getJwt SecItemCopyMatching returned non-errSecSuccess other than errSecItemNotFound
//   - "keychain-delete-failed": clearJwt SecItemDelete returned non-zero OSStatus other than errSecItemNotFound

private let keychainService = "com.recifriend.app.auth"
private let keychainAccount = "supabase-jwt"
// Must match both targets' keychain-access-groups entitlement, which uses
// $(AppIdentifierPrefix) — expanded at build time to "<TEAM_ID>." + suffix.
// iOS does NOT auto-prepend the team prefix in SecItem queries — the full
// access group string must be provided here so the main app and the share
// extension read/write the same keychain bucket.
private let keychainAccessGroup = "7C6PMUN99K.com.recifriend.app.shared"

// Generic keychain service for Supabase auth-state storage. Distinct from
// the JWT keychainService above so the two never collide on key naming.
// Not in any access group — only the main app reads/writes Supabase state.
private let supabaseStorageService = "com.recifriend.app.supabase"

// MIRRORS apps/ios/ios/App/ShareExtension/SharedPendingShare.swift —
// keep the app-group id and defaults key in sync.
private let pendingShareAppGroupId = "group.com.recifriend.app"
private let pendingShareKey = "pending_share.v1"

// Keep the JSON shape identical to the extension's PendingShare Codable.
private struct PendingSharePayload: Codable {
    let url: String
    let title: String
    let createdAt: TimeInterval
}

@objc(SharedAuthStorePlugin)
public class SharedAuthStorePlugin: CAPPlugin {

    @objc func setJwt(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), !token.isEmpty else {
            call.reject("token is required")
            return
        }
        guard let data = token.data(using: .utf8) else {
            call.reject("token is not UTF-8")
            return
        }

        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecAttrAccessGroup as String: keychainAccessGroup,
        ]

        // Delete any existing record first — simpler than an add-or-update dance.
        SecItemDelete(base as CFDictionary)

        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock

        let status = SecItemAdd(add as CFDictionary, nil)
        if status == errSecSuccess {
            call.resolve()
        } else {
            call.reject("keychain-write-failed (OSStatus \(status))")
        }
    }

    @objc func getJwt(_ call: CAPPluginCall) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecAttrAccessGroup as String: keychainAccessGroup,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)

        if status == errSecItemNotFound {
            call.reject("no-session")
            return
        }
        if status != errSecSuccess {
            call.reject("keychain-read-failed (OSStatus \(status))")
            return
        }
        guard let data = item as? Data, let token = String(data: data, encoding: .utf8) else {
            call.reject("keychain-read-failed (corrupt data)")
            return
        }
        call.resolve(["token": token])
    }

    @objc func clearJwt(_ call: CAPPluginCall) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecAttrAccessGroup as String: keychainAccessGroup,
        ]
        let status = SecItemDelete(query as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            call.resolve()
        } else {
            call.reject("keychain-delete-failed (OSStatus \(status))")
        }
    }

    @objc func readPendingShare(_ call: CAPPluginCall) {
        guard let d = UserDefaults(suiteName: pendingShareAppGroupId),
              let data = d.data(forKey: pendingShareKey),
              let share = try? JSONDecoder().decode(PendingSharePayload.self, from: data) else {
            call.reject("no-pending-share")
            return
        }
        call.resolve([
            "url": share.url,
            "title": share.title,
            "createdAt": share.createdAt,
        ])
    }

    @objc func clearPendingShare(_ call: CAPPluginCall) {
        UserDefaults(suiteName: pendingShareAppGroupId)?.removeObject(forKey: pendingShareKey)
        call.resolve()
    }

    // MARK: - Generic Keychain key/value (used as Supabase storage backend)
    //
    // Supabase auth state was previously stored via Capacitor Preferences
    // (UserDefaults). UserDefaults writes are async-to-disk — iOS flushes
    // periodically but if the app is killed (memory pressure when switching
    // to a memory-heavy app like Mail/Gmail) before the flush the write is
    // lost. That manifested as "PKCE code verifier not found in storage"
    // when users tapped the magic link in their email and the app cold-booted
    // on the deep-link return trip.
    //
    // Keychain writes are synchronous — SecItemAdd/Update returns only after
    // the data is durable on disk. No access group on these entries (unlike
    // setJwt) because Supabase storage is read only by the main app.

    @objc func setKeychainItem(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("key is required")
            return
        }
        let value = call.getString("value", "")
        NSLog("[KCDIAG] setKeychainItem key=%@ len=%d", key, value.count)
        guard let data = value.data(using: .utf8) else {
            call.reject("value is not UTF-8")
            return
        }

        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: supabaseStorageService,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(base as CFDictionary)

        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock

        let status = SecItemAdd(add as CFDictionary, nil)
        NSLog("[KCDIAG] setKeychainItem key=%@ SecItemAdd OSStatus=%d", key, Int(status))
        if status == errSecSuccess {
            call.resolve()
        } else {
            call.reject("keychain-write-failed (OSStatus \(status))")
        }
    }

    @objc func getKeychainItem(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("key is required")
            return
        }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: supabaseStorageService,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)

        if status == errSecItemNotFound {
            NSLog("[KCDIAG] getKeychainItem key=%@ -> NOT_FOUND", key)
            call.resolve(["value": NSNull()])
            return
        }
        if status != errSecSuccess {
            NSLog("[KCDIAG] getKeychainItem key=%@ -> ERROR OSStatus=%d", key, Int(status))
            call.reject("keychain-read-failed (OSStatus \(status))")
            return
        }
        guard let data = item as? Data, let value = String(data: data, encoding: .utf8) else {
            NSLog("[KCDIAG] getKeychainItem key=%@ -> CORRUPT", key)
            call.reject("keychain-read-failed (corrupt data)")
            return
        }
        NSLog("[KCDIAG] getKeychainItem key=%@ -> OK len=%d", key, value.count)
        call.resolve(["value": value])
    }

    @objc func removeKeychainItem(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("key is required")
            return
        }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: supabaseStorageService,
            kSecAttrAccount as String: key,
        ]
        let status = SecItemDelete(query as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            call.resolve()
        } else {
            call.reject("keychain-delete-failed (OSStatus \(status))")
        }
    }
}

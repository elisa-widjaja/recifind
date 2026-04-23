import Foundation
import Security

// Minimal Keychain reader for the share extension. Must use the same
// service/account/access-group as SharedAuthStorePlugin so the main app's
// writes are visible here. See apps/ios/ios/App/App/Plugins/SharedAuthStore.
enum SharedKeychainError: Error {
    case notFound
    case readFailed(OSStatus)
    case corruptData
}

enum SharedKeychain {
    private static let service = "com.recifriend.app.auth"
    private static let account = "supabase-jwt"
    private static let accessGroup = "com.recifriend.app.shared"

    static func readJwt() throws -> String {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: accessGroup,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { throw SharedKeychainError.notFound }
        if status != errSecSuccess { throw SharedKeychainError.readFailed(status) }
        guard let data = item as? Data, let token = String(data: data, encoding: .utf8) else {
            throw SharedKeychainError.corruptData
        }
        return token
    }

    // Called when POST /recipes returns 401 — purge the stale token so the next
    // share triggers the deep-link fallback instead of looping on 401s.
    static func clearJwt() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: accessGroup,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

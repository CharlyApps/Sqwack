import Foundation
import Security

/// Minimal Keychain wrapper for the per-daemon device credential.
enum Keychain {
    private static func query(_ ref: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.sqwack.credentials",
            kSecAttrAccount as String: ref,
        ]
    }

    static func save(_ token: String, ref: String) {
        var q = query(ref)
        SecItemDelete(q as CFDictionary)
        q[kSecValueData as String] = Data(token.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(q as CFDictionary, nil)
    }

    static func load(ref: String) -> String? {
        var q = query(ref)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(ref: String) {
        SecItemDelete(query(ref) as CFDictionary)
    }
}

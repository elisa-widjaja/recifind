import SwiftUI
import Combine

@MainActor
final class ShareFormViewModel: ObservableObject {
    @Published var title: String = ""
    @Published var imageUrl: URL?
    @Published var isLoadingPreview: Bool = true
    @Published var isSaving: Bool = false
    @Published var isSaved: Bool = false
    @Published var savedRecipeId: String? = nil
    @Published var errorMessage: String?
    @Published var needsSignIn: Bool = false
    @Published var isSigningIn: Bool = false

    let sourceURL: URL
    private let onFinish: (ShareViewController.Outcome) -> Void
    private var autoDismissTask: Task<Void, Never>?

    init(sourceURL: URL, onFinish: @escaping (ShareViewController.Outcome) -> Void) {
        self.sourceURL = sourceURL
        self.onFinish = onFinish
        Task { await self.loadPreview() }
    }

    func loadPreview() async {
        isLoadingPreview = true
        defer { isLoadingPreview = false }
        do {
            let preview = try await WorkerClient.parseRecipe(sourceUrl: sourceURL.absoluteString)
            if title.isEmpty { title = preview.title.isEmpty ? sourceURL.host ?? "Recipe" : preview.title }
            if let s = preview.imageUrl, let u = URL(string: s) { imageUrl = u }
        } catch {
            if title.isEmpty { title = sourceURL.host ?? "Recipe" }
        }
    }

    func save() {
        guard !isSaving && !isSaved else { return }
        isSaving = true
        errorMessage = nil
        let titleSnapshot = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let imageSnapshot = imageUrl?.absoluteString
        let urlSnapshot = sourceURL.absoluteString

        Task {
            defer { Task { @MainActor in self.isSaving = false } }
            let jwt: String
            do {
                jwt = try SharedKeychain.readJwt()
            } catch SharedKeychainError.notFound {
                // No JWT = user never signed in (or signed out cleanly). The
                // App Group write is deferred to signIn() so we capture the
                // user's final title edit, not whatever was in the field when
                // save() ran. The .unauthenticated path writes eagerly because
                // the JWT-expired-mid-session case carries the same title state
                // that would have posted — deferring there would require tracking
                // whether save() was mid-flight, which is needless complexity.
                await MainActor.run {
                    self.needsSignIn = true
                    self.errorMessage = nil
                }
                return
            } catch SharedKeychainError.readFailed(let status) {
                let hint: String
                switch status {
                case -34018: hint = "missingEntitlement — keychain-access-groups not in provisioning profile"
                case -25291: hint = "notAvailable — device locked or keychain offline"
                case -25300: hint = "itemNotFound (unexpected — should surface as .notFound)"
                case -50:    hint = "param — malformed query"
                default:     hint = "see osstatus.com"
                }
                await self.surfaceAndFallback(reason: "keychain readFailed OSStatus \(status) — \(hint)")
                return
            } catch SharedKeychainError.corruptData {
                await self.surfaceAndFallback(reason: "keychain corruptData")
                return
            } catch {
                await self.surfaceAndFallback(reason: "keychain unknown: \(error)")
                return
            }

            do {
                // Synchronous enrich pre-save so the initial POST /recipes lands
                // with ingredients/steps already populated (matches web-drawer
                // behavior). Returns nil on any failure path — including the 10s
                // timeout — so we silently fall back to today's fast save when
                // Gemini stalls or r.jina.ai is rate-limited.
                let enrichTitle = titleSnapshot.isEmpty ? (self.sourceURL.host ?? "Recipe") : titleSnapshot
                let enriched = await WorkerClient.enrichRecipe(
                    sourceUrl: urlSnapshot,
                    title: enrichTitle,
                    jwt: jwt
                )

                // User-typed title wins; fall back to enriched.title only when
                // the user left the field empty AND we got one back.
                let finalTitle: String = {
                    if !titleSnapshot.isEmpty { return titleSnapshot }
                    if let t = enriched?.title, !t.isEmpty { return t }
                    return self.sourceURL.host ?? "Recipe"
                }()
                // Preview image takes priority; enriched.imageUrl is the fallback.
                let finalImageUrl: String? = imageSnapshot ?? enriched?.imageUrl

                let result = try await WorkerClient.createRecipe(
                    title: finalTitle,
                    sourceUrl: urlSnapshot,
                    imageUrl: finalImageUrl,
                    enriched: enriched,
                    jwt: jwt
                )
                await MainActor.run {
                    self.isSaved = true
                    self.savedRecipeId = result.recipeId
                    self.startAutoDismiss()
                }
            } catch WorkerClientError.unauthenticated {
                SharedKeychain.clearJwt()
                SharedPendingShare.write(
                    url: urlSnapshot,
                    title: titleSnapshot.isEmpty ? (self.sourceURL.host ?? "Recipe") : titleSnapshot
                )
                await MainActor.run {
                    self.needsSignIn = true
                    self.errorMessage = nil
                }
            } catch let err as WorkerClientError {
                await self.surfaceAndFallback(reason: "worker \(err)")
            } catch {
                await self.surfaceAndFallback(reason: "net \(error)")
            }
        }
    }

    /// Dismiss the extension 8s after a successful save unless the user dismisses first.
    private func startAutoDismiss() {
        autoDismissTask?.cancel()
        autoDismissTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 8_000_000_000)
            guard !Task.isCancelled, let id = self.savedRecipeId else { return }
            self.onFinish(.saved(recipeId: id))
        }
    }

    @MainActor
    private func surfaceAndFallback(reason: String) async {
        self.errorMessage = "Falling back to app: \(reason)"
        try? await Task.sleep(nanoseconds: 2_500_000_000)
        self.onFinish(.fallback)
    }

    func cancel() {
        autoDismissTask?.cancel()
        onFinish(.cancelled)
    }

    func openInApp() {
        guard let id = savedRecipeId else { return }
        autoDismissTask?.cancel()
        onFinish(.viewInApp(recipeId: id))
    }

    func signIn() {
        guard !isSigningIn else { return }
        isSigningIn = true
        let titleSnapshot = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedTitle = titleSnapshot.isEmpty ? (sourceURL.host ?? "Recipe") : titleSnapshot
        SharedPendingShare.write(url: sourceURL.absoluteString, title: resolvedTitle)
        autoDismissTask?.cancel()
        onFinish(.signIn)
    }
}

struct ShareFormView: View {
    @ObservedObject var viewModel: ShareFormViewModel
    @FocusState private var titleFocused: Bool

    var body: some View {
        NavigationView {
            VStack(spacing: 20) {
                recipeCard
                    .padding(.horizontal, 16)
                    .padding(.top, 16)

                if viewModel.needsSignIn {
                    Text("Sign in on ReciFriend to save")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 16)
                } else if let error = viewModel.errorMessage {
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.red)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 16)
                }

                if viewModel.isSaved {
                    viewInAppButton
                        .padding(.top, 4)
                }

                Spacer(minLength: 0)
            }
            .navigationTitle("Save to ReciFriend")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(action: viewModel.cancel) {
                        Image(systemName: "xmark")
                            .font(.body.weight(.semibold))
                            .foregroundColor(.secondary)
                    }
                    .disabled(viewModel.isSaving)
                    .accessibilityLabel("Close")
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    saveToolbarButton
                }
            }
            .onAppear {
                // Auto-focus the title so the user sees a blinking cursor —
                // makes it visually clear the field is editable. Small delay
                // lets the view settle into the hierarchy before focusing.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                    titleFocused = true
                }
            }
        }
    }

    // MARK: - Nav bar save button (right)

    @ViewBuilder
    private var saveToolbarButton: some View {
        if viewModel.isSaving {
            ProgressView()
                .controlSize(.small)
                .accessibilityLabel("Saving")
        } else if viewModel.needsSignIn {
            signInToolbarButton
        } else {
            let enabled = !(saveDisabled || viewModel.isSaved)
            saveButtonBase(enabled: enabled)
                .tint(enabled ? Color.blue : Color(.systemGray5))
                .disabled(!enabled)
                .accessibilityLabel(viewModel.isSaved ? "Saved" : "Save")
        }
    }

    @ViewBuilder
    private var signInToolbarButton: some View {
        if #available(iOS 26.0, *) {
            Button(action: viewModel.signIn) {
                Text("Sign in")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Color.white)
            }
            .buttonStyle(.glassProminent)
            .tint(Color.blue)
            .disabled(viewModel.isSigningIn)
            .accessibilityLabel("Sign in on ReciFriend")
        } else {
            Button(action: viewModel.signIn) {
                Text("Sign in")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Color.white)
            }
            .buttonStyle(.borderedProminent)
            .disabled(viewModel.isSigningIn)
            .accessibilityLabel("Sign in on ReciFriend")
        }
    }

    @ViewBuilder
    private func saveButtonBase(enabled: Bool) -> some View {
        // When enabled, white glyph on blue glass. When disabled, secondary
        // glyph on light-grey glass — matches native iOS disabled toolbar
        // buttons (Mail, Notes) where contrast comes from the grey-on-grey
        // pairing rather than a faint white glyph.
        let glyphColor: Color = enabled ? .white : Color(.secondaryLabel)
        if #available(iOS 26.0, *) {
            Button(action: viewModel.save) {
                Image(systemName: "checkmark")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(glyphColor)
            }
            .buttonStyle(.glassProminent)
        } else {
            Button(action: viewModel.save) {
                Image(systemName: "checkmark")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(glyphColor)
            }
            .buttonStyle(.borderedProminent)
        }
    }

    private var saveDisabled: Bool {
        viewModel.title.trimmingCharacters(in: .whitespaces).isEmpty
    }

    // MARK: - Recipe card

    private var recipeCard: some View {
        HStack(alignment: .top, spacing: 12) {
            thumbnailView
                .frame(width: 72, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: 8))

            // Right column: title at top, "Recipe saved!" anchored at the
            // bottom of the thumbnail height. Spacer pushes them apart so the
            // saved-state confirmation always lines up with the thumbnail's
            // bottom edge regardless of title length.
            VStack(alignment: .leading, spacing: 0) {
                titleField
                Spacer(minLength: 0)
                if viewModel.isSaved {
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                            .font(.system(size: 13))
                        Text("Recipe saved!")
                            .font(.system(size: 13))
                            .foregroundColor(.secondary)
                    }
                    .transition(.opacity)
                }
            }
            .frame(height: 72, alignment: .topLeading)

            Spacer(minLength: 0)
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(.secondarySystemGroupedBackground))
        )
        .animation(.default, value: viewModel.isSaved)
    }

    @ViewBuilder
    private var titleField: some View {
        if #available(iOS 16.0, *) {
            TextField("Title", text: $viewModel.title, axis: .vertical)
                .font(.system(size: 16, weight: .semibold))
                .lineLimit(2, reservesSpace: false)
                .focused($titleFocused)
                .disabled(viewModel.isSaving || viewModel.isSaved)
        } else {
            TextField("Title", text: $viewModel.title)
                .font(.system(size: 16, weight: .semibold))
                .lineLimit(1)
                .truncationMode(.tail)
                .focused($titleFocused)
                .disabled(viewModel.isSaving || viewModel.isSaved)
        }
    }

    // MARK: - View on ReciFriend

    private var viewInAppButton: some View {
        Button(action: viewModel.openInApp) {
            Text("View on ReciFriend")
                .font(.body.weight(.semibold))
                .frame(minWidth: 100)
                .padding(.vertical, 2)
        }
        .modifier(GlassButtonStyle())
        .controlSize(.large)
    }

    // MARK: - Thumbnail

    @ViewBuilder
    private var thumbnailView: some View {
        if let imageUrl = viewModel.imageUrl {
            AsyncImage(url: imageUrl) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().aspectRatio(contentMode: .fill)
                default:
                    placeholder
                }
            }
        } else {
            placeholder
        }
    }

    private var placeholder: some View {
        Rectangle().fill(Color(.systemGray5))
    }
}

/// Transparent Liquid Glass on iOS 26+, bordered fallback otherwise.
/// Used by the "View on ReciFriend" action below the card.
private struct GlassButtonStyle: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.buttonStyle(.glass)
        } else {
            content.buttonStyle(.bordered)
        }
    }
}


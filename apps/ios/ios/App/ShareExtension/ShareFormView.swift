import SwiftUI
import Combine

@MainActor
final class ShareFormViewModel: ObservableObject {
    @Published var title: String = ""
    @Published var imageUrl: URL?
    @Published var isLoadingPreview: Bool = true
    @Published var isSaving: Bool = false
    @Published var isSaved: Bool = false
    // True when the worker reported the recipe was already in the user's
    // collection (HTTP 200 from POST /recipes) rather than a fresh save (201).
    @Published var isDuplicate: Bool = false
    @Published var savedRecipeId: String? = nil
    @Published var savedOwnerId: String? = nil
    // Full caption recovered on-device for Facebook shares; passed to the worker
    // enrich call so Gemini can extract ingredients/steps. nil for non-FB.
    @Published var caption: String? = nil
    @Published var errorMessage: String?
    @Published var needsSignIn: Bool = false
    @Published var isSigningIn: Bool = false
    // Set when the worker rejects the link (HTTP 400 — not an allowlisted
    // source). Shows the server's friendly message in the sheet and blocks Save,
    // WITHOUT redirecting to the app (which would otherwise open a blank-title
    // placeholder drawer for a link we already know we can't save).
    @Published var isUnsupportedSource: Bool = false

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

        // Race two parallel preview sources:
        //   1. Worker /recipes/parse — KV-cached for repeat URLs (instant
        //      on second+ shares of the same reel), runs JSON-LD parsing
        //      for blogs, fastest for non-Instagram URLs.
        //   2. DeviceMetadataFetcher — fetches og:description directly
        //      from the source URL on the device's residential IP. This
        //      bypasses Instagram's datacenter-IP rate-limiting that
        //      makes the worker path unreliable for fresh IG reels.
        //
        // Whichever returns a usable title first wins. If neither does,
        // fall back to the URL host (today's behavior). Total budget
        // stays under the share-extension's 4s deadline because both
        // requests run concurrently and use ~3.5s per-request timeouts.
        // On-device fetch runs concurrently with the worker parse.
        async let devicePreview: ParsePreview? = DeviceMetadataFetcher.fetchSocialPreview(sourceUrl: sourceURL)

        // Worker parse, capturing an "unsupported source" rejection (HTTP 400)
        // so we can show the server's friendly message in the sheet instead of
        // falling back to the app with a blank-title placeholder drawer.
        var workerResult: ParsePreview? = nil
        var unsupportedMessage: String? = nil
        do {
            workerResult = try await WorkerClient.parseRecipe(sourceUrl: sourceURL.absoluteString)
        } catch WorkerClientError.unsupportedSource(let msg) {
            unsupportedMessage = msg
        } catch {
            // Transient parse failure — fall through to the device/host fallback.
        }
        let deviceResult = await devicePreview

        // Unsupported source: surface the friendly message, block Save, and do
        // NOT redirect to the app. The user dismisses with the ✕.
        if let msg = unsupportedMessage {
            isUnsupportedSource = true
            errorMessage = msg
            return
        }

        // Facebook is login-walled from the worker's datacenter IPs, so the
        // device fetch (residential IP) is the only trustworthy FB source —
        // prefer it. For everything else the worker wins (KV cache + JSON-LD).
        // When neither yields a title, fall back to a clean editable
        // placeholder rather than the raw "facebook.com" hostname.
        let host = sourceURL.host?.lowercased() ?? ""
        let isFacebook = host.contains("facebook.com") || host == "fb.watch" || host.hasSuffix(".fb.watch")

        let resolvedTitle: String
        if isFacebook {
            if let deviceTitle = deviceResult?.title, !deviceTitle.isEmpty {
                resolvedTitle = deviceTitle
            } else if let workerTitle = workerResult?.title, !workerTitle.isEmpty {
                resolvedTitle = workerTitle
            } else {
                resolvedTitle = "Facebook Reel"
            }
        } else if let workerTitle = workerResult?.title, !workerTitle.isEmpty {
            resolvedTitle = workerTitle
        } else if let deviceTitle = deviceResult?.title, !deviceTitle.isEmpty {
            resolvedTitle = deviceTitle
        } else {
            resolvedTitle = sourceURL.host ?? "Recipe"
        }

        // Mirror the title precedence: device-first for Facebook, worker-first
        // otherwise. Split into if/else because the equivalent nested ternary
        // with ?? on both branches trips Swift's expression type-checker.
        let resolvedImage: String?
        if isFacebook {
            resolvedImage = deviceResult?.imageUrl ?? workerResult?.imageUrl
            // Full caption is FB-only; pass it to the worker enrich call in save().
            caption = deviceResult?.caption
        } else {
            resolvedImage = workerResult?.imageUrl ?? deviceResult?.imageUrl
        }

        if title.isEmpty { title = resolvedTitle }
        if imageUrl == nil, let s = resolvedImage, let u = URL(string: s) { imageUrl = u }
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
                    caption: self.caption,
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
                    self.isDuplicate = (result.statusCode == 200)
                    self.isSaved = true
                    self.savedRecipeId = result.recipeId
                    self.savedOwnerId = result.ownerId
                    self.startAutoDismiss()
                }
            } catch WorkerClientError.unauthenticated {
                SharedKeychain.clearJwt()
                SharedPendingShare.write(
                    url: urlSnapshot,
                    title: titleSnapshot.isEmpty ? (self.sourceURL.host ?? "Recipe") : titleSnapshot,
                    imageUrl: imageSnapshot
                )
                await MainActor.run {
                    self.needsSignIn = true
                    self.errorMessage = nil
                }
            } catch WorkerClientError.unsupportedSource(let msg) {
                // Worker rejected the link — show the friendly message in-sheet
                // and block Save; do NOT redirect to the app.
                await MainActor.run {
                    self.isUnsupportedSource = true
                    self.errorMessage = msg
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
        // Fresh save -> recipe collection page; re-save (already in collection)
        // -> the recipe detail so the user can see/share the existing entry.
        if isDuplicate {
            onFinish(.viewInApp(recipeId: id, ownerId: savedOwnerId))
        } else {
            onFinish(.viewRecipesList)
        }
    }

    func signIn() {
        guard !isSigningIn else { return }
        isSigningIn = true
        let titleSnapshot = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedTitle = titleSnapshot.isEmpty ? (sourceURL.host ?? "Recipe") : titleSnapshot
        SharedPendingShare.write(
            url: sourceURL.absoluteString,
            title: resolvedTitle,
            imageUrl: imageUrl?.absoluteString
        )
        autoDismissTask?.cancel()
        onFinish(.signIn)
    }
}

struct ShareFormView: View {
    @ObservedObject var viewModel: ShareFormViewModel
    @FocusState private var titleFocused: Bool
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        NavigationView {
            Group {
                if viewModel.isUnsupportedSource {
                    // Unsupported source: skip the grey placeholder card + empty
                    // title and just show the worker's message, centered. Font
                    // size (15) matches the in-app Add Recipe drawer's error.
                    VStack {
                        Text(viewModel.errorMessage ?? WorkerClient.defaultUnsupportedMessage)
                            .font(.system(size: 15))
                            .foregroundColor(.red)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 24)
                            .padding(.top, 24)
                        Spacer(minLength: 0)
                    }
                } else {
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
                }
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
        if viewModel.isUnsupportedSource {
            // No save affordance for an unsupported link — the sheet only shows
            // the error message. (Empty content here keeps the ToolbarItem
            // unconditional, since `if` inside .toolbar needs iOS 16+.)
            EmptyView()
        } else if viewModel.isSaving {
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
        viewModel.isUnsupportedSource
            || viewModel.title.trimmingCharacters(in: .whitespaces).isEmpty
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
            // maxWidth:.infinity makes this column fill the row so the
            // trailing clear (✕) button lands on the card's right inner edge.
            // That inner edge is the card's .padding(12), so the ✕-to-right-
            // edge gap equals the thumbnail-to-left-edge gap (both 12pt). The
            // dropped trailing Spacer previously absorbed that slack and left
            // the ✕ floating at content width instead.
            VStack(alignment: .leading, spacing: 0) {
                titleField
                Spacer(minLength: 0)
                if viewModel.isSaved {
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                            .font(.system(size: 13))
                        Text(viewModel.isDuplicate ? "Already in your collection" : "Recipe saved!")
                            .font(.system(size: 13))
                            .foregroundColor(.secondary)
                    }
                    .transition(.opacity)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 72, maxHeight: 72, alignment: .topLeading)
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
        // Show "Loading recipe…" while parseRecipe is in flight so the title row
        // doesn't look like a blank empty field during the cold-launch wait.
        let placeholderText = viewModel.isLoadingPreview ? "Loading recipe…" : "Title"
        // Clear (X) button pinned to the right of the title row so the user can
        // wipe the auto-filled caption in one tap. Hidden while empty / saving /
        // saved. alignment:.top keeps it level with the first line when the
        // title wraps to two lines.
        HStack(alignment: .top, spacing: 8) {
            Group {
                if #available(iOS 16.0, *) {
                    TextField(placeholderText, text: $viewModel.title, axis: .vertical)
                        .font(.system(size: 15, weight: .semibold))
                        .lineLimit(2, reservesSpace: false)
                        .focused($titleFocused)
                        .disabled(viewModel.isSaving || viewModel.isSaved)
                } else {
                    TextField(placeholderText, text: $viewModel.title)
                        .font(.system(size: 15, weight: .semibold))
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .focused($titleFocused)
                        .disabled(viewModel.isSaving || viewModel.isSaved)
                }
            }

            if !viewModel.title.isEmpty && !viewModel.isSaving && !viewModel.isSaved {
                Button {
                    viewModel.title = ""
                    titleFocused = true
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 16))
                        // The .fill circle takes the foreground color; the X is
                        // knocked out so the card shows through it. In dark mode
                        // .secondary makes the circle pop against the dark card —
                        // step down to .tertiaryLabel so it blends closer to the
                        // card background. Light mode keeps .secondary.
                        .foregroundColor(colorScheme == .dark
                            ? Color(.tertiaryLabel)
                            : .secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear title")
            }
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
        ZStack {
            Rectangle().fill(Color(.systemGray5))
            if viewModel.isLoadingPreview {
                ProgressView()
                    .tint(.secondary)
            }
        }
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


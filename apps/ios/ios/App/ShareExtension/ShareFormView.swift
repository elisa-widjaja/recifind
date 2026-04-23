import SwiftUI
import Combine

@MainActor
final class ShareFormViewModel: ObservableObject {
    @Published var title: String = ""
    @Published var imageUrl: URL?
    @Published var isLoadingPreview: Bool = true
    @Published var isSaving: Bool = false
    @Published var errorMessage: String?

    let sourceURL: URL
    private let onFinish: (ShareViewController.Outcome) -> Void

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
            // Placeholder state: title = host, no image. User can still save.
            if title.isEmpty { title = sourceURL.host ?? "Recipe" }
        }
    }

    func save() {
        guard !isSaving else { return }
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
            } catch {
                await MainActor.run { self.onFinish(.fallback) }
                return
            }

            do {
                let result = try await WorkerClient.createRecipe(
                    title: titleSnapshot.isEmpty ? (self.sourceURL.host ?? "Recipe") : titleSnapshot,
                    sourceUrl: urlSnapshot,
                    imageUrl: imageSnapshot,
                    jwt: jwt
                )
                await MainActor.run { self.onFinish(.saved(recipeId: result.recipeId)) }
            } catch WorkerClientError.unauthenticated {
                // Token expired — purge it so next share doesn't loop on 401.
                SharedKeychain.clearJwt()
                await MainActor.run { self.onFinish(.fallback) }
            } catch {
                await MainActor.run { self.onFinish(.fallback) }
            }
        }
    }

    func cancel() {
        onFinish(.cancelled)
    }
}

struct ShareFormView: View {
    @ObservedObject var viewModel: ShareFormViewModel

    var body: some View {
        NavigationView {
            Form {
                Section {
                    HStack(alignment: .top, spacing: 12) {
                        thumbnailView
                            .frame(width: 72, height: 72)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        VStack(alignment: .leading, spacing: 4) {
                            TextField("Title", text: $viewModel.title)
                                .font(.headline)
                                .disabled(viewModel.isSaving)
                            Text(viewModel.sourceURL.host ?? "")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                    .padding(.vertical, 6)
                }

                if let error = viewModel.errorMessage {
                    Section {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                }
            }
            .navigationTitle("Save Recipe")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: viewModel.cancel)
                        .disabled(viewModel.isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if viewModel.isSaving {
                        ProgressView()
                    } else {
                        Button("Save", action: viewModel.save)
                            .disabled(viewModel.title.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
        }
    }

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
